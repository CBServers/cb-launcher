#include <std_include.hpp>

#include "cef/cef_ui.hpp"
#include "cef/cef_ui_app.hpp"
#include "cef/cef_ui_handler.hpp"
#include "cef/cef_ui_scheme_handler.hpp"

#include <utils/nt.hpp>
#include <utils/string.hpp>

namespace cef
{
    namespace
    {
        void delay_load_cef(const std::filesystem::path& path)
        {
            static std::atomic initialized{false};
            auto uninitialized = false;
            if (!initialized.compare_exchange_strong(uninitialized, true))
            {
                return;
            }

            // Absolute-path load instead of SetDllDirectory + leaf-name load.
            // Some processes add_dll_directory covers any runtime LoadLibrary calls libcef itself makes for sibling DLLs.
            utils::nt::library::add_dll_directory(path);

            if (!utils::nt::library::load(path / "libcef.dll")
                || !utils::nt::library::delay_load("libcef.dll"s))
            {
                throw std::runtime_error("Failed to load CEF");
            }
        }
    }

    void cef_ui::work_once()
    {
        CefDoMessageLoopWork();
    }

    void cef_ui::work()
    {
        CefRunMessageLoop();
    }

    void cef_ui::add_command(std::string command, command_handler handler)
    {
        this->command_handlers_[std::move(command)] = std::move(handler);
    }

    int cef_ui::run_process() const
    {
        const CefMainArgs args(this->process_.get_handle());
        return CefExecuteProcess(args, nullptr, nullptr);
    }

    void cef_ui::create(const std::filesystem::path& folder, const std::string& file)
    {
        if (this->browser_) return;

        CefMainArgs args(this->process_.get_handle());

        CefSettings settings;
        settings.no_sandbox = TRUE;
        //settings.single_process = TRUE;
        //settings.windowless_rendering_enabled = TRUE;
        //settings.pack_loading_disabled = FALSE;

#ifdef DEBUG
            settings.remote_debugging_port = 12345;
#endif

#ifdef DEBUG
        settings.log_severity = LOGSEVERITY_VERBOSE;
#else
        settings.log_severity = LOGSEVERITY_DISABLE;
#endif

        CefString(&settings.browser_subprocess_path) = this->process_.get_path();
        CefString(&settings.locales_dir_path) = this->path_ / "data" / "cef" / CONFIG_NAME / "locales";
        CefString(&settings.resources_dir_path) = this->path_ / "data" / "cef" / CONFIG_NAME;
        CefString(&settings.log_file) = this->path_ / "user" / "cef-data" / "debug.log";
        CefString(&settings.user_data_path) = this->path_ / "user" / "cef-data" / "user";
        CefString(&settings.cache_path) = this->path_ / "user" / "cef-data" / "cache";
        CefString(&settings.locale) = "en-US";

        this->initialized_ = CefInitialize(args, settings, new cef_ui_app(), nullptr);
        CefRegisterSchemeHandlerFactory("http", "cbservers", new cef_ui_scheme_handler_factory(folder, this->command_handlers_));

        CefBrowserSettings browser_settings;
        //browser_settings.windowless_frame_rate = 60;

        CefWindowInfo window_info;
        window_info.SetAsPopup(nullptr, "CB Servers"s);
        window_info.bounds.width = LAUNCHER_WINDOW_WIDTH; //GetSystemMetrics(SM_CXVIRTUALSCREEN);
        window_info.bounds.height = LAUNCHER_WINDOW_HEIGHT; //GetSystemMetrics(SM_CYVIRTUALSCREEN);
        window_info.bounds.x = (GetSystemMetrics(SM_CXSCREEN) - window_info.bounds.width) / 2;
        window_info.bounds.y = (GetSystemMetrics(SM_CYSCREEN) - window_info.bounds.height) / 2;
        window_info.style = WS_POPUP | WS_THICKFRAME | WS_CAPTION;

        if (!this->ui_handler_)
        {
            this->ui_handler_ = new cef_ui_handler();
        }

        const auto url = "http://cbservers/" + file;
        this->browser_ = CefBrowserHost::CreateBrowserSync(window_info, this->ui_handler_, url, browser_settings,
                                                           nullptr, nullptr);
    }

    HWND cef_ui::get_window() const
    {
        if (!this->browser_) return nullptr;
        return this->browser_->GetHost()->GetWindowHandle();
    }

    void cef_ui::invoke_close_browser(CefRefPtr<CefBrowser> browser)
    {
        if (!browser) return;
        browser->GetHost()->CloseBrowser(true);
    }

    void cef_ui::invoke_show_message_box(CefRefPtr<CefBrowser> browser, const std::string& title, const std::string& msg)
    {
        if (!browser) return;
        auto frame = browser->GetMainFrame();
        if (!frame) return;

        // Escape single quotes in title and message for JavaScript
        auto escape_js_string = [](const std::string& str) -> std::string
        {
            std::string escaped;
            escaped.reserve(str.size());
            for (char c : str)
            {
                if (c == '\'') escaped += "\\'";
                else if (c == '\\') escaped += "\\\\";
                else if (c == '\n') escaped += "\\n";
                else if (c == '\r') escaped += "\\r";
                else escaped += c;
            }
            return escaped;
        };

        const auto escaped_title = escape_js_string(title);
        const auto escaped_msg = escape_js_string(msg);
        const auto js_code = utils::string::va(
            "if (typeof window.showMessageBox === 'function') { window.showMessageBox('%s', '%s', ['OK']); }",
            escaped_title.data(), escaped_msg.data());

        frame->ExecuteJavaScript(js_code, frame->GetURL(), 0);
    }

    void cef_ui::close_browser()
    {
        if (!this->browser_) return;
        CefPostTask(TID_UI, base::BindOnce(&cef_ui::invoke_close_browser, this->browser_));
        this->browser_ = nullptr;
    }

    void cef_ui::reload_browser() const
    {
        if (!this->browser_) return;
        this->browser_->Reload();
    }

    void cef_ui::execute_javascript(const std::string& code) const
    {
        if (!this->browser_) return;
        auto frame = this->browser_->GetMainFrame();
        if (frame)
        {
            frame->ExecuteJavaScript(code, frame->GetURL(), 0);
        }
    }

    void cef_ui::show_message_box(const std::string& title, const std::string& msg) const
    {
        if (!this->browser_) return;
        // Post to UI thread to avoid crashes when called from other threads (e.g., updater thread)
        CefPostTask(TID_UI, base::BindOnce(&cef_ui::invoke_show_message_box, this->browser_, title, msg));
    }

    void cef_ui::invoke_show_toast(CefRefPtr<CefBrowser> browser, const std::string& message, const std::string& type, int duration_ms)
    {
        if (!browser) return;
        auto frame = browser->GetMainFrame();
        if (!frame) return;

        auto escape_js_string = [](const std::string& str) -> std::string
        {
            std::string escaped;
            escaped.reserve(str.size());
            for (char c : str)
            {
                if (c == '\'') escaped += "\\'";
                else if (c == '\\') escaped += "\\\\";
                else if (c == '\n') escaped += "\\n";
                else if (c == '\r') escaped += "\\r";
                else escaped += c;
            }
            return escaped;
        };

        const auto escaped_msg = escape_js_string(message);
        const auto escaped_type = escape_js_string(type);
        const auto js_code = utils::string::va(
            "if (typeof window.showToast === 'function') { window.showToast('%s', '%s', %d); }",
            escaped_msg.data(), escaped_type.data(), duration_ms);

        frame->ExecuteJavaScript(js_code, frame->GetURL(), 0);
    }

    void cef_ui::show_toast(const std::string& message, const std::string& type, int duration_ms) const
    {
        if (!this->browser_) return;
        CefPostTask(TID_UI, base::BindOnce(&cef_ui::invoke_show_toast, this->browser_, message, type, duration_ms));
    }

    cef_ui::cef_ui(utils::nt::library process, std::filesystem::path path)
        : process_(std::move(process)), path_(std::move(path))
    {
        delay_load_cef(this->path_ / "data" / "cef" / CONFIG_NAME);
    }

    cef_ui::~cef_ui()
    {
        if (this->browser_ //
            && this->ui_handler_ //
            && !this->ui_handler_->is_closed(this->browser_))
        {
            this->close_browser();
            this->work();
        }

        this->browser_.reset();
        this->ui_handler_.reset();

        if (this->initialized_)
        {
            CefShutdown();
        }
    }
}
