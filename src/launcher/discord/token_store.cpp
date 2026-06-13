#include "std_include.hpp"
#include "token_store.hpp"

#include <utils/cryptography.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

namespace discord::token_store
{
    namespace
    {
        std::string protect(const std::string& value)
        {
            const auto blob = utils::cryptography::dpapi::protect(value);
            if (!blob)
            {
                return {};
            }

            return utils::cryptography::base64::encode(*blob);
        }

        std::optional<std::string> unprotect(const std::string& value)
        {
            const auto blob = utils::cryptography::base64::decode(value);
            if (blob.empty())
            {
                return {};
            }

            return utils::cryptography::dpapi::unprotect(blob);
        }
    }

    void save(const tokens& t)
    {
        const auto access = protect(t.access_token);
        const auto refresh = protect(t.refresh_token);
        if (access.empty() || refresh.empty())
        {
            return;
        }

        const auto lock = utils::properties::lock();
        utils::properties::store(property_keys::DISCORD_ACCESS_TOKEN, access);
        utils::properties::store(property_keys::DISCORD_REFRESH_TOKEN, refresh);
        utils::properties::store(property_keys::DISCORD_TOKEN_EXPIRY, std::to_string(t.expires_at));
    }

    std::optional<tokens> load()
    {
        std::optional<std::string> access_blob;
        std::optional<std::string> refresh_blob;
        std::optional<std::string> expiry;

        {
            const auto lock = utils::properties::lock();
            access_blob = utils::properties::load(property_keys::DISCORD_ACCESS_TOKEN);
            refresh_blob = utils::properties::load(property_keys::DISCORD_REFRESH_TOKEN);
            expiry = utils::properties::load(property_keys::DISCORD_TOKEN_EXPIRY);
        }

        if (!access_blob || !refresh_blob || access_blob->empty() || refresh_blob->empty())
        {
            return {};
        }

        const auto access = unprotect(*access_blob);
        const auto refresh = unprotect(*refresh_blob);
        if (!access || !refresh)
        {
            return {};
        }

        tokens t{};
        t.access_token = *access;
        t.refresh_token = *refresh;

        if (expiry && !expiry->empty())
        {
            try
            {
                t.expires_at = std::stoll(*expiry);
            }
            catch (const std::exception&)
            {
                t.expires_at = 0;
            }
        }

        return t;
    }

    void clear()
    {
        const auto lock = utils::properties::lock();
        utils::properties::store(property_keys::DISCORD_ACCESS_TOKEN, "");
        utils::properties::store(property_keys::DISCORD_REFRESH_TOKEN, "");
        utils::properties::store(property_keys::DISCORD_TOKEN_EXPIRY, "");
    }
}
