#include "std_include.hpp"
#include "join_secret.hpp"

#include <vector>

namespace ipc::join_secret
{
    namespace
    {
        constexpr size_t MAX_SECRET_LEN = 127;         // direct/nat stay inside the SDK secret length limit
        constexpr size_t MAX_SESSION_SECRET_LEN = 255; // session carries 128 hex chars, so CB-only

        std::vector<std::string> split(const std::string& value, const char delimiter)
        {
            std::vector<std::string> parts;
            size_t start = 0;
            for (size_t i = 0; i <= value.size(); ++i)
            {
                if (i == value.size() || value[i] == delimiter)
                {
                    parts.push_back(value.substr(start, i - start));
                    start = i + 1;
                }
            }
            return parts;
        }

        int to_port(const std::string& value)
        {
            try
            {
                const auto port = std::stoi(value);
                return (port > 0 && port <= 65535) ? port : 0;
            }
            catch (...)
            {
                return 0;
            }
        }

        // Restrict transport fields (remote input, later embedded in a JSON connect) to host/IP/hex chars.
        bool is_safe_field(const std::string& value)
        {
            for (const char c : value)
            {
                const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z')
                    || (c >= 'A' && c <= 'Z') || c == '.' || c == '-';
                if (!ok)
                {
                    return false;
                }
            }
            return true;
        }

        // Map and gametype ids additionally allow '_' (mp_carentan_s2); is_safe_field stays as-is
        // so direct/nat validation is bit-for-bit what it was.
        bool is_safe_name(const std::string& value)
        {
            for (const char c : value)
            {
                const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z')
                    || (c >= 'A' && c <= 'Z') || c == '.' || c == '-' || c == '_';
                if (!ok)
                {
                    return false;
                }
            }
            return true;
        }
    }

    std::string build(const std::string& game_id, const transport& t, const std::string& mode,
                      const std::string& match_id)
    {
        if (game_id.empty())
        {
            return {};
        }

        // Mode is a positional field ("-" when not carried) so cold-launch can select the host's play mode.
        auto secret = "cbl:" + std::to_string(SECRET_VERSION) + ":" + game_id + ":"
            + (mode.empty() ? "-" : mode) + ":";

        if (t.kind == transport::kind_t::nat)
        {
            if (t.token.empty() || t.rendezvous_host.empty() || t.rendezvous_port <= 0)
            {
                return {};
            }
            secret += "nat:" + t.token + ":" + t.rendezvous_host + ":" + std::to_string(t.rendezvous_port)
                + ":" + t.fallback_ip + ":" + std::to_string(t.fallback_port);
        }
        else if (t.kind == transport::kind_t::session)
        {
            if (t.session_host.empty() || t.session_key.empty() || t.session_id.empty()
                || !is_safe_field(t.session_host) || !is_safe_field(t.session_key) || !is_safe_field(t.session_id))
            {
                return {};
            }
            if (!is_safe_name(t.session_map) || !is_safe_name(t.session_gametype) || t.session_max_players < 0)
            {
                return {};
            }
            secret += "session:" + t.session_host + ":" + t.session_key + ":" + t.session_id
                + ":" + t.session_map + ":" + t.session_gametype + ":" + std::to_string(t.session_max_players);
        }
        else
        {
            if (t.ip.empty() || t.port <= 0)
            {
                return {};
            }
            secret += "direct:" + t.ip + ":" + std::to_string(t.port);
        }

        // Lets the joiner's launcher spot "I'm already in this match" before reconnecting.
        if (!match_id.empty() && is_safe_field(match_id))
        {
            secret += ":mid=" + match_id;
        }

        const auto limit = (t.kind == transport::kind_t::session) ? MAX_SESSION_SECRET_LEN : MAX_SECRET_LEN;
        if (secret.size() > limit)
        {
            return {};
        }
        return secret;
    }

    std::optional<parsed> parse(const std::string& secret)
    {
        const auto parts = split(secret, ':');
        if (parts.size() < 5 || parts[0] != "cbl" || parts[1] != std::to_string(SECRET_VERSION))
        {
            return std::nullopt;
        }

        parsed result{};
        result.game_id = parts[2];
        if (result.game_id.empty())
        {
            return std::nullopt;
        }

        // Positional play mode ("-" => not carried).
        result.mode = (parts[3] == "-") ? "" : parts[3];

        const auto& kind = parts[4];
        if (kind == "direct")
        {
            // cbl:1:<game>:<mode>:direct:<ip>:<port>
            if (parts.size() < 7)
            {
                return std::nullopt;
            }
            result.t.kind = transport::kind_t::direct;
            result.t.ip = parts[5];
            result.t.port = to_port(parts[6]);
            if (result.t.ip.empty() || result.t.port == 0 || !is_safe_field(result.t.ip))
            {
                return std::nullopt;
            }
        }
        else if (kind == "nat")
        {
            // cbl:1:<game>:<mode>:nat:<token>:<rhost>:<rport>:<fip>:<fport>
            if (parts.size() < 10)
            {
                return std::nullopt;
            }
            result.t.kind = transport::kind_t::nat;
            result.t.token = parts[5];
            result.t.rendezvous_host = parts[6];
            result.t.rendezvous_port = to_port(parts[7]);
            result.t.fallback_ip = parts[8];
            result.t.fallback_port = to_port(parts[9]);
            if (result.t.token.empty() || !is_safe_field(result.t.token)
                || !is_safe_field(result.t.rendezvous_host) || !is_safe_field(result.t.fallback_ip))
            {
                return std::nullopt;
            }
        }
        else if (kind == "session")
        {
            // cbl:1:<game>:<mode>:session:<host>:<key>:<id>
            if (parts.size() < 8)
            {
                return std::nullopt;
            }
            result.t.kind = transport::kind_t::session;
            result.t.session_host = parts[5];
            result.t.session_key = parts[6];
            result.t.session_id = parts[7];
            if (result.t.session_host.empty() || result.t.session_key.empty() || result.t.session_id.empty()
                || !is_safe_field(result.t.session_host) || !is_safe_field(result.t.session_key)
                || !is_safe_field(result.t.session_id))
            {
                return std::nullopt;
            }

            // Optional positionals: an older secret still parses and the fork reports the gap itself.
            if (parts.size() > 8 && parts[8].find('=') == std::string::npos)
            {
                if (!is_safe_name(parts[8]))
                {
                    return std::nullopt;
                }
                result.t.session_map = parts[8];
            }
            if (parts.size() > 9 && parts[9].find('=') == std::string::npos)
            {
                if (!is_safe_name(parts[9]))
                {
                    return std::nullopt;
                }
                result.t.session_gametype = parts[9];
            }
            if (parts.size() > 10 && parts[10].find('=') == std::string::npos)
            {
                result.t.session_max_players = to_port(parts[10]);
            }
        }
        else
        {
            return std::nullopt;
        }

        // Any extra trailing parts are optional key=value flags; unknown ones are ignored (forward-compat).
        // Session positionals are optional, so flags start at the first key=value part after them.
        size_t flags_at = (kind == "direct") ? 7 : (kind == "session" ? 8 : 10);
        if (kind == "session")
        {
            while (flags_at < parts.size() && flags_at < 11 && parts[flags_at].find('=') == std::string::npos)
            {
                ++flags_at;
            }
        }
        for (size_t i = flags_at; i < parts.size(); ++i)
        {
            if (parts[i].rfind("mid=", 0) == 0)
            {
                auto match_id = parts[i].substr(4);
                if (is_safe_field(match_id))
                {
                    result.match_id = std::move(match_id);
                }
            }
        }

        return result;
    }
}
