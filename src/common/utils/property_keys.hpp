#pragma once

namespace property_keys
{
    // Launcher settings
    constexpr const char* CLOSE_ON_LAUNCH = "launcher-close-on-launch";
    constexpr const char* SKIP_HASH_VERIFICATION = "launcher-skip-hash-verification";
    constexpr const char* SKIP_CLIENT_UPDATE = "launcher-skip-client-update";
    constexpr const char* SHORTCUT_CREATED = "launcher-shortcut-created";
    constexpr const char* CDN_PREFERENCE = "launcher-cdn-preference";
    constexpr const char* GLOBAL_PLAYER_NAME = "launcher-global-player-name";

    // Game property suffixes (used with game_config_t::get/set)
    constexpr const char* INSTALL = "install";
    constexpr const char* IS_INSTALLED = "is-installed";
    constexpr const char* IS_STEAM_INSTALL = "is-steam-install";
    constexpr const char* LAUNCH_OPTIONS = "launch-options";
    constexpr const char* IGNORE_GLOBAL_NAME = "ignore-global-name";

    // Game component settings (used with game config get/set)
    constexpr const char* DETECTED_COMPONENTS = "detected-components";
    constexpr const char* SELECTED_COMPONENTS = "selected-components";
    constexpr const char* DISABLE_CB_EXTENSION = "disable-cb-extension";

    // Game-specific settings
    constexpr const char* BO3_SKIP_INTRO_CINEMATIC = "bo3-skip-intro-cinematic";
}
