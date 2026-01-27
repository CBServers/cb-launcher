#include "std_include.hpp"
#include "ui_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/com.hpp>

namespace commands::ui_commands
{
	void register_commands(cef::cef_ui& cef_ui, command_context&)
	{
		cef_ui.add_command("browse-folder", [](const auto&, rapidjson::Document& response)
		{
			response.SetNull();

			std::string folder;
			if (utils::com::select_folder(folder))
			{
				response.SetString(folder, response.GetAllocator());
			}
		});

		cef_ui.add_command("open-folder", [](const rapidjson::Value& value, auto&)
		{
			if (value.IsObject() && value.HasMember("path") && value["path"].IsString())
			{
				const auto path = value["path"].GetString();
				const auto wide_path = std::wstring(path, path + strlen(path));
				ShellExecuteW(nullptr, L"explore", wide_path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
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

		cef_ui.add_command("install-redist", [](const rapidjson::Value&, auto&)
		{
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
					AllocConsole();
					FILE* fp;
					freopen_s(&fp, "CONOUT$", "w", stdout);
					freopen_s(&fp, "CONOUT$", "w", stderr);
					console_allocated = true;
				}
				ShowWindow(GetConsoleWindow(), SW_SHOW);
			}
			else
			{
				if (console_allocated)
				{
					ShowWindow(GetConsoleWindow(), SW_HIDE);
				}
			}

			response.SetObject();
			response.AddMember("success", true, response.GetAllocator());
		});
	}
}
