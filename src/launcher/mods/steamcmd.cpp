#include "std_include.hpp"
#include "steamcmd.hpp"

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
        const auto downloads = workshop_path() / "downloads" / std::to_string(appid);

        std::error_code code{};
        std::filesystem::remove_all(item, code);

        const auto handle = run_hidden(utils::string::va("+login anonymous +workshop_download_item %u %s +quit", appid, workshop_id.data()));
        if (!handle)
        {
            error = "Failed to start the Steam downloader.";
            return std::nullopt;
        }

        const auto abort_download = [&](const std::string& reason)
        {
            utils::nt::terminate_process_handle(handle);
            CloseHandle(handle);
            cleanup_downloads(appid, workshop_id);
            error = reason;
        };

        uint64_t last_bytes = 0;
        auto stalled_ticks = 0;
        while (WaitForSingleObject(handle, 500) == WAIT_TIMEOUT)
        {
            const auto bytes = folder_size(downloads) + folder_size(item);
            stalled_ticks = bytes == last_bytes ? stalled_ticks + 1 : 0;
            last_bytes = bytes;

            if (stalled_ticks > STALL_TIMEOUT_TICKS)
            {
                abort_download("The download stalled and was cancelled.");
                return std::nullopt;
            }

            const auto percent = expected_size ? static_cast<int>(std::min<uint64_t>(99, bytes * 100 / expected_size)) : 0;
            if (progress && !progress("downloading", workshop_id, percent))
            {
                abort_download("cancelled");
                return std::nullopt;
            }
        }

        CloseHandle(handle);

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
