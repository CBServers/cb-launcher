#include "std_include.hpp"
#include "server_commands.hpp"
#include "cef/cef_ui.hpp"

#include <chrono>
#include <unordered_map>

// The precompiled std_include.hpp already pulls the classic winsock via
// <Windows.h> (and discards anything included before it), so this file sticks
// to winsock1 APIs: select() instead of WSAPoll, inet_addr instead of InetPton.
#pragma comment(lib, "ws2_32.lib")

namespace commands::server_commands
{
    namespace
    {
        constexpr size_t MAX_ADDRESSES = 64;
        constexpr auto SWEEP_TIMEOUT = std::chrono::milliseconds(1200);

        // Quake-derived clients answer this out-of-band info query. Clients that
        // don't (boiii and the newer-title mods) simply never reply and report
        // as null; per-protocol probes for them are a follow-up.
        constexpr char PROBE[] = "\xff\xff\xff\xff" "getinfo xxx";

        struct probe_target
        {
            std::string address;
            sockaddr_in endpoint{};
            std::chrono::steady_clock::time_point sent{};
            std::optional<double> latency_ms{};
        };

        bool ensure_winsock()
        {
            static const auto initialized = []
            {
                WSADATA data{};
                return WSAStartup(MAKEWORD(2, 2), &data) == 0;
            }();

            return initialized;
        }

        std::optional<sockaddr_in> parse_endpoint(const std::string& address)
        {
            const auto separator = address.rfind(':');
            if (separator == std::string::npos)
            {
                return std::nullopt;
            }

            const auto port = std::atoi(address.substr(separator + 1).c_str());
            if (port <= 0 || port > 65535)
            {
                return std::nullopt;
            }

            const auto ip = inet_addr(address.substr(0, separator).c_str());
            if (ip == INADDR_NONE || ip == INADDR_ANY)
            {
                return std::nullopt;
            }

            sockaddr_in endpoint{};
            endpoint.sin_family = AF_INET;
            endpoint.sin_port = htons(static_cast<uint16_t>(port));
            endpoint.sin_addr.s_addr = ip;
            return endpoint;
        }

        uint64_t endpoint_key(const sockaddr_in& endpoint)
        {
            return (static_cast<uint64_t>(endpoint.sin_addr.s_addr) << 16) | endpoint.sin_port;
        }

        // One non-blocking socket serves every probe: replies are matched back to
        // their target by source address, and the first reply sets the latency.
        void sweep(std::vector<probe_target>& targets)
        {
            if (targets.empty() || !ensure_winsock())
            {
                return;
            }

            const auto sock = ::socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
            if (sock == INVALID_SOCKET)
            {
                return;
            }

            u_long non_blocking = 1;
            ioctlsocket(sock, FIONBIO, &non_blocking);

            std::unordered_map<uint64_t, size_t> by_endpoint{};
            for (size_t i = 0; i < targets.size(); ++i)
            {
                auto& target = targets[i];
                by_endpoint[endpoint_key(target.endpoint)] = i;
                target.sent = std::chrono::steady_clock::now();
                sendto(sock, PROBE, sizeof(PROBE) - 1, 0, reinterpret_cast<const sockaddr*>(&target.endpoint), sizeof(target.endpoint));
            }

            const auto deadline = std::chrono::steady_clock::now() + SWEEP_TIMEOUT;
            auto pending = targets.size();
            while (pending > 0)
            {
                const auto remaining = std::chrono::duration_cast<std::chrono::microseconds>(deadline - std::chrono::steady_clock::now()).count();
                if (remaining <= 0)
                {
                    break;
                }

                fd_set readable{};
                FD_ZERO(&readable);
                FD_SET(sock, &readable);
                timeval timeout{static_cast<long>(remaining / 1'000'000), static_cast<long>(remaining % 1'000'000)};
                if (select(0, &readable, nullptr, nullptr, &timeout) <= 0)
                {
                    break;
                }

                char buffer[2048];
                sockaddr_in from{};
                auto from_size = static_cast<int>(sizeof(from));
                while (recvfrom(sock, buffer, sizeof(buffer), 0, reinterpret_cast<sockaddr*>(&from), &from_size) >= 0)
                {
                    if (const auto it = by_endpoint.find(endpoint_key(from)); it != by_endpoint.end())
                    {
                        auto& target = targets[it->second];
                        if (!target.latency_ms)
                        {
                            target.latency_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - target.sent).count();
                            --pending;
                        }
                    }

                    from_size = static_cast<int>(sizeof(from));
                }
            }

            closesocket(sock);
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("ping-servers", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            if (!value.IsObject() || !value.HasMember("addresses") || !value["addresses"].IsArray())
            {
                return;
            }

            std::vector<probe_target> targets{};
            for (const auto& entry : value["addresses"].GetArray())
            {
                if (targets.size() >= MAX_ADDRESSES)
                {
                    break;
                }

                if (!entry.IsString())
                {
                    continue;
                }

                const std::string address{entry.GetString(), entry.GetStringLength()};
                const auto duplicate = std::any_of(targets.begin(), targets.end(), [&address](const probe_target& target) { return target.address == address; });
                const auto endpoint = parse_endpoint(address);
                if (!duplicate && endpoint)
                {
                    targets.push_back({address, *endpoint});
                }
            }

            sweep(targets);

            for (const auto& target : targets)
            {
                rapidjson::Value key(target.address.data(), static_cast<rapidjson::SizeType>(target.address.size()), allocator);
                if (target.latency_ms)
                {
                    response.AddMember(key, *target.latency_ms, allocator);
                }
                else
                {
                    response.AddMember(key, rapidjson::Value(rapidjson::kNullType), allocator);
                }
            }
        });
    }
}
