#include "std_include.hpp"
#include "deep_link.hpp"

#include <utils/finally.hpp>
#include <utils/string.hpp>

#include <shellapi.h>

namespace deep_link
{
    namespace
    {
        constexpr auto* PIPE_NAME = L"\\\\.\\pipe\\cbservers-launcher-deeplink";
        constexpr size_t MAX_URL_LENGTH = 4096;

        std::string scheme_prefix()
        {
            return std::string(SCHEME) + "://";
        }

        bool is_deep_link(const std::string& arg)
        {
            return utils::string::starts_with(utils::string::to_lower(arg), scheme_prefix());
        }
    }

    std::optional<std::string> get_arg()
    {
        int num_args{};
        auto* const argv = CommandLineToArgvW(GetCommandLineW(), &num_args);
        if (!argv)
        {
            return std::nullopt;
        }
        const auto _ = utils::finally([&argv] { LocalFree(argv); });

        // Skip argv[0] (the exe path); the URL arrives as a positional argument.
        for (auto i = 1; i < num_args; ++i)
        {
            auto arg = utils::string::convert(std::wstring(argv[i]));
            if (is_deep_link(arg) && arg.size() <= MAX_URL_LENGTH)
            {
                return arg;
            }
        }

        return std::nullopt;
    }

    bool forward(const std::string& url)
    {
        const std::string line = url + "\n";

        // The running instance may be mid-accept (or still starting its listener); retry briefly.
        for (auto attempt = 0; attempt < 20; ++attempt)
        {
            const auto pipe = CreateFileW(PIPE_NAME, GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
            if (pipe != INVALID_HANDLE_VALUE)
            {
                DWORD written = 0;
                const bool ok = WriteFile(pipe, line.data(), static_cast<DWORD>(line.size()), &written, nullptr) != 0;
                FlushFileBuffers(pipe);
                CloseHandle(pipe);
                return ok && written == line.size();
            }

            if (GetLastError() == ERROR_PIPE_BUSY)
            {
                WaitNamedPipeW(PIPE_NAME, 1000);
                continue;
            }

            Sleep(100); // pipe not up yet
        }

        return false;
    }

    server::~server()
    {
        this->stop();
    }

    void server::start(std::function<void(const std::string&)> callback)
    {
        if (this->running_.exchange(true))
        {
            return;
        }

        this->callback_ = std::move(callback);
        this->stop_event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        this->thread_ = std::thread([this] { this->run(); });
    }

    void server::stop()
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

    void server::run()
    {
        while (this->running_)
        {
            const auto pipe = CreateNamedPipeW(
                PIPE_NAME,
                PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES, 0, 8192, 0, nullptr);

            if (pipe == INVALID_HANDLE_VALUE)
            {
                if (WaitForSingleObject(this->stop_event_, 1000) == WAIT_OBJECT_0)
                {
                    break;
                }
                continue;
            }

            if (this->wait_for_connection(pipe) && this->running_)
            {
                this->read_and_dispatch(pipe);
            }

            DisconnectNamedPipe(pipe);
            CloseHandle(pipe);
        }
    }

    // Overlapped ConnectNamedPipe that also unblocks on the stop event.
    bool server::wait_for_connection(void* pipe) const
    {
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        const auto _ = utils::finally([&ov] { CloseHandle(ov.hEvent); });

        bool ready = false;
        const auto connect_ok = ConnectNamedPipe(pipe, &ov);
        const auto err = GetLastError();

        if (!connect_ok && err == ERROR_IO_PENDING)
        {
            HANDLE handles[2] = {ov.hEvent, this->stop_event_};
            if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0)
            {
                DWORD dummy = 0;
                ready = GetOverlappedResult(pipe, &ov, &dummy, FALSE) != 0;
            }
            else
            {
                CancelIoEx(pipe, &ov);
            }
        }
        else if (!connect_ok && err == ERROR_PIPE_CONNECTED)
        {
            ready = true; // client connected before ConnectNamedPipe
        }

        return ready;
    }

    void server::read_and_dispatch(void* pipe) const
    {
        char buffer[8192];
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        const auto _ = utils::finally([&ov] { CloseHandle(ov.hEvent); });

        DWORD read = 0;
        bool ok = ReadFile(pipe, buffer, sizeof(buffer) - 1, &read, &ov) != 0;
        if (!ok && GetLastError() == ERROR_IO_PENDING)
        {
            HANDLE handles[2] = {ov.hEvent, this->stop_event_};
            if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0)
            {
                ok = GetOverlappedResult(pipe, &ov, &read, FALSE) != 0;
            }
            else
            {
                CancelIoEx(pipe, &ov);
                ok = false;
            }
        }

        if (!ok || read == 0)
        {
            return;
        }

        std::string data(buffer, read);
        const auto newline = data.find('\n');
        auto line = newline == std::string::npos ? data : data.substr(0, newline);
        while (!line.empty() && (line.back() == '\r' || line.back() == '\n'))
        {
            line.pop_back();
        }

        // Only ever dispatch a well-formed cbservers:// URL within the size cap.
        if (this->running_ && this->callback_ && line.size() <= MAX_URL_LENGTH && is_deep_link(line))
        {
            this->callback_(line);
        }
    }
}
