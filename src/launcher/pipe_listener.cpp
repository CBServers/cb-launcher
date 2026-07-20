#include "std_include.hpp"
#include "pipe_listener.hpp"

namespace pipe
{
    namespace
    {
        // Waits for pending overlapped I/O, unblocking on the stop event. An optional extra
        // event is serviced via `on_extra` while the I/O stays pending. On stop (or wait
        // failure) the I/O is cancelled and drained before the caller's OVERLAPPED goes away.
        bool wait_overlapped(const HANDLE pipe, OVERLAPPED& ov, DWORD& bytes, const HANDLE stop_event,
                             const HANDLE extra_event, const std::function<void()>& on_extra)
        {
            HANDLE handles[3] = {ov.hEvent, stop_event, extra_event};
            const DWORD count = extra_event ? 3 : 2;

            while (true)
            {
                const auto wait = WaitForMultipleObjects(count, handles, FALSE, INFINITE);
                if (wait == WAIT_OBJECT_0)
                {
                    return GetOverlappedResult(pipe, &ov, &bytes, FALSE) != 0;
                }
                if (wait == WAIT_OBJECT_0 + 2)
                {
                    on_extra();
                    continue;
                }

                CancelIoEx(pipe, &ov);
                GetOverlappedResult(pipe, &ov, &bytes, TRUE);
                return false;
            }
        }
    }

    listener::~listener()
    {
        this->stop();
    }

    void listener::start(options opts, connection_handler handler)
    {
        if (this->running_.exchange(true))
        {
            return;
        }

        this->options_ = std::move(opts);
        this->handler_ = std::move(handler);
        this->stop_event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        this->thread_ = std::thread([this] { this->run(); });
    }

    void listener::stop()
    {
        if (!this->running_.exchange(false))
        {
            return;
        }

        if (this->stop_event_)
        {
            SetEvent(this->stop_event_);
        }

        if (this->thread_.joinable())
        {
            this->thread_.join();
        }

        if (this->stop_event_)
        {
            CloseHandle(this->stop_event_);
            this->stop_event_ = nullptr;
        }
    }

    void listener::run()
    {
        while (this->running_)
        {
            // FIRST_PIPE_INSTANCE so another local process can't squat the pipe name.
            const auto pipe = CreateNamedPipeW(
                this->options_.name,
                this->options_.access | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1, this->options_.out_buffer, this->options_.in_buffer, 0, nullptr);

            if (pipe == INVALID_HANDLE_VALUE)
            {
                if (this->options_.on_create_error)
                {
                    this->options_.on_create_error(GetLastError());
                }
                if (WaitForSingleObject(this->stop_event_, 1000) == WAIT_OBJECT_0)
                {
                    break;
                }
                continue;
            }

            if (this->wait_for_connection(pipe) && this->running_)
            {
                this->handler_(pipe);
            }

            DisconnectNamedPipe(pipe);
            CloseHandle(pipe);
        }
    }

    // Overlapped ConnectNamedPipe that also unblocks on the stop event.
    bool listener::wait_for_connection(void* pipe) const
    {
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

        bool ready = false;
        const auto connect_ok = ConnectNamedPipe(pipe, &ov);
        const auto err = GetLastError();

        if (!connect_ok && err == ERROR_IO_PENDING)
        {
            DWORD dummy = 0;
            ready = wait_overlapped(pipe, ov, dummy, this->stop_event_, nullptr, {});
        }
        else if (!connect_ok && err == ERROR_PIPE_CONNECTED)
        {
            // Client connected between CreateNamedPipe and ConnectNamedPipe.
            ready = true;
        }

        CloseHandle(ov.hEvent);
        return ready;
    }

    bool listener::read(void* pipe, void* buffer, const unsigned long size, unsigned long& bytes_read,
                        void* extra_event, const std::function<void()>& on_extra) const
    {
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

        bool ok = ReadFile(pipe, buffer, size, &bytes_read, &ov) != 0;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
        {
            ok = wait_overlapped(pipe, ov, bytes_read, this->stop_event_, extra_event, on_extra);
        }

        CloseHandle(ov.hEvent);
        return ok;
    }

    bool listener::write(void* pipe, const void* data, const unsigned long size, unsigned long& written) const
    {
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

        bool ok = WriteFile(pipe, data, size, &written, &ov) != 0;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
        {
            ok = wait_overlapped(pipe, ov, written, this->stop_event_, nullptr, {});
        }

        CloseHandle(ov.hEvent);
        return ok;
    }
}
