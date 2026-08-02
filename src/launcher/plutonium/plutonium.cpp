#include "std_include.hpp"
#include "plutonium.hpp"

#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

#include <chrono>
#include <thread>

namespace plutonium
{
    namespace
    {
        constexpr auto UPDATER_MANIFEST_URL = "https://cdn.plutonium.pw/updater/prod.json";
        constexpr auto LAUNCHER_EXE = "plutonium-launcher-win32.exe";
        constexpr auto BOOTSTRAPPER_EXE = "plutonium-bootstrapper-win32.exe";
        constexpr auto URI_PREFIX = "plutonium://play/";

        // create_session is awaited with a 10s cap on their side, so an outcome must land inside this.
        constexpr auto LAUNCH_TIMEOUT = std::chrono::seconds(15);
        constexpr auto LAUNCH_POLL_INTERVAL = std::chrono::milliseconds(100);
        // Covers the snapshot gap between the launcher exiting and its bootstrapper becoming visible.
        constexpr auto HANDOFF_GRACE = std::chrono::seconds(2);

        constexpr auto UPDATE_TIMEOUT = std::chrono::minutes(20);
        constexpr auto UPDATE_POLL_INTERVAL = std::chrono::milliseconds(500);

        std::optional<int> read_revision(const std::string& json)
        {
            rapidjson::Document doc;
            if (doc.Parse(json).HasParseError() || !doc.IsObject())
            {
                return std::nullopt;
            }

            if (!doc.HasMember("revision") || !doc["revision"].IsInt())
            {
                return std::nullopt;
            }

            return doc["revision"].GetInt();
        }

        std::optional<int> get_local_revision()
        {
            const auto root = get_root();
            if (root.empty())
            {
                return std::nullopt;
            }

            std::string data;
            if (!utils::io::read_file(root / "info.json", &data))
            {
                return std::nullopt;
            }

            return read_revision(data);
        }

        // Follows prod.json -> manifests[0] -> revision rather than pinning the manifest URL.
        std::optional<int> fetch_remote_revision()
        {
            const auto prod = utils::http::get_data(UPDATER_MANIFEST_URL, {}, {}, {}, 10, 1);
            if (!prod || prod->response_code != 200)
            {
                return std::nullopt;
            }

            rapidjson::Document doc;
            if (doc.Parse(prod->buffer).HasParseError() || !doc.IsObject())
            {
                return std::nullopt;
            }

            if (!doc.HasMember("manifests") || !doc["manifests"].IsArray() || doc["manifests"].Empty())
            {
                return std::nullopt;
            }

            const auto& first = doc["manifests"][0];
            if (!first.IsString())
            {
                return std::nullopt;
            }

            const auto manifest = utils::http::get_data(first.GetString(), {}, {}, {}, 10, 1);
            if (!manifest || manifest->response_code != 200)
            {
                return std::nullopt;
            }

            return read_revision(manifest->buffer);
        }

        struct window_search
        {
            unsigned long pid{0};
            HWND found{nullptr};
        };

        BOOL CALLBACK enum_window_proc(HWND window, LPARAM param)
        {
            auto* search = reinterpret_cast<window_search*>(param);

            DWORD owner = 0;
            GetWindowThreadProcessId(window, &owner);
            if (owner != search->pid || !IsWindowVisible(window))
            {
                return TRUE;
            }

            RECT rect{};
            if (!GetWindowRect(window, &rect) || rect.right <= rect.left || rect.bottom <= rect.top)
            {
                return TRUE;
            }

            search->found = window;
            return FALSE;
        }

        // The URI path creates no UI, so any visible window it owns means failure. Ownership beats title-matching "err".
        HWND find_visible_window(const unsigned long pid)
        {
            window_search search{pid, nullptr};
            EnumWindows(enum_window_proc, reinterpret_cast<LPARAM>(&search));
            return search.found;
        }

        // Diagnostics only - nothing branches on this text.
        std::string describe_window(HWND window)
        {
            wchar_t title[256]{};
            GetWindowTextW(window, title, static_cast<int>(std::size(title)));

            wchar_t body[1024]{};
            GetDlgItemTextW(window, 0xFFFF, body, static_cast<int>(std::size(body)));

            return std::format("title='{}' text='{}'", utils::string::convert(title), utils::string::convert(body));
        }
    }

    std::filesystem::path get_root()
    {
        try
        {
            return utils::properties::get_appdata_folder_path("Plutonium");
        }
        catch (const std::exception& e)
        {
            utils::logger::write("[pluto] failed to resolve install root: {}", e.what());
            return {};
        }
    }

    std::filesystem::path get_launcher_exe()
    {
        const auto root = get_root();
        if (root.empty())
        {
            return {};
        }

        return root / "bin" / LAUNCHER_EXE;
    }

    bool is_available()
    {
        const auto exe = get_launcher_exe();
        return !exe.empty() && utils::io::file_exists(exe);
    }

    std::string get_token()
    {
        const auto root = get_root();
        if (root.empty())
        {
            return {};
        }

        std::string data;
        if (!utils::io::read_file(root / "config.json", &data))
        {
            return {};
        }

        rapidjson::Document doc;
        if (doc.Parse(data).HasParseError() || !doc.IsObject())
        {
            return {};
        }

        if (!doc.HasMember("token") || !doc["token"].IsString())
        {
            return {};
        }

        return doc["token"].GetString();
    }

    bool is_game_running()
    {
        return utils::nt::find_process_id(BOOTSTRAPPER_EXE) != 0;
    }

    bool open_login_ui()
    {
        const auto exe = get_launcher_exe();
        if (exe.empty() || !utils::io::file_exists(exe))
        {
            utils::logger::write("[pluto] cannot open login UI, launcher missing");
            return false;
        }

        // Zero arguments is what gives their UI - any argument suppresses it.
        const auto pid = utils::nt::launch_process(exe, "", get_root());
        utils::logger::write("[pluto] opened login UI (pid {})", pid);
        return pid != 0;
    }

    void ensure_updated(const std::filesystem::path& updater_exe)
    {
        const auto remote = fetch_remote_revision();
        if (!remote)
        {
            utils::logger::write("[pluto] could not read remote revision, assuming current");
            return;
        }

        const auto local = get_local_revision();
        if (local && *local == *remote)
        {
            utils::logger::write("[pluto] already at revision {}, skipping updater", *remote);
            return;
        }

        if (!utils::io::file_exists(updater_exe))
        {
            utils::logger::write("[pluto] updater missing at '{}'", utils::string::path_to_utf8(updater_exe));
            return;
        }

        utils::logger::write("[pluto] updating {} -> {}", local ? std::to_string(*local) : std::string{"unknown"}, *remote);

        const auto pid = utils::nt::launch_process(updater_exe, "-update-only -no-self-update",
            updater_exe.parent_path());
        if (!pid)
        {
            utils::logger::write("[pluto] failed to start updater");
            return;
        }

        // Their window stays up after finishing, so the revision landing is the completion signal.
        const auto deadline = std::chrono::steady_clock::now() + UPDATE_TIMEOUT;
        while (std::chrono::steady_clock::now() < deadline)
        {
            std::this_thread::sleep_for(UPDATE_POLL_INTERVAL);

            const auto current = get_local_revision();
            if (current && *current == *remote)
            {
                utils::logger::write("[pluto] update complete at revision {}", *remote);
                utils::nt::terminate_process(pid);
                return;
            }

            if (!utils::nt::is_process_alive(pid))
            {
                utils::logger::write("[pluto] updater exited on its own");
                return;
            }
        }

        utils::logger::write("[pluto] update timed out, closing updater and launching anyway");
        utils::nt::terminate_process(pid);
    }

    launch_result launch_via_uri(const std::string& pluto_game)
    {
        const auto exe = get_launcher_exe();
        if (exe.empty() || !utils::io::file_exists(exe))
        {
            utils::logger::write("[pluto] launcher missing, cannot launch '{}'", pluto_game);
            return {};
        }

        // A bootstrapper we didn't start means we'd watch a pid that never changes, so fail fast instead.
        if (const auto existing = utils::nt::find_process_id(BOOTSTRAPPER_EXE))
        {
            utils::logger::write("[pluto] bootstrapper already running (pid {}), refusing to launch '{}'",
                existing, pluto_game);
            return {};
        }

        const auto uri = URI_PREFIX + pluto_game;
        const auto pid = utils::nt::launch_process(exe, uri, get_root());
        if (!pid)
        {
            utils::logger::write("[pluto] failed to start launcher for '{}'", uri);
            return {};
        }

        utils::logger::write("[pluto] launched '{}' (pid {})", uri, pid);

        const auto deadline = std::chrono::steady_clock::now() + LAUNCH_TIMEOUT;
        std::optional<std::chrono::steady_clock::time_point> handoff_deadline;

        while (std::chrono::steady_clock::now() < deadline)
        {
            // Checked first so an ordering surprise reads as success rather than failure.
            const auto bootstrapper = utils::nt::find_process_id(BOOTSTRAPPER_EXE);
            if (bootstrapper)
            {
                utils::logger::write("[pluto] '{}' started (bootstrapper pid {})", pluto_game, bootstrapper);
                return {true, bootstrapper};
            }

            if (auto* const window = find_visible_window(pid))
            {
                // Kill it while the modal blocks; otherwise it falls through and spawns a tokenless bootstrapper.
                utils::logger::write("[pluto] launcher showed a window, treating as failure: {}",
                    describe_window(window));
                utils::nt::terminate_process(pid);
                return {};
            }

            if (!utils::nt::is_process_alive(pid))
            {
                if (!handoff_deadline)
                {
                    handoff_deadline = std::chrono::steady_clock::now() + HANDOFF_GRACE;
                }
                else if (std::chrono::steady_clock::now() >= *handoff_deadline)
                {
                    utils::logger::write("[pluto] launcher exited without starting '{}'", pluto_game);
                    return {};
                }
            }

            std::this_thread::sleep_for(LAUNCH_POLL_INTERVAL);
        }

        utils::logger::write("[pluto] timed out waiting for '{}'", pluto_game);
        utils::nt::terminate_process(pid);
        return {};
    }
}
