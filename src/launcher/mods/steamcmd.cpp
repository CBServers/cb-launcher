#include "std_include.hpp"
#include "steamcmd.hpp"
#include "steamcmd_log.hpp"

#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

namespace mods::steamcmd
{
    namespace
    {
        constexpr auto INSTALLER_URL = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
        constexpr auto STALL_TIMEOUT_TICKS = 600; // 500ms ticks -> 5 minutes without byte growth

        std::filesystem::path root()
        {
            return utils::properties::get_appdata_path() / "mods" / "steamcmd";
        }

        std::filesystem::path exe_path()
        {
            return root() / "steamcmd.exe";
        }

        std::filesystem::path workshop_path()
        {
            return root() / "steamapps" / "workshop";
        }

        std::filesystem::path item_path(const uint32_t appid, const std::string& workshop_id)
        {
            return workshop_path() / "content" / std::to_string(appid) / workshop_id;
        }

        std::filesystem::path content_log_path()
        {
            return root() / "logs" / "content_log.txt";
        }

        // SteamCMD keeps the log open, so read a copy rather than risking a sharing violation.
        std::optional<std::string> read_content_log()
        {
            const auto source = content_log_path();
            if (!utils::io::file_exists(source))
            {
                return std::nullopt;
            }

            const auto copy = source.parent_path() / "content_log.launcher";
            if (!CopyFileW(source.wstring().data(), copy.wstring().data(), FALSE))
            {
                return std::nullopt;
            }

            std::string text{};
            if (!utils::io::read_file(copy, &text))
            {
                return std::nullopt;
            }

            return text;
        }

        size_t count_content_runs(const uint32_t appid)
        {
            const auto text = read_content_log();
            return text ? steamcmd_log::parse_content_runs(*text, appid).size() : 0;
        }

        // Only used when the process I/O counters are unavailable: coarse, but never a lie.
        int phase_percent(const steamcmd_log::content_run& run)
        {
            switch (run.phase)
            {
            case steamcmd_log::content_phase::reconfiguring:
                return 1;
            case steamcmd_log::content_phase::preallocating:
                return 2;
            case steamcmd_log::content_phase::downloading:
                return 5;
            case steamcmd_log::content_phase::committing:
            case steamcmd_log::content_phase::finished:
                return 99;
            default:
                return 0;
            }
        }

        HANDLE run_hidden(const std::string& arguments)
        {
            const auto exe = exe_path().wstring();
            const auto wide_arguments = utils::string::convert(arguments);
            const auto directory = root().wstring();

            SHELLEXECUTEINFOW info{};
            info.cbSize = sizeof(info);
            info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NO_CONSOLE;
            info.lpFile = exe.data();
            info.lpParameters = wide_arguments.data();
            info.lpDirectory = directory.data();
            info.nShow = SW_HIDE;

            if (!ShellExecuteExW(&info))
            {
                return nullptr;
            }

            return info.hProcess;
        }

        bool run_and_wait(const std::string& arguments)
        {
            const auto handle = run_hidden(arguments);
            if (!handle)
            {
                return false;
            }

            WaitForSingleObject(handle, INFINITE);
            CloseHandle(handle);
            return true;
        }

        bool download_installer(std::string& error)
        {
            const auto response = utils::http::get_data(INSTALLER_URL);
            if (!response || response->response_code != 200 || response->buffer.empty())
            {
                error = "Failed to download the Steam downloader.";
                return false;
            }

            const auto archive = root() / "steamcmd.zip";
            if (!utils::io::write_file(archive, response->buffer))
            {
                error = "Failed to save the Steam downloader.";
                return false;
            }

            const auto extract_error = extract_zip(archive, root());
            utils::io::remove_file(archive);
            if (!extract_error.empty())
            {
                error = extract_error;
                return false;
            }

            return true;
        }
    }

    bool ensure_installed(const progress_callback& progress, std::string& error)
    {
        if (progress)
        {
            progress("preparing", "steamcmd", 0);
        }

        if (!utils::io::file_exists(exe_path()) && !download_installer(error))
        {
            return false;
        }

        // First run self-updates steamcmd; do it once so item downloads start clean.
        const auto updated_marker = root() / "steamcmd.updated";
        if (!utils::io::file_exists(updated_marker))
        {
            if (!run_and_wait("+quit"))
            {
                error = "Failed to start the Steam downloader.";
                return false;
            }

            utils::io::write_file(updated_marker, "1");
        }

        return true;
    }

    std::optional<std::filesystem::path> download_item(const uint32_t appid, const std::string& workshop_id, const uint64_t expected_size,
                                                       const progress_callback& progress, std::string& error)
    {
        const auto item = item_path(appid, workshop_id);

        std::error_code code{};
        std::filesystem::remove_all(item, code);

        auto runs_before = count_content_runs(appid);

        const auto handle = run_hidden(utils::string::va("+login anonymous +workshop_download_item %u %s +quit", appid, workshop_id.data()));
        if (!handle)
        {
            error = "Failed to start the Steam downloader.";
            return std::nullopt;
        }

        auto query = handle;
        HANDLE opened_query = nullptr;

        const auto close_handles = [&]
        {
            if (opened_query)
            {
                CloseHandle(opened_query);
            }

            CloseHandle(handle);
        };

        const auto abort_download = [&](const std::string& reason)
        {
            utils::nt::terminate_process_handle(handle);
            close_handles();
            cleanup_downloads(appid, workshop_id);
            error = reason;
        };

        uint64_t last_write = 0;
        uintmax_t last_log_size = 0;
        auto stalled_ticks = 0;
        steamcmd_log::content_run run{};

        while (WaitForSingleObject(handle, 500) == WAIT_TIMEOUT)
        {
            if (const auto log_size = std::filesystem::file_size(content_log_path(), code); !code && log_size != last_log_size)
            {
                last_log_size = log_size;
                if (const auto text = read_content_log())
                {
                    const auto runs = steamcmd_log::parse_content_runs(*text, appid);
                    if (runs.size() > runs_before)
                    {
                        run = runs.back();
                    }
                    else if (runs.size() < runs_before)
                    {
                        runs_before = 0; // the log was rotated out from under us
                    }
                }
            }

            IO_COUNTERS counters{};
            auto have_io = GetProcessIoCounters(query, &counters) != FALSE;
            if (!have_io && !opened_query)
            {
                // The handle from the shell may not carry query rights; reopen by pid.
                opened_query = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, GetProcessId(handle));
                if (opened_query)
                {
                    query = opened_query;
                    have_io = GetProcessIoCounters(query, &counters) != FALSE;
                }
            }

            auto percent = 0;
            if (have_io)
            {
                // SteamCMD preallocates every file at full size up front, so folder size is flat from the
                // first second; its own write counter is the only number that tracks the transfer.
                const auto write = counters.WriteTransferCount;
                stalled_ticks = write == last_write ? stalled_ticks + 1 : 0;
                last_write = write;

                if (stalled_ticks > STALL_TIMEOUT_TICKS)
                {
                    abort_download("The download stalled and was cancelled.");
                    return std::nullopt;
                }

                const auto total = run.stage_total ? run.stage_total : expected_size;
                const auto staged = run.stage_baseline + write;
                if (total)
                {
                    // The commit is a same-volume move and does not count, so hold at 99 until it starts.
                    const auto ceiling = run.saw_commit ? 100ull : 99ull;
                    percent = static_cast<int>(std::min(ceiling, staged * 100 / total));
                }
            }
            else
            {
                percent = phase_percent(run);
            }

            if (progress && !progress("downloading", workshop_id, percent))
            {
                abort_download("cancelled");
                return std::nullopt;
            }
        }

        close_handles();

        if (!utils::io::directory_exists(item) || utils::io::directory_is_empty(item))
        {
            error = "Steam did not provide the Workshop item. It may have been removed.";
            utils::logger::write("[cbl-mods] steamcmd produced no content for {}", workshop_id);
            return std::nullopt;
        }

        return item;
    }

    void cleanup_downloads(const uint32_t appid, const std::string& workshop_id)
    {
        std::error_code code{};
        std::filesystem::remove_all(item_path(appid, workshop_id), code);
        std::filesystem::remove_all(workshop_path() / "downloads", code);
    }
}
