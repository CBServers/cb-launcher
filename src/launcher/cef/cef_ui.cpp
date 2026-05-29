#include <std_include.hpp>

#include "cef/cef_ui.hpp"
#include "cef/cef_ui_app.hpp"
#include "cef/cef_ui_handler.hpp"
#include "cef/cef_ui_scheme_handler.hpp"

#include <utils/nt.hpp>
#include <utils/string.hpp>
#include <utils/properties.hpp>

namespace cef
{
    namespace
    {
        struct startup_bounds
        {
            int x;
            int y;
            int width;
            int height;
            bool maximized;
        };

        UINT get_monitor_dpi(const HMONITOR monitor)
        {
            const utils::nt::library shcore{"shcore.dll"};
            const auto get_dpi = shcore
                ? shcore.get_proc<HRESULT(WINAPI*)(HMONITOR, int, UINT*, UINT*)>("GetDpiForMonitor")
                : nullptr;

            if (get_dpi)
            {
                UINT dpi_x = USER_DEFAULT_SCREEN_DPI, dpi_y = USER_DEFAULT_SCREEN_DPI;
                if (SUCCEEDED(get_dpi(monitor, 0 /*MDT_EFFECTIVE_DPI*/, &dpi_x, &dpi_y)) && dpi_x)
                {
                    return dpi_x;
                }
            }

            return USER_DEFAULT_SCREEN_DPI;
        }

        std::optional<int> load_int(const std::string& name)
        {
            const auto value = utils::properties::load(name);
            if (!value) return std::nullopt;

            try
            {
                size_t consumed = 0;
                const auto parsed = std::stoi(*value, &consumed);
                if (consumed == 0) return std::nullopt;
                return parsed;
            }
            catch (const std::exception&)
            {
                return std::nullopt;
            }
        }

        startup_bounds compute_startup_bounds()
        {
            const auto saved_x = load_int("launcher-window-x");
            const auto saved_y = load_int("launcher-window-y");
            const auto saved_w = load_int("launcher-window-w");
            const auto saved_h = load_int("launcher-window-h");
            const bool maximized = utils::properties::load("launcher-window-maximized").value_or("0") == "1";

            // Restore a previously saved placement if it still lands on a connected monitor.
            if (saved_x && saved_y && saved_w && saved_h && *saved_w > 0 && *saved_h > 0)
            {
                RECT saved{*saved_x, *saved_y, *saved_x + *saved_w, *saved_y + *saved_h};
                const auto monitor = MonitorFromRect(&saved, MONITOR_DEFAULTTONULL);
                if (monitor)
                {
                    MONITORINFO mi{sizeof(mi)};
                    if (GetMonitorInfoW(monitor, &mi))
                    {
                        const auto work_w = mi.rcWork.right - mi.rcWork.left;
                        const auto work_h = mi.rcWork.bottom - mi.rcWork.top;

                        auto w = (std::min)(*saved_w, static_cast<int>(work_w));
                        auto h = (std::min)(*saved_h, static_cast<int>(work_h));
                        auto x = (std::max)(static_cast<int>(mi.rcWork.left),
                                            (std::min)(*saved_x, static_cast<int>(mi.rcWork.right - w)));
                        auto y = (std::max)(static_cast<int>(mi.rcWork.top),
                                            (std::min)(*saved_y, static_cast<int>(mi.rcWork.bottom - h)));
                        return {x, y, w, h, maximized};
                    }
                }
            }

            // First launch (or saved placement no longer valid): center a DPI-scaled default on
            // the primary monitor, clamped to its work area so it never opens off-screen.
            const auto monitor = MonitorFromPoint(POINT{0, 0}, MONITOR_DEFAULTTOPRIMARY);
            MONITORINFO mi{sizeof(mi)};
            if (!GetMonitorInfoW(monitor, &mi))
            {
                return {CW_USEDEFAULT, CW_USEDEFAULT, LAUNCHER_WINDOW_WIDTH, LAUNCHER_WINDOW_HEIGHT, false};
            }

            const auto scale = static_cast<double>(get_monitor_dpi(monitor)) / USER_DEFAULT_SCREEN_DPI;
            const auto work_w = static_cast<int>(mi.rcWork.right - mi.rcWork.left);
            const auto work_h = static_cast<int>(mi.rcWork.bottom - mi.rcWork.top);

            const auto w = (std::min)(static_cast<int>(LAUNCHER_WINDOW_WIDTH * scale), work_w);
            const auto h = (std::min)(static_cast<int>(LAUNCHER_WINDOW_HEIGHT * scale), work_h);
            const auto x = static_cast<int>(mi.rcWork.left) + (work_w - w) / 2;
            const auto y = static_cast<int>(mi.rcWork.top) + (work_h - h) / 2;
            return {x, y, w, h, false};
        }

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

        const auto bounds = compute_startup_bounds();

        CefWindowInfo window_info;
        window_info.SetAsPopup(nullptr, "CB Servers"s);
        window_info.bounds.width = bounds.width;
        window_info.bounds.height = bounds.height;
        window_info.bounds.x = bounds.x;
        window_info.bounds.y = bounds.y;
        window_info.style = WS_POPUP | WS_THICKFRAME | WS_CAPTION | WS_MAXIMIZEBOX | WS_MINIMIZEBOX;

        if (!this->ui_handler_)
        {
            this->ui_handler_ = new cef_ui_handler();
        }

        const auto url = "http://cbservers/" + file;
        this->browser_ = CefBrowserHost::CreateBrowserSync(window_info, this->ui_handler_, url, browser_settings,
                                                           nullptr, nullptr);

        if (bounds.maximized)
        {
            ShowWindow(this->get_window(), SW_MAXIMIZE);
        }
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
