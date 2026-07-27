#pragma once

#include <optional>
#include <string>

// Launcher-defined join secret grammar (trailing key=value flags optional; unknown flags ignored):
//   cbl:1:<game-id>:<mode>:<transport>[:pw=1][:mid=<match-id>]   mode = mp/zm/sv/... or "-"
//   transport = direct:<ip>:<port> | nat:<token>:<rhost>:<rport>:<fip>:<fport>
namespace ipc::join_secret
{
    constexpr int SECRET_VERSION = 1;

    struct transport
    {
        bool is_nat{false};
        std::string ip; // direct: server address
        int port{0};
        std::string token; // nat: host punch token
        std::string rendezvous_host;
        int rendezvous_port{0};
        std::string fallback_ip; // nat: host's reachable endpoint
        int fallback_port{0};
    };

    struct parsed
    {
        std::string game_id;
        transport t;
        std::string mode;     // host's play mode (e.g. mp/zm/sv); empty if not carried
        std::string match_id; // fork-supplied match identity; empty if not carried
    };

    // Builds the secret (empty on invalid/oversized transport); mode is positional ("-" when empty) for non-switchable forks.
    std::string build(const std::string& game_id, const transport& t, const std::string& mode = {},
                      const std::string& match_id = {});
    std::optional<parsed> parse(const std::string& secret);
}
