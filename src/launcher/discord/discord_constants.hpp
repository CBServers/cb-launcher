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
}
