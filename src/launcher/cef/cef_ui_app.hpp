#pragma once

namespace cef
{
	class cef_ui_app : public CefApp, public CefBrowserProcessHandler
	{
	public:
		cef_ui_app();

		CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override
		{
			return this;
		}

		void OnContextInitialized() override;
		void OnBeforeChildProcessLaunch(CefRefPtr<CefCommandLine> command_line) override;

	protected:
		void OnBeforeCommandLineProcessing(const CefString& process_type,
		                                   CefRefPtr<CefCommandLine> command_line) override;


	private:
	IMPLEMENT_REFCOUNTING(cef_ui_app);
	};
}
