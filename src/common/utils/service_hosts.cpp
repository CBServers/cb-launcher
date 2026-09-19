#include "service_hosts.hpp"
#include "logger.hpp"

#include <atomic>

namespace utils::service_hosts
{
    namespace
    {
        struct service_entry
        {
            const char* name{};
            std::vector<std::string> hosts{};
            std::atomic<size_t> active{0};
        };

        service_entry& entry_for(const service s)
        {
            static service_entry social{"social", {"https://social.cbservers.dev", "https://social.cbservers.xyz"}};
            static service_entry auth{"auth", {"https://auth.cbservers.dev", "https://auth.cbservers.xyz"}};
            static service_entry workshop{"workshop", {"https://workshop.cbservers.dev", "https://workshop.cbservers.xyz"}};
            static service_entry servers{"servers", {"https://servers.cbservers.dev", "https://servers.cbservers.xyz"}};

            switch (s)
            {
            case service::auth:
                return auth;
            case service::workshop:
                return workshop;
            case service::servers:
                return servers;
            default:
                return social;
            }
        }
    }

    std::vector<std::string> hosts(const service s)
    {
        const auto& entry = entry_for(s);
        const auto start = entry.active.load();

        std::vector<std::string> ordered{};
        for (size_t i = 0; i < entry.hosts.size(); ++i)
        {
            ordered.push_back(entry.hosts[(start + i) % entry.hosts.size()]);
        }
        return ordered;
    }

    std::string active(const service s)
    {
        const auto& entry = entry_for(s);
        return entry.hosts[entry.active.load() % entry.hosts.size()];
    }

    bool is_transport_error(const CURLcode code, const unsigned int response_code)
    {
        return code != CURLE_OK && code != CURLE_ABORTED_BY_CALLBACK && response_code == 0;
    }

    std::optional<std::string> failover_url(const service s, const std::string& url)
    {
        auto& entry = entry_for(s);
        if (entry.hosts.size() < 2)
        {
            return std::nullopt;
        }

        for (size_t i = 0; i < entry.hosts.size(); ++i)
        {
            const auto& host = entry.hosts[i];
            if (!url.starts_with(host) || (url.size() > host.size() && url[host.size()] != '/'))
            {
                continue;
            }

            // Concurrent failures on the same host move the service once, not once each.
            auto expected = i;
            const auto next = (i + 1) % entry.hosts.size();
            if (entry.active.compare_exchange_strong(expected, next))
            {
                logger::write("[services] {} unreachable at {}, switching to {}", entry.name, host, entry.hosts[next]);
            }

            return active(s) + url.substr(host.size());
        }

        return std::nullopt;
    }

    std::optional<http::result> with_failover(const service s, const std::string& url,
                                              const std::function<std::optional<http::result>(const std::string&)>& request)
    {
        auto result = request(url);
        if (result && is_transport_error(result->code, result->response_code))
        {
            if (const auto next = failover_url(s, url))
            {
                result = request(*next);
            }
        }
        return result;
    }
}
