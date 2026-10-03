#include "std_include.hpp"
#include "plutonium.hpp"

#include <utils/finally.hpp>
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
        constexpr auto STOP_TIMEOUT = std::chrono::seconds(5);
        constexpr DWORD CONNECT_WORKER_TIMEOUT_MS = 10000;

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

        // A medium-IL TerminateProcess can't reach an elevated launcher, so try the broker's handle first and a UAC taskkill last.
        void kill_process(const unsigned long pid, HANDLE handle)
        {
            if (utils::nt::terminate_process_handle(handle) || utils::nt::terminate_process(pid))
            {
                return;
            }

            utils::logger::write("[pluto] terminate denied for pid {}, falling back to elevated taskkill", pid);
            utils::nt::terminate_process_elevated(pid);
        }

        bool is_alive(const unsigned long pid, HANDLE handle)
        {
            return handle ? utils::nt::is_process_alive_handle(handle) : utils::nt::is_process_alive(pid);
        }

        // Drops argv[0], quoted or not, leaving the arguments exactly as their launcher built them.
        std::string strip_program(const std::string& command_line)
        {
            const auto end = command_line.starts_with('"') ? command_line.find('"', 1) : command_line.find(' ');
            if (end == std::string::npos)
            {
                return {};
            }

            const auto start = command_line.find_first_not_of(' ', end + 1);
            return start == std::string::npos ? std::string{} : command_line.substr(start);
        }

        // Their launcher falls through to a bare "-token " when create_session fails.
        bool has_session_token(const std::string& args)
        {
            constexpr std::string_view flag = " -token ";
            const auto pos = args.find(flag);
            return pos != std::string::npos && pos + flag.size() < args.size() && args[pos + flag.size()] != ' ';
        }

        bool stop_and_wait(const unsigned long pid)
        {
            if (!utils::nt::terminate_process(pid))
            {
                return false;
            }

            const auto deadline = std::chrono::steady_clock::now() + STOP_TIMEOUT;
            while (utils::nt::is_process_alive(pid))
            {
                if (std::chrono::steady_clock::now() >= deadline)
                {
                    return false;
                }
                std::this_thread::sleep_for(LAUNCH_POLL_INTERVAL);
            }
            return true;
        }

        // Diagnostics only - nothing branches on this text. Comes back blank for an elevated launcher (UIPI blocks WM_GETTEXT).
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

    std::filesystem::path get_bootstrapper_exe()
    {
        const auto root = get_root();
        if (root.empty())
        {
            return {};
        }

        return root / "bin" / BOOTSTRAPPER_EXE;
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
        bool elevated = false;
        const auto pid = utils::nt::launch_process_maybe_elevated(exe, "", get_root(), &elevated);
        utils::logger::write("[pluto] opened login UI (pid {}{})", pid, elevated ? ", elevated" : "");
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

        HANDLE handle = nullptr;
        const auto pid = utils::nt::launch_process_maybe_elevated(updater_exe, "-update-only -no-self-update",
            updater_exe.parent_path(), nullptr, &handle);
        if (!pid)
        {
            utils::logger::write("[pluto] failed to start updater (error {})", GetLastError());
            return;
        }

        const auto close_handle = utils::finally([&]()
        {
            if (handle) CloseHandle(handle);
        });

        // Their window stays up after finishing, so the revision landing is the completion signal.
        const auto deadline = std::chrono::steady_clock::now() + UPDATE_TIMEOUT;
        while (std::chrono::steady_clock::now() < deadline)
        {
            std::this_thread::sleep_for(UPDATE_POLL_INTERVAL);

            const auto current = get_local_revision();
            if (current && *current == *remote)
            {
                utils::logger::write("[pluto] update complete at revision {}", *remote);
                kill_process(pid, handle);
                return;
            }

            if (!is_alive(pid, handle))
            {
                utils::logger::write("[pluto] updater exited on its own");
                return;
            }
        }

        utils::logger::write("[pluto] update timed out, closing updater and launching anyway");
        kill_process(pid, handle);
    }

    launch_result launch_via_uri(const std::string& pluto_game, const bool elevate)
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

        auto elevated = elevate;
        HANDLE handle = nullptr;
        const auto pid = elevate
            ? utils::nt::launch_process_elevated(exe, uri, get_root(), &handle)
            : utils::nt::launch_process_maybe_elevated(exe, uri, get_root(), &elevated, &handle);

        const auto close_handle = utils::finally([&]()
        {
            if (handle) CloseHandle(handle);
        });

        if (!pid)
        {
            const auto error = GetLastError();
            utils::logger::write("[pluto] failed to start launcher for '{}' (error {})", uri, error);
            return {false, 0, elevated, elevated && error == ERROR_CANCELLED};
        }

        utils::logger::write("[pluto] launched '{}' (pid {}{})", uri, pid, elevated ? ", elevated" : "");

        const auto deadline = std::chrono::steady_clock::now() + LAUNCH_TIMEOUT;
        std::optional<std::chrono::steady_clock::time_point> handoff_deadline;

        while (std::chrono::steady_clock::now() < deadline)
        {
            // Checked first so an ordering surprise reads as success rather than failure.
            const auto bootstrapper = utils::nt::find_process_id(BOOTSTRAPPER_EXE);
            if (bootstrapper)
            {
                utils::logger::write("[pluto] '{}' started (bootstrapper pid {})", pluto_game, bootstrapper);
                return {true, bootstrapper, elevated, false};
            }

            if (auto* const window = find_visible_window(pid))
            {
                // Kill it while the modal blocks; otherwise it falls through and spawns a tokenless bootstrapper.
                utils::logger::write("[pluto] launcher showed a window, treating as failure: {}",
                    describe_window(window));
                kill_process(pid, handle);
                return {false, 0, elevated, false};
            }

            if (!is_alive(pid, handle))
            {
                if (!handoff_deadline)
                {
                    handoff_deadline = std::chrono::steady_clock::now() + HANDOFF_GRACE;
                }
                else if (std::chrono::steady_clock::now() >= *handoff_deadline)
                {
                    utils::logger::write("[pluto] launcher exited without starting '{}'", pluto_game);
                    return {false, 0, elevated, false};
                }
            }

            std::this_thread::sleep_for(LAUNCH_POLL_INTERVAL);
        }

        utils::logger::write("[pluto] timed out waiting for '{}'", pluto_game);
        kill_process(pid, handle);
        return {false, 0, elevated, false};
    }

    launch_result launch_and_connect(const std::string& pluto_game, const std::string& endpoint, const bool elevate)
    {
        auto result = launch_via_uri(pluto_game, elevate);
        if (!result.success)
        {
            return result;
        }

        // A high-IL bootstrapper would cost two more UAC prompts (kill and relaunch), so it stays up unconnected.
        if (result.elevated && !utils::nt::is_elevated())
        {
            utils::logger::write("[pluto] bootstrapper pid {} is elevated, not relaunching to connect", result.bootstrapper_pid);
            return result;
        }

        // Never logged: it carries the session token.
        const auto args = strip_program(utils::nt::get_process_command_line(result.bootstrapper_pid));
        if (!has_session_token(args))
        {
            utils::logger::write("[pluto] no session token readable on bootstrapper pid {}, not relaunching to connect",
                result.bootstrapper_pid);
            return result;
        }

        if (!stop_and_wait(result.bootstrapper_pid))
        {
            utils::logger::write("[pluto] could not stop bootstrapper pid {}, leaving it unconnected", result.bootstrapper_pid);
            return result;
        }

        bool elevated = false;
        const auto pid = utils::nt::launch_process_maybe_elevated(get_bootstrapper_exe(), args + " +connect " + endpoint,
            get_root(), &elevated);
        if (!pid)
        {
            const auto error = GetLastError();
            utils::logger::write("[pluto] failed to relaunch '{}' to connect (error {})", pluto_game, error);
            return {false, 0, elevated, elevated && error == ERROR_CANCELLED, false};
        }

        utils::logger::write("[pluto] relaunched '{}' connecting to {} (bootstrapper pid {})", pluto_game, endpoint, pid);
        return {true, pid, elevated, false, true};
    }

    std::string running_game(unsigned long* pid)
    {
        const auto bootstrapper = utils::nt::find_process_id(BOOTSTRAPPER_EXE);
        if (pid) *pid = bootstrapper;
        if (!bootstrapper)
        {
            return {};
        }

        const auto args = strip_program(utils::nt::get_process_command_line(bootstrapper));
        return args.substr(0, args.find(' '));
    }

    bool send_connect(const unsigned long bootstrapper_pid, const std::string& endpoint)
    {
        const auto self = utils::nt::library{}.get_path();
        auto command_line = std::format(L"\"{}\" -pluto-connect {} -pluto-pid {}", self.wstring(),
            utils::string::convert(endpoint), bootstrapper_pid);

        STARTUPINFOW startup_info{};
        startup_info.cb = sizeof(startup_info);
        PROCESS_INFORMATION process_info{};
        if (!CreateProcessW(self.wstring().data(), command_line.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr,
            &startup_info, &process_info))
        {
            utils::logger::write("[pluto] failed to start connect worker (error {})", GetLastError());
            return false;
        }

        CloseHandle(process_info.hThread);
        const auto close_process = utils::finally([&]()
        {
            CloseHandle(process_info.hProcess);
        });

        if (WaitForSingleObject(process_info.hProcess, CONNECT_WORKER_TIMEOUT_MS) != WAIT_OBJECT_0)
        {
            TerminateProcess(process_info.hProcess, 1);
            utils::logger::write("[pluto] connect worker timed out for pid {}", bootstrapper_pid);
            return false;
        }

        DWORD code = 1;
        GetExitCodeProcess(process_info.hProcess, &code);
        utils::logger::write("[pluto] connect worker for pid {} to {} exited {}", bootstrapper_pid, endpoint, code);
        return code == 0;
    }

    int run_connect_worker(const unsigned long bootstrapper_pid, const std::string& endpoint)
    {
        // Re-checked here since anything local can start this mode: a console line must stay a single connect.
        if (!bootstrapper_pid || endpoint.empty() || endpoint.find_first_not_of("0123456789.:") != std::string::npos)
        {
            return 1;
        }

        // A process holds one console at a time, so drop ours (if any) before taking the game's.
        FreeConsole();
        if (!AttachConsole(bootstrapper_pid))
        {
            return 2;
        }

        const auto detach = utils::finally([]()
        {
            FreeConsole();
        });

        auto* const input = CreateFileW(L"CONIN$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            nullptr, OPEN_EXISTING, 0, nullptr);
        if (input == INVALID_HANDLE_VALUE)
        {
            return 3;
        }

        const auto close_input = utils::finally([&]()
        {
            CloseHandle(input);
        });

        std::vector<INPUT_RECORD> events;
        for (const auto character : "connect " + endpoint + "\r")
        {
            INPUT_RECORD event{};
            event.EventType = KEY_EVENT;
            event.Event.KeyEvent.bKeyDown = TRUE;
            event.Event.KeyEvent.wRepeatCount = 1;
            event.Event.KeyEvent.wVirtualKeyCode = character == '\r' ? VK_RETURN : 0;
            event.Event.KeyEvent.uChar.UnicodeChar = static_cast<wchar_t>(character);
            events.push_back(event);
            event.Event.KeyEvent.bKeyDown = FALSE;
            events.push_back(event);
        }

        DWORD written = 0;
        return WriteConsoleInputW(input, events.data(), static_cast<DWORD>(events.size()), &written)
            && written == events.size() ? 0 : 4;
    }

    launch_result launch_lan(const std::string& pluto_game, const std::filesystem::path& game_path,
        const std::string& player_name, const bool elevate)
    {
        const auto exe = get_bootstrapper_exe();
        if (exe.empty() || !utils::io::file_exists(exe))
        {
            utils::logger::write("[pluto] bootstrapper missing, cannot LAN launch '{}'", pluto_game);
            return {};
        }

        if (const auto existing = utils::nt::find_process_id(BOOTSTRAPPER_EXE))
        {
            utils::logger::write("[pluto] bootstrapper already running (pid {}), refusing to LAN launch '{}'",
                existing, pluto_game);
            return {};
        }

        auto args = std::format("{} \"{}\" -lan", pluto_game, utils::string::path_to_utf8(game_path));
        if (!player_name.empty())
        {
            args += player_name.find_first_of(" 	") == std::string::npos
                ? std::format(" -name {}", player_name)
                : std::format(" -name \"{}\"", player_name);
        }

        auto elevated = elevate;
        HANDLE handle = nullptr;
        const auto pid = elevate
            ? utils::nt::launch_process_elevated(exe, args, get_root(), &handle)
            : utils::nt::launch_process_maybe_elevated(exe, args, get_root(), &elevated, &handle);

        if (handle) CloseHandle(handle);

        if (!pid)
        {
            const auto error = GetLastError();
            utils::logger::write("[pluto] failed to LAN launch '{}' (error {})", pluto_game, error);
            return {false, 0, elevated, elevated && error == ERROR_CANCELLED};
        }

        utils::logger::write("[pluto] LAN launched '{}' (bootstrapper pid {}{})", pluto_game, pid,
            elevated ? ", elevated" : "");
        return {true, pid, elevated, false};
    }
}
