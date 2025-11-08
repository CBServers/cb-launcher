#include <std_include.hpp>

#include "cef/cef_ui.hpp"
#include "cef/cef_ui_handler.hpp"

#ifdef _WIN64
using number = double;
#else
using number = float;
#endif

namespace cef
{
	namespace
	{
		using window_enumerator = std::function<bool(HWND)>;

		BOOL child_window_enumerator(const HWND window, const LPARAM data)
		{
			return (*reinterpret_cast<const window_enumerator*>(data))(window) ? TRUE : FALSE;
		}

		void enum_child_windows(const HWND window, const window_enumerator& callback)
		{
			EnumChildWindows(window, &child_window_enumerator, reinterpret_cast<LPARAM>(&callback));
		}

		number get_last_dpi_scale(const HWND window)
		{
			const auto result = GetPropA(window, "cb_dpi_scale");
			if (!result)
			{
				return static_cast<number>(1.0);
			}

			return *reinterpret_cast<const number*>(&result);
		}

		void store_dpi_scale(const HWND window, const number dpi_scale)
		{
			SetPropA(window, "cb_dpi_scale", *reinterpret_cast<const HANDLE*>(&dpi_scale));
		}

		number get_dpi_scale(const HWND window)
		{
			const utils::nt::library user32{"user32.dll"};
			const auto get_dpi = user32 ? user32.get_proc<UINT(WINAPI *)(HWND)>("GetDpiForWindow") : nullptr;

			if (!get_dpi)
			{
				return 1.0;
			}

			constexpr auto unaware_dpi = USER_DEFAULT_SCREEN_DPI * 1.0;
			const auto dpi = get_dpi(window);
			return static_cast<number>(dpi / unaware_dpi);
		}

		void apply_window_style(const HWND window)
		{
			const auto base = reinterpret_cast<HINSTANCE>(GetWindowLongPtrA(window, GWLP_HINSTANCE));

			const auto icon = LPARAM(LoadIconA(base, MAKEINTRESOURCEA(IDI_ICON_1)));
			PostMessageA(window, WM_SETICON, ICON_SMALL, icon);
			PostMessageA(window, WM_SETICON, ICON_BIG, icon);

			// Doesn't work in combination with rounded corners :(
			//static const MARGINS shadow{ 1,1,1,1 };
			//DwmExtendFrameIntoClientArea(window, &shadow);
			//SetWindowPos(window, nullptr, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE);

			// This causes issues for now :(
			//const auto class_style = GetClassLongW(window, GCL_STYLE);
			//SetClassLongW(window, GCL_STYLE, class_style | CS_DROPSHADOW);

			//SetWindowLong(window, GWL_EXSTYLE, GetWindowLong(window, GWL_EXSTYLE) | WS_EX_LAYERED);

			PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);
		}
	}

	cef_ui_handler::cef_ui_handler()
	{
		this->draggable_region_ = CreateRectRgn(0, 0, 0, 0);
	}

	cef_ui_handler::~cef_ui_handler()
	{
		DeleteObject(this->draggable_region_);
	}

	void cef_ui_handler::OnAfterCreated(CefRefPtr<CefBrowser> browser)
	{
		CEF_REQUIRE_UI_THREAD();
		this->browser_list.push_back(browser);

		const auto window = browser->GetHost()->GetWindowHandle();
		this->setup_event_handler(window, true);
		apply_window_style(window);
	}

	void cef_ui_handler::OnBeforeClose(CefRefPtr<CefBrowser> browser)
	{
		CEF_REQUIRE_UI_THREAD();

		for (auto bit = this->browser_list.begin(); bit != this->browser_list.end(); ++bit)
		{
			if ((*bit)->IsSame(browser))
			{
				this->browser_list.erase(bit);
				break;
			}
		}

		if (this->browser_list.empty())
		{
			CefQuitMessageLoop();
		}
	}

	bool cef_ui_handler::DoClose(CefRefPtr<CefBrowser> browser)
	{
		SetParent(browser->GetHost()->GetWindowHandle(), nullptr);
		return false;
	}

	void cef_ui_handler::OnBeforeContextMenu(CefRefPtr<CefBrowser> /*browser*/, CefRefPtr<CefFrame> /*frame*/,
	                                         CefRefPtr<CefContextMenuParams> /*params*/, CefRefPtr<CefMenuModel> model)
	{
		model->Clear();

#if DEBUG
		model->AddItem(MENU_ID_USER_FIRST + 1, "Inspect Element");
		model->AddSeparator();
		model->AddItem(MENU_ID_USER_FIRST + 2, "Reload");
#endif
	}

	bool cef_ui_handler::OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> /*frame*/,
	                                          CefRefPtr<CefContextMenuParams> /*params*/, int command_id,
	                                          CefContextMenuHandler::EventFlags /*event_flags*/)
	{
		switch (command_id)
		{
		case MENU_ID_USER_FIRST + 1: // Inspect Element
			{
				CefWindowInfo window_info;
				window_info.SetAsPopup(browser->GetHost()->GetWindowHandle(), "Developer Tools");

				CefBrowserSettings browser_settings;
				browser->GetHost()->ShowDevTools(window_info, nullptr, browser_settings, CefPoint());
				return true;
			}
		case MENU_ID_USER_FIRST + 2: // Reload
			browser->Reload();
			return true;
		default:
			return false;
		}
	}

	void cef_ui_handler::OnContextMenuDismissed(CefRefPtr<CefBrowser> /*browser*/, CefRefPtr<CefFrame> /*frame*/)
	{
	}

	bool cef_ui_handler::RunContextMenu(CefRefPtr<CefBrowser> /*browser*/, CefRefPtr<CefFrame> /*frame*/,
	                                    CefRefPtr<CefContextMenuParams> /*params*/, CefRefPtr<CefMenuModel> /*model*/,
	                                    CefRefPtr<CefRunContextMenuCallback> /*callback*/)
	{
		return false;
	}

	void cef_ui_handler::OnDraggableRegionsChanged(CefRefPtr<CefBrowser> browser, [[maybe_unused]] CefRefPtr<CefFrame> frame,
	                                               const std::vector<CefDraggableRegion>& regions)
	{
		const auto window = browser->GetHost()->GetWindowHandle();

		this->draggable_regions_ = regions;
		this->update_drag_regions(window);
		this->setup_event_handler(window, true);
	}

	bool cef_ui_handler::is_closed(CefRefPtr<CefBrowser> browser)
	{
		for (const auto& browser_entry : this->browser_list)
		{
			if (browser_entry == browser)
			{
				return false;
			}
		}

		return true;
	}

	void cef_ui_handler::update_drag_regions(const HWND window) const
	{
		SetRectRgn(this->draggable_region_, 0, 0, 0, 0);

		for (auto& region : this->draggable_regions_)
		{
			RECT rect
			{
				region.bounds.x, region.bounds.y,
				region.bounds.x + region.bounds.width,
				region.bounds.y + region.bounds.height
			};

			const auto dpi_scale = get_dpi_scale(window);
			rect.left = static_cast<LONG>(rect.left * dpi_scale);
			rect.top = static_cast<LONG>(rect.top * dpi_scale);
			rect.right = static_cast<LONG>(rect.right * dpi_scale);
			rect.bottom = static_cast<LONG>(rect.bottom * dpi_scale);

			const auto sub_region = CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom);

			CombineRgn(this->draggable_region_, this->draggable_region_, sub_region,
			           region.draggable ? RGN_OR : RGN_DIFF);
			DeleteObject(sub_region);
		}
	}

	void cef_ui_handler::setup_event_handler(const HWND window, const bool setup_children, HWND root_window)
	{
		root_window = root_window ? root_window : window;

		const auto target_handler = reinterpret_cast<LONG_PTR>(&cef_ui_handler::static_event_handler);
		const auto proc_handler = GetWindowLongPtrW(window, GWLP_WNDPROC);

		if (proc_handler != target_handler)
		{
			SetPropA(window, "cb_root_window", root_window);
			SetPropA(window, "cb_ui_handler", this);
			SetPropA(window, "cb_proc_handler", reinterpret_cast<HANDLE>(proc_handler));

			SetWindowLongPtrW(window, GWLP_WNDPROC, target_handler);
		}

		if (setup_children)
		{
			enum_child_windows(window, [this, root_window](const HWND child)
			{
				this->setup_event_handler(child, false, root_window);
				return true;
			});
		}
	}

	LRESULT cef_ui_handler::event_handler(const HWND window, const UINT message, const WPARAM w_param,
	                                      const LPARAM l_param) const
	{
		const auto root_window = GetPropA(window, "cb_root_window");
		const auto handler = GetPropA(window, "cb_proc_handler");
		if (!handler)
		{
			return DefWindowProcW(window, message, w_param, l_param);
		}

		if (message == WM_LBUTTONDOWN)
		{
			const POINTS points = MAKEPOINTS(l_param);
			const POINT point = {points.x, points.y};
			if (PtInRegion(this->draggable_region_, point.x, point.y))
			{
				ReleaseCapture();
				PostMessageA(static_cast<HWND>(root_window), WM_NCLBUTTONDOWN, HTCAPTION, 0);
				return 1;
			}
		}

		if (message == WM_NCCALCSIZE)
		{
			if (w_param == TRUE)
			{
				return 0;
			}
		}

		if (message == WM_DPICHANGED && window == root_window)
		{
			PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);
		}

		if (message == WM_SIZE && window == root_window)
		{
			PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);
		}

		if (message == WM_DELAYEDDPICHANGE && window == root_window)
		{
			RECT rect;
			GetWindowRect(window, &rect);

			const auto width = rect.right - rect.left;
			const auto height = rect.bottom - rect.top;

			const POINT center
			{
				rect.left + width / 2,
				rect.top + height / 2,
			};

			const auto dpi_scale = get_dpi_scale(window);
			//const auto last_scale = get_last_dpi_scale(window);
			//store_dpi_scale(window, dpi_scale);

			const auto new_width = int(LAUNCHER_WINDOW_WIDTH * dpi_scale); //int((width * dpi_scale) / last_scale);
			const auto new_height = int(LAUNCHER_WINDOW_HEIGHT * dpi_scale);//int((height * dpi_scale) / last_scale);

			const auto new_x = center.x - (new_width / 2);
			const auto new_y = center.y - (new_height / 2);

			SetWindowPos(window, nullptr, new_x, new_y, new_width, new_height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS);

			// Update rounded corners
			const auto round_rect = CreateRoundRectRgn(0, 0, rect.right - rect.left, rect.bottom - rect.top, 15, 15);
			SetWindowRgn(window, round_rect, TRUE);
			DeleteObject(round_rect);

			this->update_drag_regions(window);
			return TRUE;
		}

		const auto handler_func = static_cast<decltype(DefWindowProcW)*>(handler);
		return handler_func(window, message, w_param, l_param);
	}

	LRESULT CALLBACK cef_ui_handler::static_event_handler(const HWND window, const UINT message, const WPARAM w_param,
	                                                      const LPARAM l_param)
	{
		const auto handler = GetPropA(window, "cb_ui_handler");
		if (!handler)
		{
			return DefWindowProcW(window, message, w_param, l_param);
		}

		return static_cast<cef_ui_handler*>(handler)->event_handler(window, message, w_param, l_param);
	}
}
