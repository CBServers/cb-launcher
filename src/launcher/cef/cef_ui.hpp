#pragma once

#include <utils/nt.hpp>
#include "cef_ui_handler.hpp"

namespace cef
{
	class cef_ui
	{
	public:
		using command_handler = std::function<void(const rapidjson::Value& request, rapidjson::Document& response)>;
		using command_handlers = std::unordered_map<std::string, command_handler>;

		cef_ui(utils::nt::library process, std::filesystem::path path);
		~cef_ui();

		HWND get_window() const;

		void close_browser();
		void reload_browser() const;

		int run_process() const;
		void create(const std::filesystem::path& folder, const std::string& file);
		static void work_once();
		static void work();

		void add_command(std::string command, command_handler handler);

	private:
		utils::nt::library process_;
		bool initialized_ = false;
		command_handlers command_handlers_;

		std::filesystem::path path_;
		CefRefPtr<CefBrowser> browser_;
		CefRefPtr<cef_ui_handler> ui_handler_;

		static void invoke_close_browser(CefRefPtr<CefBrowser> browser);
	};
}
