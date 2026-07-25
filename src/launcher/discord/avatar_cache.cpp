#include "std_include.hpp"
#include "avatar_cache.hpp"

#include <utils/hash.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/properties.hpp>

#include <algorithm>

namespace discord::avatar_cache
{
    namespace
    {
        constexpr size_t MAX_BYTES = 1024 * 1024;
        constexpr int TIMEOUT_SECONDS = 3;
        constexpr size_t PRUNE_TRIGGER = 150;
        constexpr size_t PRUNE_TARGET = 100;

        // Toasts render the logo at roughly 48px; 128 covers HiDPI without paying for more.
        constexpr const char* SIZE_QUERY = "?size=128";

        constexpr std::string_view ALLOWED_PREFIXES[] = {
            "https://cdn.discordapp.com/",
            "https://media.discordapp.net/",
        };

        // The path is written from a hash, never from the URL, so a hostile URL can't steer the write.
        std::string normalize(const std::string& url)
        {
            const auto end = url.find_first_of("?#");
            auto base = end == std::string::npos ? url : url.substr(0, end);

            const auto allowed = std::ranges::any_of(ALLOWED_PREFIXES, [&](const std::string_view prefix)
            {
                return base.starts_with(prefix);
            });

            if (!allowed)
            {
                return {};
            }

            return base + SIZE_QUERY;
        }

        std::filesystem::path cache_directory()
        {
            return utils::properties::get_appdata_path() / "user" / "avatar-cache";
        }

        bool is_png(const std::string& data)
        {
            constexpr std::string_view magic = "\x89PNG\r\n\x1a\n";
            return data.size() > magic.size() && data.compare(0, magic.size(), magic) == 0;
        }
    }

    std::filesystem::path fetch(const std::string& url)
    {
        const auto normalized = normalize(url);
        if (normalized.empty())
        {
            return {};
        }

        auto key = normalized;
        const auto hash = utils::hash::get_buffer_hash(key);
        if (hash.empty())
        {
            return {};
        }

        const auto directory = cache_directory();
        const auto target = directory / (hash + ".png");

        std::error_code ec;
        if (std::filesystem::is_regular_file(target, ec))
        {
            return target;
        }

        bool oversized = false;
        const auto result = utils::http::get_data(normalized, {}, {},
            [&oversized](const size_t now, const size_t total, size_t)
            {
                if (now > MAX_BYTES || total > MAX_BYTES)
                {
                    oversized = true;
                    return false;
                }
                return true;
            }, TIMEOUT_SECONDS, 1);

        if (oversized || !result || result->response_code != 200 || !is_png(result->buffer))
        {
            utils::logger::write("[cbl-avatar] could not cache avatar for the toast (oversized={})", oversized);
            return {};
        }

        utils::io::create_directory(directory);

        // Write under a scratch name so a killed launcher can't leave a truncated PNG behind that
        // would then be treated as cached forever.
        const auto temp = directory / (hash + ".part");
        if (!utils::io::write_file(temp, result->buffer))
        {
            return {};
        }

        if (!utils::io::move_file(temp, target))
        {
            utils::io::remove_file(temp);
            // Another thread may have won the race and published the same file.
            return std::filesystem::is_regular_file(target, ec) ? target : std::filesystem::path{};
        }

        return target;
    }

    void prune()
    {
        std::error_code ec;
        const auto directory = cache_directory();
        if (!std::filesystem::is_directory(directory, ec))
        {
            return;
        }

        auto files = utils::io::list_files(directory);
        if (files.size() <= PRUNE_TRIGGER)
        {
            return;
        }

        std::ranges::sort(files, [](const std::filesystem::path& a, const std::filesystem::path& b)
        {
            std::error_code a_ec, b_ec;
            return std::filesystem::last_write_time(a, a_ec) < std::filesystem::last_write_time(b, b_ec);
        });

        for (size_t i = 0; i + PRUNE_TARGET < files.size(); ++i)
        {
            utils::io::remove_file(files[i]);
        }
    }
}
