#include "std_include.hpp"
#include "ui_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/com.hpp>
#include <utils/nt.hpp>

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
                const auto result = ShellExecuteW(nullptr, L"explore", wide_path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);

                // Under Wine, "explore" may fail — fall back to "open" which Wine can route to xdg-open
                if (reinterpret_cast<INT_PTR>(result) <= 32 && utils::nt::is_wine_environment())
                {
                    ShellExecuteW(nullptr, L"open", wide_path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                }
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

        cef_ui.add_command("install-redist", [&cef_ui](const rapidjson::Value&, auto&)
        {
            if (utils::nt::is_wine_environment())
            {
                cef_ui.show_message_box("Not Required", "Redistributables are not needed when running under Proton/Wine. Your system libraries handle this automatically.");
                return;
            }

            ShellExecuteA(nullptr, "open", "powershell",
                "-NoProfile -ExecutionPolicy Bypass -Command \"irm https://chse.sh/ri | iex\"",
                nullptr, SW_SHOWNORMAL);
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
