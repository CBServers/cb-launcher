#include <std_include.hpp>

#include "cef/cef_ui_app.hpp"

namespace cef
{
	cef_ui_app::cef_ui_app() = default;

	void cef_ui_app::OnContextInitialized()
	{
		CEF_REQUIRE_UI_THREAD();
	}

	void cef_ui_app::OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> command_line)
	{
		command_line->AppendSwitch("cb-subprocess");
	}

	void cef_ui_app::OnBeforeCommandLineProcessing(const CefString& /*process_type*/,
	                                               CefRefPtr<CefCommandLine> command_line)
	{
		command_line->AppendSwitch("enable-experimental-web-platform-features");
		command_line->AppendSwitch("in-process-gpu");
		command_line->AppendSwitchWithValue("default-encoding", "utf-8");
	}
}
