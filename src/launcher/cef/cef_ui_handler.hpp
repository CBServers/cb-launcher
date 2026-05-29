#pragma once

#define WM_DELAYEDDPICHANGE (WM_USER + 0x123)
#define LAUNCHER_WINDOW_WIDTH (1380)
#define LAUNCHER_WINDOW_HEIGHT (805)

// Resize limits in logical (96-DPI) pixels. Min is DPI-scaled at runtime; max is a
// generous cap that is widened to the monitor work area so it never blocks 4K+ displays.
#define LAUNCHER_WINDOW_MIN_WIDTH (960)
#define LAUNCHER_WINDOW_MIN_HEIGHT (600)
#define LAUNCHER_WINDOW_MAX_WIDTH (3840)
#define LAUNCHER_WINDOW_MAX_HEIGHT (2160)

namespace cef
{
    class cef_ui_handler : public CefClient, public CefDisplayHandler, public CefLifeSpanHandler, public CefLoadHandler,
                           public CefContextMenuHandler, public CefDragHandler
    {
    public:
        explicit cef_ui_handler();
        ~cef_ui_handler() override;

        CefRefPtr<CefDisplayHandler> GetDisplayHandler() override
        {
            return this;
        }

        CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override
        {
            return this;
        }

        CefRefPtr<CefLoadHandler> GetLoadHandler() override
        {
            return this;
        }

        CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override
        {
            return this;
        }

        CefRefPtr<CefDragHandler> GetDragHandler() override
        {
            return this;
        }

        void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
        void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

        bool DoClose(CefRefPtr<CefBrowser> browser) override;

        void OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                 CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) override;
        bool OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  CefRefPtr<CefContextMenuParams> params, int command_id,
                                  CefContextMenuHandler::EventFlags event_flags) override;
        void OnContextMenuDismissed(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame) override;
        bool RunContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model,
                            CefRefPtr<CefRunContextMenuCallback> callback) override;

        void OnDraggableRegionsChanged(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                       const std::vector<CefDraggableRegion>& regions) override;

        bool is_closed(CefRefPtr<CefBrowser> browser);

    private:
        HRGN draggable_region_;
        std::vector<CefDraggableRegion> draggable_regions_;
        std::vector<CefRefPtr<CefBrowser>> browser_list;

        void update_drag_regions(HWND window) const;
        void apply_window_region(HWND window) const;
        void save_window_placement(HWND window) const;
        void push_maximize_state(HWND window, bool maximized) const;

        void setup_event_handler(HWND window, bool setup_children, HWND root_window = nullptr);
        LRESULT event_handler(HWND window, UINT message, WPARAM w_param, LPARAM l_param) const;
        static LRESULT CALLBACK static_event_handler(HWND window, UINT message, WPARAM w_param, LPARAM l_param);

        IMPLEMENT_REFCOUNTING(cef_ui_handler);
    };
}
