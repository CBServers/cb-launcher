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

    void server::start(std::function<void(const std::string&)> callback)
    {
        if (this->listener_.running())
        {
            return;
        }

        this->callback_ = std::move(callback);

        pipe::listener::options opts{};
        opts.name = PIPE_NAME;
        opts.access = PIPE_ACCESS_INBOUND;
        opts.in_buffer = 8192;
        this->listener_.start(std::move(opts), [this](void* pipe) { this->read_and_dispatch(pipe); });
    }

    void server::stop()
    {
        this->listener_.stop();
    }

    void server::read_and_dispatch(void* pipe) const
    {
        char buffer[8192];
        DWORD read = 0;
        const bool ok = this->listener_.read(pipe, buffer, sizeof(buffer) - 1, read);

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
        if (this->listener_.running() && this->callback_ && line.size() <= MAX_URL_LENGTH && is_deep_link(line))
        {
            this->callback_(line);
        }
    }
}
