#include "std_include.hpp"
#include "steamcmd_log.hpp"

namespace mods::steamcmd_log
{
    namespace
    {
        std::string_view trim(std::string_view text)
        {
            while (!text.empty() && (text.front() == ' ' || text.front() == '\t'))
            {
                text.remove_prefix(1);
            }

            while (!text.empty() && (text.back() == ' ' || text.back() == '\t' || text.back() == '\r'))
            {
                text.remove_suffix(1);
            }

            return text;
        }

        // The bracketed prefix has already differed between SteamCMD builds, so nothing depends on it.
        std::string_view strip_timestamp(std::string_view line)
        {
            if (!line.empty() && line.front() == '[')
            {
                if (const auto end = line.find(']'); end != std::string_view::npos)
                {
                    line.remove_prefix(end + 1);
                }
            }

            return trim(line);
        }

        bool read_number(std::string_view& text, uint64_t& value)
        {
            uint64_t result = 0;
            size_t digits = 0;
            while (digits < text.size() && text[digits] >= '0' && text[digits] <= '9')
            {
                result = result * 10 + static_cast<uint64_t>(text[digits] - '0');
                ++digits;
            }

            if (!digits)
            {
                return false;
            }

            text.remove_prefix(digits);
            value = result;
            return true;
        }

        // Matches one "<key> <done>/<total>" field wherever it sits, so a reordered line still parses.
        bool parse_pair(const std::string_view line, const std::string_view key, uint64_t& done, uint64_t& total)
        {
            const auto at = line.find(key);
            if (at == std::string_view::npos)
            {
                return false;
            }

            auto rest = line.substr(at + key.size());
            uint64_t first = 0;
            uint64_t second = 0;
            if (!read_number(rest, first) || rest.empty() || rest.front() != '/')
            {
                return false;
            }

            rest.remove_prefix(1);
            if (!read_number(rest, second))
            {
                return false;
            }

            done = first;
            total = second;
            return true;
        }

        // The most specific token on the line wins.
        content_phase phase_from_tokens(const std::string_view tokens)
        {
            if (tokens.find("Committing") != std::string_view::npos)
            {
                return content_phase::committing;
            }

            if (tokens.find("Downloading") != std::string_view::npos || tokens.find("Staging") != std::string_view::npos)
            {
                return content_phase::downloading;
            }

            if (tokens.find("Preallocating") != std::string_view::npos)
            {
                return content_phase::preallocating;
            }

            if (tokens.find("Reconfiguring") != std::string_view::npos)
            {
                return content_phase::reconfiguring;
            }

            if (tokens.find("Running Update") != std::string_view::npos)
            {
                return content_phase::running;
            }

            if (tokens.find("None") != std::string_view::npos)
            {
                return content_phase::finished;
            }

            return content_phase::unknown;
        }
    }

    std::vector<content_run> parse_content_runs(const std::string& text, const uint32_t appid)
    {
        constexpr std::string_view state_key = "Workshop update changed : ";
        const auto prefix = "AppID " + std::to_string(appid) + " ";
        const std::string_view all{text};

        std::vector<content_run> runs{};
        for (size_t begin = 0; begin < all.size();)
        {
            const auto end = all.find('\n', begin);
            auto line = strip_timestamp(all.substr(begin, end == std::string_view::npos ? std::string_view::npos : end - begin));
            begin = end == std::string_view::npos ? all.size() : end + 1;

            // Every SteamCMD process opens its block with this banner.
            if (line.starts_with("Client version:"))
            {
                runs.emplace_back();
                continue;
            }

            if (!line.starts_with(prefix))
            {
                continue;
            }

            if (runs.empty())
            {
                runs.emplace_back();
            }

            auto& run = runs.back();
            line.remove_prefix(prefix.size());

            // A game update logs "App update changed" on the same appid and must not drive workshop phase.
            if (line.starts_with(state_key))
            {
                run.phase = phase_from_tokens(line.substr(state_key.size()));
            }
            else if (line.starts_with("update started :"))
            {
                run.saw_update_started = true;
                parse_pair(line, "stage ", run.stage_baseline, run.stage_total);
            }
            else if (line.starts_with("starting commit ") && line.find(" deleted files") != std::string_view::npos)
            {
                run.saw_commit = true;
            }
        }

        return runs;
    }
}
