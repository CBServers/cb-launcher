#pragma once

#include <cstdint>

namespace discord
{
    // Discord application ID (developer portal). "Public Client" must be
    // enabled on the application's OAuth2 tab for the PKCE token exchange.
    constexpr uint64_t APPLICATION_ID = 1494165323543478392;

    // Link registry worker (worker/discord-link). Records which Discord
    // accounts have linked the launcher.
    constexpr const char* LINK_REGISTRY_URL = "https://auth.cbservers.xyz";

    // Self-hosted invite relay. Carries invites and join  requests off 
    // Discord's app-wide rate-limited surface. Override with -relay-url <url>.
    constexpr const char* RELAY_URL = "https://relay.cbservers.xyz";

    // Base URL for per-game rich-presence art (large image), keyed by game id
    // (e.g. "boiii"). Full URL is PRESENCE_ART_BASE + id + ".png".
    constexpr const char* PRESENCE_ART_BASE = "https://docs.cbservers.xyz/images/client-logos/";
}
