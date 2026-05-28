#include "std_include.hpp"
#include "ui_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/com.hpp>
#include <utils/http.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>

#include "redist/redist_installer.hpp"
#include "redist/redist_packages.hpp"

#include "game_config.hpp"

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
                const auto path = value["path"].GetString();
                const auto wide_path = std::wstring(path, path + strlen(path));
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
            cef_ui.close_browser();
        });

        cef_ui.add_command("minimize", [&cef_ui](const auto&, auto&)
        {
            ShowWindow(cef_ui.get_window(), SW_MINIMIZE);
        });

        cef_ui.add_command("show", [&cef_ui](const auto&, auto&)
        {
            auto* const window = cef_ui.get_window();
            ShowWindow(window, SW_SHOWDEFAULT);
            SetForegroundWindow(window);

            PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);
        });

        cef_ui.add_command("open-url", [](const rapidjson::Value& value, auto&)
        {
            if (value.IsObject() && value.HasMember("url") && value["url"].IsString())
            {
                const auto url = value["url"].GetString();
                ShellExecuteA(nullptr, "open", url, nullptr, nullptr, SW_SHOWNORMAL);
            }
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

        cef_ui.add_command("get-discord-info", [](const auto&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto result = utils::http::get_data(
                "https://discord.com/api/v10/invites/WyJQCwCCGW?with_counts=true",
                {}, {}, {}, 5, 1);

            if (!result || result->response_code != 200)
            {
                response.AddMember("ok", false, allocator);
                return;
            }

            rapidjson::Document doc;
            doc.Parse(result->buffer.data(), result->buffer.size());

            if (doc.HasParseError() || !doc.IsObject())
            {
                response.AddMember("ok", false, allocator);
                return;
            }

            response.AddMember("ok", true, allocator);
            if (doc.HasMember("approximate_member_count") && doc["approximate_member_count"].IsInt())
            {
                response.AddMember("total", doc["approximate_member_count"].GetInt(), allocator);
            }
            if (doc.HasMember("approximate_presence_count") && doc["approximate_presence_count"].IsInt())
            {
                response.AddMember("online", doc["approximate_presence_count"].GetInt(), allocator);
            }
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
