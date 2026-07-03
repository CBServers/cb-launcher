#pragma once

#include "pipe_listener.hpp"

#include <functional>
#include <optional>
#include <string>

namespace deep_link
{
    // The URL scheme name (without "://").
    constexpr const char* SCHEME = "cbservers";

    // The cbservers:// URL passed on the command line, if any.
    std::optional<std::string> get_arg();

    // Hands a cbservers:// URL to the running instance over the pipe; true once accepted.
    bool forward(const std::string& url);

    // Named-pipe listener: receives forwarded URLs and routes them to the UI.
    class server
    {
    public:
        void start(std::function<void(const std::string&)> callback);
        void stop();

    private:
        void read_and_dispatch(void* pipe) const;

        std::function<void(const std::string&)> callback_{};
        pipe::listener listener_{};
    };
}
