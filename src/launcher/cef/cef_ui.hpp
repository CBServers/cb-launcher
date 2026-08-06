#pragma once

#include <mutex>
#include <vector>

#include <utils/nt.hpp>
#include "cef_ui_handler.hpp"

namespace cef
{
    // Outcome of an outgoing Discord invite / join request, pushed to the UI for localization.
    struct invite_result
    {
        std::string op;      // "invite" | "join"
        std::string user_id;
        std::string status;  // "sent" | "deferred" | "rate_limited" | "dropped" | "failed"
        float retry_after{}; // seconds, "rate_limited" only
        std::string error;
    };

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
        void execute_javascript(const std::string& code) const;
        void show_message_box(const std::string& title, const std::string& msg) const;
        void show_toast(const std::string& message, const std::string& type = "info", int duration_ms = 6000) const;
        void dispatch_deep_link(const std::string& url);
        // Hands the outcome to window.handleInviteResult so the UI can localize it.
        void dispatch_invite_result(const invite_result& result) const;
        void notify_frontend_ready();
        void bring_to_front() const;

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

        // Deep links received before the frontend is ready are queued, not dropped.
        std::mutex deep_link_mutex_;
        bool frontend_ready_ = false;
        std::vector<std::string> pending_deep_links_;

        static void invoke_close_browser(CefRefPtr<CefBrowser> browser);
        static void invoke_show_message_box(CefRefPtr<CefBrowser> browser, const std::string& title, const std::string& msg);
        static void invoke_show_toast(CefRefPtr<CefBrowser> browser, const std::string& message, const std::string& type, int duration_ms);
        static void invoke_dispatch_deep_link(CefRefPtr<CefBrowser> browser, std::string url);
        static void invoke_dispatch_invite_result(CefRefPtr<CefBrowser> browser, invite_result result);
        static void invoke_bring_to_front(HWND window);
    };
}
