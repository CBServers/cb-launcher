#include "std_include.hpp"
#include "ui_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/com.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

#include "redist/redist_installer.hpp"
#include "redist/redist_packages.hpp"
#include "updater/detection_service.hpp"

#include "game_config.hpp"
#include "deep_link.hpp"

#include <utils/io.hpp>

#include <cctype>
#include <cwchar>

namespace commands::ui_commands
{
    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("browse-folder", [&cef_ui](const auto&, rapidjson::Document& response)
        {
            response.SetNull();

            try
            {
                std::string folder;
                if (utils::com::select_folder(folder))
                {
                    response.SetString(folder, response.GetAllocator());
                }
            }
            catch (const std::exception& e)
            {
                printf("browse-folder failed: %s\n", e.what());
                if (utils::nt::is_wine_environment())
                {
                    cef_ui.show_message_box("Browse Failed", "Folder browser is not available under Wine. Please paste the game path manually.");
                }
            }
        });

        cef_ui.add_command("open-folder", [](const rapidjson::Value& value, auto&)
        {
            if (value.IsObject() && value.HasMember("path") && value["path"].IsString())
            {
                const auto wide_path = utils::string::convert(value["path"].GetString());
                const auto result = ShellExecuteW(nullptr, L"explore", wide_path.data(), nullptr, nullptr, SW_SHOWNORMAL);

                // Under Wine, "explore" may fail — fall back to "open" which Wine can route to xdg-open
                if (reinterpret_cast<INT_PTR>(result) <= 32 && utils::nt::is_wine_environment())
                {
                    ShellExecuteW(nullptr, L"open", wide_path.data(), nullptr, nullptr, SW_SHOWNORMAL);
                }
            }
        });

        cef_ui.add_command("open-logs", [](const auto&, auto&)
        {
            const auto wide_path = utils::properties::get_appdata_path().wstring();
            const auto result = ShellExecuteW(nullptr, L"explore", wide_path.data(), nullptr, nullptr, SW_SHOWNORMAL);

            if (reinterpret_cast<INT_PTR>(result) <= 32 && utils::nt::is_wine_environment())
            {
                ShellExecuteW(nullptr, L"open", wide_path.data(), nullptr, nullptr, SW_SHOWNORMAL);
            }
        });

        cef_ui.add_command("close", [&cef_ui](const auto&, auto&)
        {
            // Mark closing first so the teardown resize doesn't overwrite the saved placement.
            if (auto* const window = cef_ui.get_window())
            {
                SetPropA(window, "cb_closing", reinterpret_cast<HANDLE>(1));
            }
            cef_ui.close_browser();
        });

        cef_ui.add_command("minimize", [&cef_ui](const auto&, auto&)
        {
            ShowWindow(cef_ui.get_window(), SW_MINIMIZE);
        });

        cef_ui.add_command("toggle-maximize", [&cef_ui](const auto&, auto&)
        {
            auto* const window = cef_ui.get_window();
            ShowWindow(window, IsZoomed(window) ? SW_RESTORE : SW_MAXIMIZE);
        });

        cef_ui.add_command("is-maximized", [&cef_ui](const auto&, rapidjson::Document& response)
        {
            response.SetBool(IsZoomed(cef_ui.get_window()) != FALSE);
        });

        cef_ui.add_command("show", [&cef_ui](const auto&, auto&)
        {
            auto* const window = cef_ui.get_window();

            // Preserve the window's current state. SW_SHOWDEFAULT would un-maximize a
            // window that was restored maximized on launch, and clobber the saved flag.
            if (IsIconic(window))
            {
                ShowWindow(window, SW_RESTORE);
            }
            else if (IsZoomed(window))
            {
                ShowWindow(window, SW_SHOWMAXIMIZED);
            }
            else
            {
                ShowWindow(window, SW_SHOWNORMAL);
            }

            SetForegroundWindow(window);

            PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);

            // The frontend calls "show" once init completes; flush any queued deep links.
            cef_ui.notify_frontend_ready();

            // Stamp legacy installs in the background once the UI is up; no-op after the first call.
            detection_service::start_sweep();
        });

        cef_ui.add_command("flash-taskbar", [&cef_ui](const auto&, auto&)
        {
            auto* const window = cef_ui.get_window();
            if (!window || GetForegroundWindow() == window) return; // already focused; nothing to flash

            FLASHWINFO fi{};
            fi.cbSize = sizeof(fi);
            fi.hwnd = window;
            fi.dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG; // flash until the launcher is brought to front
            FlashWindowEx(&fi);
        });

        cef_ui.add_command("open-url", [](const rapidjson::Value& value, auto&)
        {
            if (value.IsObject() && value.HasMember("url") && value["url"].IsString())
            {
                const auto url = value["url"].GetString();
                ShellExecuteA(nullptr, "open", url, nullptr, nullptr, SW_SHOWNORMAL);
            }
        });

        cef_ui.add_command("create-game-shortcut", [](const rapidjson::Value& request, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            response.AddMember("success", false, allocator);

            const auto set_error = [&](const char* msg)
            {
                response.AddMember("error", rapidjson::Value(msg, allocator), allocator);
            };

            // Wine can't consume a Windows .lnk, so don't pretend it worked.
            if (utils::nt::is_wine_environment())
            {
                set_error("unsupported-on-wine");
                return;
            }

            if (!request.IsObject() || !request.HasMember("game") || !request["game"].IsString())
            {
                set_error("missing-game");
                return;
            }

            // Slug is both the deep-link target and the icon folder name; keep it strict [a-z0-9-].
            std::string slug;
            for (const char c : std::string(request["game"].GetString()))
            {
                const auto lc = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                if ((lc >= 'a' && lc <= 'z') || (lc >= '0' && lc <= '9') || lc == '-') slug.push_back(lc);
            }
            if (slug.empty())
            {
                set_error("invalid-game");
                return;
            }

            // Only known games get shortcuts; the slug doubles as the deep-link target.
            const auto mapping = game_config::ui_to_backend_mapping_.find(slug);
            const auto& backend_key = mapping != game_config::ui_to_backend_mapping_.end() ? mapping->second : slug;
            if (!game_config::get_game_config(backend_key).has_value())
            {
                set_error("invalid-game");
                return;
            }

            // Display name -> safe .lnk filename (UTF-8 aware; strip filesystem-illegal chars).
            const std::string name = (request.HasMember("name") && request["name"].IsString())
                ? request["name"].GetString() : slug;
            std::wstring safe_name;
            for (const wchar_t wc : utils::string::convert(name))
            {
                if (wc < 0x20 || std::wcschr(L"<>:\"/\\|?*", wc)) continue;
                safe_name.push_back(wc);
            }
            while (!safe_name.empty() && safe_name.front() == L' ') safe_name.erase(safe_name.begin());
            while (!safe_name.empty() && (safe_name.back() == L' ' || safe_name.back() == L'.')) safe_name.pop_back();
            if (safe_name.empty()) safe_name = utils::string::convert(slug);

            const auto url = std::string(deep_link::SCHEME) + "://play/" + slug;

            // Per-game .ico from the launcher-ui assets, else the launcher's own embedded icon.
            std::filesystem::path icon = utils::nt::library{}.get_path();
            if (request.HasMember("icon") && request["icon"].IsString())
            {
                const std::string rel = request["icon"].GetString();
                if (!rel.empty() && rel.rfind("assets/", 0) == 0 && rel.find("..") == std::string::npos)
                {
                    const auto appdata = utils::properties::get_appdata_path();
                    const auto candidate = appdata / "data" / "launcher-ui" / utils::string::utf8_to_path(rel);
                    std::error_code ec;
                    if (std::filesystem::exists(candidate, ec)) icon = candidate;
                }
            }

            // Steam-style .url; UTF-16LE+BOM so the shell's ANSI INI parser can't mangle non-ASCII paths.
            const auto write_url = [&](const std::filesystem::path& file) -> bool
            {
                const std::wstring content = L"[InternetShortcut]\r\nURL=" + utils::string::convert(url) +
                    L"\r\nIconIndex=0\r\nIconFile=" + icon.wstring() + L"\r\n";

                std::string bytes = "\xFF\xFE";
                bytes.append(reinterpret_cast<const char*>(content.data()), content.size() * sizeof(wchar_t));
                return utils::io::write_file(file, bytes);
            };

            bool any = false;
            rapidjson::Value paths(rapidjson::kArrayType);
            const auto record = [&](const std::filesystem::path& file)
            {
                if (write_url(file))
                {
                    any = true;
                    paths.PushBack(rapidjson::Value(utils::string::path_to_utf8(file), allocator), allocator);
                }
            };

            // Desktop copy.
            const auto desktop = utils::com::get_desktop_path();
            if (!desktop.empty()) record(desktop / (safe_name + L".url"));

            // Start Menu copy (makes the game searchable from the Windows Start menu).
            const auto programs = utils::com::get_start_menu_programs_path();
            if (!programs.empty())
            {
                const auto sm_dir = programs / L"CB Servers";
                std::error_code ec;
                std::filesystem::create_directories(sm_dir, ec);
                record(sm_dir / (safe_name + L".url"));
            }

            if (any)
            {
                response["success"].SetBool(true);
                response.AddMember("paths", paths, allocator);
            }
            else
            {
                set_error("create-failed");
            }
        });

        cef_ui.add_command("relaunch-online", [](const auto&, rapidjson::Document& response)
        {
            response.SetBool(true);
            utils::nt::relaunch_self(""); // empty args drops -offline
            utils::nt::terminate();
        });

        cef_ui.add_command("install-redist", [&cef_ui](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetBool(false);

            if (utils::nt::is_wine_environment())
            {
                cef_ui.show_message_box("Not Required", "Redistributables are not needed when running under Proton/Wine. Your system libraries handle this automatically.");
                return;
            }

            std::vector<std::string> ids;
            if (value.IsObject() && value.HasMember("ids") && value["ids"].IsArray())
            {
                for (const auto& v : value["ids"].GetArray())
                {
                    if (v.IsString()) ids.emplace_back(v.GetString());
                }
            }

            response.SetBool(redist::redist_installer::instance().start_install(ids));
        });

        cef_ui.add_command("refresh-redist", [](const auto&, rapidjson::Document& response)
        {
            redist::redist_installer::instance().refresh_detection();
            response.SetBool(true);
        });

        cef_ui.add_command("get-redist-progress", [](const auto&, rapidjson::Document& response)
        {
            const auto state = redist::redist_installer::instance().get_state();
            const auto& defs = redist::all_packages();

            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto str = [&allocator](const std::string& s)
            {
                rapidjson::Value v;
                v.SetString(s.data(), static_cast<rapidjson::SizeType>(s.length()), allocator);
                return v;
            };

            const auto find_def = [&defs](const std::string& id) -> const redist::package_def*
            {
                for (const auto& d : defs) if (d.id == id) return &d;
                return nullptr;
            };

            response.AddMember("running", state.running, allocator);
            response.AddMember("finished", state.finished, allocator);
            response.AddMember("message", str(state.overall_message), allocator);

            rapidjson::Value packages(rapidjson::kArrayType);
            for (const auto& p : state.packages)
            {
                const char* status_str = "unknown";
                switch (p.status)
                {
                    case redist::package_status::installed: status_str = "installed"; break;
                    case redist::package_status::pending: status_str = "pending"; break;
                    case redist::package_status::downloading: status_str = "downloading"; break;
                    case redist::package_status::installing: status_str = "installing"; break;
                    case redist::package_status::completed: status_str = "completed"; break;
                    case redist::package_status::failed: status_str = "failed"; break;
                    case redist::package_status::unknown: break;
                }

                const auto* def = find_def(p.id);

                rapidjson::Value obj(rapidjson::kObjectType);
                obj.AddMember("id", str(p.id), allocator);
                obj.AddMember("name", str(p.name), allocator);
                obj.AddMember("group_id", str(def ? def->group_id : p.id), allocator);
                obj.AddMember("group_name", str(def ? def->group_name : p.name), allocator);
                obj.AddMember("arch", str(def ? def->arch : std::string{}), allocator);
                obj.AddMember("status", str(status_str), allocator);
                obj.AddMember("progress", p.progress_percent, allocator);
                obj.AddMember("error", str(p.error), allocator);
                packages.PushBack(obj, allocator);
            }
            response.AddMember("packages", packages, allocator);
        });

        cef_ui.add_command("get-missing-redists-for-game", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto str = [&allocator](const std::string& s)
            {
                rapidjson::Value v;
                v.SetString(s.data(), static_cast<rapidjson::SizeType>(s.length()), allocator);
                return v;
            };

            rapidjson::Value missing(rapidjson::kArrayType);

            if (utils::nt::is_wine_environment())
            {
                response.AddMember("missing", missing, allocator);
                return;
            }

            if (!value.IsObject() || !value.HasMember("game") || !value["game"].IsString())
            {
                response.AddMember("missing", missing, allocator);
                return;
            }

            const std::string game = value["game"].GetString();
            const auto required = game_config::resolve_required_redists(game);
            const auto groups = redist::redist_installer::instance().get_missing(required);

            for (const auto& g : groups)
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                obj.AddMember("group_id", str(g.group_id), allocator);
                obj.AddMember("group_name", str(g.group_name), allocator);

                rapidjson::Value archs(rapidjson::kArrayType);
                for (const auto& arch : g.archs) archs.PushBack(str(arch), allocator);
                obj.AddMember("archs", archs, allocator);

                missing.PushBack(obj, allocator);
            }

            response.AddMember("missing", missing, allocator);
        });

        cef_ui.add_command("set-console-visible", [](const rapidjson::Value& request, rapidjson::Document& response)
        {
            static bool console_allocated = false;

            bool visible = false;
            if (request.HasMember("visible") && request["visible"].IsBool())
            {
                visible = request["visible"].GetBool();
            }

            if (visible)
            {
                if (!console_allocated)
                {
                    if (AllocConsole())
                    {
                        FILE* fp;
                        freopen_s(&fp, "CONOUT$", "w", stdout);
                        freopen_s(&fp, "CONOUT$", "w", stderr);
                        console_allocated = true;
                    }
                }

                const auto console_window = GetConsoleWindow();
                if (console_window)
                {
                    ShowWindow(console_window, SW_SHOW);
                }
            }
            else
            {
                if (console_allocated)
                {
                    const auto console_window = GetConsoleWindow();
                    if (console_window)
                    {
                        ShowWindow(console_window, SW_HIDE);
                    }
                }
            }

            response.SetObject();
            response.AddMember("success", true, response.GetAllocator());
        });
    }
}
