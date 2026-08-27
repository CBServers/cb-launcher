#pragma once

namespace property_keys
{
    // Launcher settings
    constexpr const char* CLOSE_ON_LAUNCH = "launcher-close-on-launch";
    constexpr const char* SKIP_HASH_VERIFICATION = "launcher-skip-hash-verification";
    constexpr const char* SKIP_CLIENT_UPDATE = "launcher-skip-client-update";
    constexpr const char* SKIP_REDIST_CHECK = "launcher-skip-redist-check";
    constexpr const char* SHORTCUT_CREATED = "launcher-shortcut-created";
    constexpr const char* START_MENU_SHORTCUT_CREATED = "launcher-start-menu-shortcut-created";
    constexpr const char* DESKTOP_NOTIFICATIONS = "launcher-desktop-notifications";
    constexpr const char* REDUCE_MOTION = "launcher-reduce-motion";
    constexpr const char* CDN_PREFERENCE = "launcher-cdn-preference";
    constexpr const char* CDN_CUSTOM_URL = "launcher-cdn-custom-url";
    constexpr const char* GLOBAL_PLAYER_NAME = "launcher-global-player-name";
    // One-shot flag: installs predating the IW3x default were seeded onto CoD4x for MP.
    constexpr const char* COD4X_CLIENT_SEEDED = "launcher-cod4x-client-seeded";

    // Discord account link (tokens are DPAPI-encrypted + base64)
    constexpr const char* DISCORD_ACCESS_TOKEN = "launcher-discord-access-token";
    constexpr const char* DISCORD_REFRESH_TOKEN = "launcher-discord-refresh-token";
    constexpr const char* DISCORD_TOKEN_EXPIRY = "launcher-discord-token-expiry";
    constexpr const char* DISCORD_USER_ID = "launcher-discord-user-id";
    constexpr const char* DISCORD_DISPLAY_NAME = "launcher-discord-display-name";

    // CB social device identity (ECC private key, DPAPI-encrypted + base64)
    constexpr const char* CB_DEVICE_PRIVATE_KEY = "launcher-cb-device-key";

    // CB social account (profile cached as JSON; recovery code is DPAPI-encrypted + base64)
    constexpr const char* CB_ACCOUNT_ID = "launcher-cb-account-id";
    constexpr const char* CB_PROFILE = "launcher-cb-profile";
    constexpr const char* CB_RECOVERY_CODE = "launcher-cb-recovery-code";

    // CB community broadcast toggle (opt-in discovery by non-friends) + its details
    constexpr const char* CB_BROADCAST = "launcher-cb-broadcast";
    constexpr const char* CB_BROADCAST_GAME = "launcher-cb-broadcast-game";
    constexpr const char* CB_BROADCAST_NOTE = "launcher-cb-broadcast-note";
    constexpr const char* CB_BROADCAST_SLOTS = "launcher-cb-broadcast-slots";

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
    // Manifest hash + install path the detection ran against; mismatch = cache unknown
    constexpr const char* DETECTED_COMPONENTS_STAMP = "detected-components-stamp";
    // + mode ("selected-client-mp"): which client serves a mode with more than one.
    constexpr const char* SELECTED_CLIENT_PREFIX = "selected-client-";
    constexpr const char* SELECTED_COMPONENTS = "selected-components";
    constexpr const char* DISABLE_CB_EXTENSION = "disable-cb-extension";

    // Custom resolution (CoD1 / CoDUO / CoD2 only)
    constexpr const char* CUSTOM_RESOLUTION_ENABLED = "custom-resolution-enabled";
    constexpr const char* CUSTOM_RESOLUTION_WIDTH = "custom-resolution-width";
    constexpr const char* CUSTOM_RESOLUTION_HEIGHT = "custom-resolution-height";

    // Game-specific settings
    constexpr const char* BO3_SKIP_INTRO_CINEMATIC = "bo3-skip-intro-cinematic";
}
