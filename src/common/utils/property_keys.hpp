#pragma once

namespace property_keys
{
    // Launcher settings
    constexpr const char* CLOSE_ON_LAUNCH = "launcher-close-on-launch";
    constexpr const char* SKIP_HASH_VERIFICATION = "launcher-skip-hash-verification";
    constexpr const char* SKIP_CLIENT_UPDATE = "launcher-skip-client-update";
    constexpr const char* SHORTCUT_CREATED = "launcher-shortcut-created";
    constexpr const char* START_MENU_SHORTCUT_CREATED = "launcher-start-menu-shortcut-created";
    constexpr const char* CDN_PREFERENCE = "launcher-cdn-preference";
    constexpr const char* CDN_CUSTOM_URL = "launcher-cdn-custom-url";
    constexpr const char* GLOBAL_PLAYER_NAME = "launcher-global-player-name";

    // Discord account link (tokens are DPAPI-encrypted + base64)
    constexpr const char* DISCORD_ACCESS_TOKEN = "launcher-discord-access-token";
    constexpr const char* DISCORD_REFRESH_TOKEN = "launcher-discord-refresh-token";
    constexpr const char* DISCORD_TOKEN_EXPIRY = "launcher-discord-token-expiry";
    constexpr const char* DISCORD_USER_ID = "launcher-discord-user-id";
    constexpr const char* DISCORD_DISPLAY_NAME = "launcher-discord-display-name";

    // Game property suffixes (used with game_config_t::get/set)
    constexpr const char* INSTALL = "install";
    constexpr const char* IS_INSTALLED = "is-installed";
    constexpr const char* IS_STEAM_INSTALL = "is-steam-install";
    constexpr const char* LAUNCH_OPTIONS = "launch-options";
    constexpr const char* PLAYER_NAME_OVERRIDE = "player-name-override";
    constexpr const char* GAME_MODE = "game-mode";
    constexpr const char* SKIP_INTRO_CINEMATIC = "skip-intro-cinematic";
    constexpr const char* LAUNCH_ADMIN = "launch-admin";

    // Game component settings (used with game config get/set)
    constexpr const char* DETECTED_COMPONENTS = "detected-components";
    constexpr const char* SELECTED_COMPONENTS = "selected-components";
    constexpr const char* DISABLE_CB_EXTENSION = "disable-cb-extension";

    // Custom resolution (CoD1 / CoDUO / CoD2 only)
    constexpr const char* CUSTOM_RESOLUTION_ENABLED = "custom-resolution-enabled";
    constexpr const char* CUSTOM_RESOLUTION_WIDTH = "custom-resolution-width";
    constexpr const char* CUSTOM_RESOLUTION_HEIGHT = "custom-resolution-height";

    // Game-specific settings
    constexpr const char* BO3_SKIP_INTRO_CINEMATIC = "bo3-skip-intro-cinematic";
}
