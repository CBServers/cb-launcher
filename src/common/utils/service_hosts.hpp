#pragma once

#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "http.hpp"

// Each backend answers on several domains, so a network that blocks one domain by name still reaches it.
namespace utils::service_hosts
{
    enum class service
    {
        social,
        auth,
        workshop,
        servers,
    };

    // Base URLs without a trailing slash, the one in use first.
    std::vector<std::string> hosts(service s);

    std::string active(service s);

    // No HTTP status at all (DNS, connect, TLS, timeout): the one failure another domain can fix.
    bool is_transport_error(CURLcode code, unsigned int response_code);

    // Rotates the service off url's host and returns url on the next host; nullopt when there is none.
    std::optional<std::string> failover_url(service s, const std::string& url);

    // Runs request on url and, after a transport error, once more on the service's next host.
    std::optional<http::result> with_failover(service s, const std::string& url,
                                              const std::function<std::optional<http::result>(const std::string&)>& request);
}
