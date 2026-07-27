#include "std_include.hpp"
#include "join_secret.hpp"

#include <vector>

namespace ipc::join_secret
{
    namespace
    {
        constexpr size_t MAX_SECRET_LEN = 127; // stay within the SDK secret length limit

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

        if (t.is_nat)
        {
            if (t.token.empty() || t.rendezvous_host.empty() || t.rendezvous_port <= 0)
            {
                return {};
            }
            secret += "nat:" + t.token + ":" + t.rendezvous_host + ":" + std::to_string(t.rendezvous_port)
                + ":" + t.fallback_ip + ":" + std::to_string(t.fallback_port);
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

        if (secret.size() > MAX_SECRET_LEN)
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
            result.t.is_nat = false;
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
            result.t.is_nat = true;
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
        else
        {
            return std::nullopt;
        }

        // Any extra trailing parts are optional key=value flags; unknown ones are ignored (forward-compat).
        for (size_t i = (kind == "direct") ? 7 : 10; i < parts.size(); ++i)
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
