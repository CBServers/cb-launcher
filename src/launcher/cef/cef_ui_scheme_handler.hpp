#pragma once

namespace cef
{
	class cef_ui_scheme_handler_factory : public CefSchemeHandlerFactory
	{
	public:
		using command_handler = std::function<void(const rapidjson::Value& request, rapidjson::Document& response)>;
		using command_handlers = std::unordered_map<std::string, command_handler>;

		cef_ui_scheme_handler_factory(std::filesystem::path folder, const command_handlers& command_handlers);

		CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
		                                     CefRefPtr<CefFrame> frame,
		                                     const CefString& scheme_name,
		                                     CefRefPtr<CefRequest> request) override;

	private:
		std::filesystem::path folder_;
		const command_handlers& command_handlers_;

		IMPLEMENT_REFCOUNTING(cef_ui_scheme_handler_factory);
		DISALLOW_COPY_AND_ASSIGN(cef_ui_scheme_handler_factory);

		CefResourceHandler* handle_command(const CefRefPtr<CefRequest>& request, const std::string& path) const;
	};
}
