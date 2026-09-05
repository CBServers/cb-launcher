#include "std_include.hpp"
#include "server_commands.hpp"
#include "cef/cef_ui.hpp"
#include "ipc/ipc_server.hpp"

#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <unordered_map>

// The precompiled std_include.hpp already pulls the classic winsock via
// <Windows.h> (and discards anything included before it), so this file sticks
// to winsock1 APIs: select() instead of WSAPoll, inet_addr instead of InetPton.
#pragma comment(lib, "ws2_32.lib")

namespace commands::server_commands
{
    namespace
    {
        constexpr size_t MAX_ADDRESSES = 512;
        constexpr size_t MAX_JOBS = 8;
        constexpr size_t SEND_BATCH = 32;
        constexpr auto SWEEP_TIMEOUT = std::chrono::milliseconds(1200);

        // Quake-derived clients answer the out-of-band getinfo query; Plutonium
        // dropped that and answers a dedicated pingreq/pingres pair instead
        // (captured from their client). Both probes go to every server and the
        // first reply of either kind sets the latency.
        constexpr char PROBE_GETINFO[] = "\xff\xff\xff\xff" "getinfo xxx";
        constexpr char PROBE_PINGREQ[] = "\xff\xff\xff\xff" "pingreq";

        struct probe_target
        {
            std::string address;
            sockaddr_in endpoint{};
            std::chrono::steady_clock::time_point sent{};
            std::optional<double> latency_ms{};
        };

        // Sweeps run on their own thread so the CEF IO thread never blocks on select();
        // the frontend starts a job and polls it. `done` is the publication barrier for `targets`.
        struct sweep_job
        {
            std::vector<probe_target> targets{};
            std::atomic<bool> done{false};
        };

        std::mutex jobs_mutex{};
        std::unordered_map<uint64_t, std::shared_ptr<sweep_job>> jobs{};
        uint64_t next_job_id = 1;

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

        void drain(const SOCKET sock, std::vector<probe_target>& targets, const std::unordered_map<uint64_t, size_t>& by_endpoint, size_t& pending)
        {
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

            // Windows defaults to an 8 KB receive buffer; a few hundred getinfo replies would overflow it.
            int rcvbuf = 4 * 1024 * 1024;
            setsockopt(sock, SOL_SOCKET, SO_RCVBUF, reinterpret_cast<const char*>(&rcvbuf), sizeof(rcvbuf));

            std::unordered_map<uint64_t, size_t> by_endpoint{};
            for (size_t i = 0; i < targets.size(); ++i)
            {
                by_endpoint[endpoint_key(targets[i].endpoint)] = i;
            }

            auto pending = targets.size();
            for (size_t i = 0; i < targets.size(); ++i)
            {
                auto& target = targets[i];
                target.sent = std::chrono::steady_clock::now();
                sendto(sock, PROBE_GETINFO, sizeof(PROBE_GETINFO) - 1, 0, reinterpret_cast<const sockaddr*>(&target.endpoint), sizeof(target.endpoint));
                sendto(sock, PROBE_PINGREQ, sizeof(PROBE_PINGREQ) - 1, 0, reinterpret_cast<const sockaddr*>(&target.endpoint), sizeof(target.endpoint));

                // Drain between batches so early replies are timed as they land, not after the whole burst.
                if ((i + 1) % SEND_BATCH == 0)
                {
                    drain(sock, targets, by_endpoint, pending);
                }
            }

            const auto deadline = std::chrono::steady_clock::now() + SWEEP_TIMEOUT;
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

                drain(sock, targets, by_endpoint, pending);
            }

            closesocket(sock);
        }

        uint64_t start_job(std::vector<probe_target> targets)
        {
            auto job = std::make_shared<sweep_job>();
            job->targets = std::move(targets);

            uint64_t id{};
            {
                std::lock_guard lock{jobs_mutex};
                id = next_job_id++;
                if (jobs.size() >= MAX_JOBS)
                {
                    // Ids are monotonic, so the smallest key is the oldest job.
                    jobs.erase(std::min_element(jobs.begin(), jobs.end(),
                        [](const auto& a, const auto& b) { return a.first < b.first; }));
                }
                jobs[id] = job;
            }

            std::thread([job]
            {
                sweep(job->targets);
                job->done.store(true, std::memory_order_release);
            }).detach();

            return id;
        }

        std::shared_ptr<sweep_job> find_job(const uint64_t id)
        {
            std::lock_guard lock{jobs_mutex};
            const auto it = jobs.find(id);
            return it == jobs.end() ? nullptr : it->second;
        }

        void forget_job(const uint64_t id)
        {
            std::lock_guard lock{jobs_mutex};
            jobs.erase(id);
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context& ctx)
    {
        cef_ui.add_command("join-server", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto set_result = [&response](const bool success, const std::string& error = {})
            {
                response.SetObject();
                auto& allocator = response.GetAllocator();
                response.AddMember("success", success, allocator);
                if (!error.empty())
                {
                    rapidjson::Value message{};
                    message.SetString(error.data(), static_cast<rapidjson::SizeType>(error.size()), allocator);
                    response.AddMember("error", message, allocator);
                }
            };

            const auto config = ctx.get_game_config_from_request(value);
            if (!config || config->id != "boiii")
            {
                set_result(false, "Joining is not supported for this game yet.");
                return;
            }

            const std::string ip = value.HasMember("ip") && value["ip"].IsString() ? value["ip"].GetString() : "";
            const auto port = value.HasMember("port") && value["port"].IsInt() ? value["port"].GetInt() : 0;
            if (!parse_endpoint(ip + ":" + std::to_string(port)))
            {
                set_result(false, "Invalid server address.");
                return;
            }

            ipc::ipc_server::instance().join_direct(config->id, ip, port);
            set_result(true);
        });

        cef_ui.add_command("ping-servers", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            if (!value.IsObject() || !value.HasMember("addresses") || !value["addresses"].IsArray())
            {
                return;
            }

            std::vector<probe_target> targets{};
            std::unordered_map<std::string, bool> seen{};
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
                const auto endpoint = parse_endpoint(address);
                if (endpoint && !std::exchange(seen[address], true))
                {
                    targets.push_back({address, *endpoint});
                }
            }

            response.AddMember("job", start_job(std::move(targets)), allocator);
        });

        cef_ui.add_command("get-ping-results", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto id = value.IsObject() && value.HasMember("job") && value["job"].IsUint64() ? value["job"].GetUint64() : 0;
            const auto job = find_job(id);
            if (!job || !job->done.load(std::memory_order_acquire))
            {
                // An unknown job (evicted or never started) reports done with no pings so the caller stops polling.
                response.AddMember("done", job == nullptr, allocator);
                return;
            }

            rapidjson::Value pings(rapidjson::kObjectType);
            for (const auto& target : job->targets)
            {
                rapidjson::Value key(target.address.data(), static_cast<rapidjson::SizeType>(target.address.size()), allocator);
                if (target.latency_ms)
                {
                    pings.AddMember(key, *target.latency_ms, allocator);
                }
                else
                {
                    pings.AddMember(key, rapidjson::Value(rapidjson::kNullType), allocator);
                }
            }

            response.AddMember("done", true, allocator);
            response.AddMember("pings", pings, allocator);
            forget_job(id);
        });
    }
}
