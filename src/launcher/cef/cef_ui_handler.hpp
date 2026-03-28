#pragma once

#define WM_DELAYEDDPICHANGE (WM_USER + 0x123)
#define LAUNCHER_WINDOW_WIDTH (1380)
#define LAUNCHER_WINDOW_HEIGHT (805)

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

        void setup_event_handler(HWND window, bool setup_children, HWND root_window = nullptr);
        LRESULT event_handler(HWND window, UINT message, WPARAM w_param, LPARAM l_param) const;
        static LRESULT CALLBACK static_event_handler(HWND window, UINT message, WPARAM w_param, LPARAM l_param);

        IMPLEMENT_REFCOUNTING(cef_ui_handler);
    };
}
