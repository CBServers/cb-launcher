#pragma once

#include <atomic>
#include <functional>
#include <thread>

namespace pipe
{
    // Single-instance overlapped named-pipe listener: owns pipe creation, accept,
    // stop-event handling, and the cancel+drain pattern for pending I/O on stop.
    class listener
    {
    public:
        struct options
        {
            const wchar_t* name{};
            unsigned long access{}; // PIPE_ACCESS_*; overlapped + first-instance flags added internally
            unsigned long out_buffer{};
            unsigned long in_buffer{};
            std::function<void(unsigned long)> on_create_error{}; // receives GetLastError()
        };

        using connection_handler = std::function<void(void* pipe)>;

        ~listener();

        void start(options opts, connection_handler handler);
        void stop();

        bool running() const { return this->running_; }

        // Overlapped read that unblocks on stop; `extra_event`/`on_extra` service another
        // event (e.g. queued outbound sends) while the read stays pending.
        bool read(void* pipe, void* buffer, unsigned long size, unsigned long& bytes_read,
                  void* extra_event = nullptr, const std::function<void()>& on_extra = {}) const;

        // Overlapped write that unblocks on stop.
        bool write(void* pipe, const void* data, unsigned long size, unsigned long& written) const;

    private:
        void run();
        bool wait_for_connection(void* pipe) const;

        options options_{};
        connection_handler handler_{};
        std::thread thread_{};
        std::atomic<bool> running_{false};
        void* stop_event_{nullptr};
    };
}
