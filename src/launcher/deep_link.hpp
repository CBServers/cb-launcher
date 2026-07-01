#pragma once

#include <atomic>
#include <functional>
#include <optional>
#include <string>
#include <thread>

namespace deep_link
{
    // The URL scheme name (without "://").
    constexpr const char* SCHEME = "cbservers";

    // The cbservers:// URL passed on the command line, if any.
    std::optional<std::string> get_arg();

    // Hand a cbservers:// URL to an already-running instance over the deep-link pipe.
    // Returns true once the running instance has accepted it.
    bool forward(const std::string& url);

    // Named-pipe listener: receives forwarded URLs and routes them to the UI.
    class server
    {
    public:
        ~server();

        void start(std::function<void(const std::string&)> callback);
        void stop();

    private:
        void run();
        bool wait_for_connection(void* pipe) const;
        void read_and_dispatch(void* pipe) const;

        std::function<void(const std::string&)> callback_{};
        std::thread thread_{};
        std::atomic<bool> running_{false};
        void* stop_event_{nullptr};
    };
}
