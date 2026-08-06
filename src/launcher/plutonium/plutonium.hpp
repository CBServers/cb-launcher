#pragma once

#include <filesystem>
#include <string>

// Everything depending on Plutonium's undocumented launcher/updater contract lives here.
namespace plutonium
{
    // %LOCALAPPDATA%\Plutonium, or empty when it can't be resolved.
    std::filesystem::path get_root();
    std::filesystem::path get_launcher_exe();

    // True when their launcher binary is present and a direct launch can be attempted.
    bool is_available();

    // Login token from config.json; empty when missing, blank or unreadable (all mean "not signed in").
    std::string get_token();

    // True when a bootstrapper is already up, i.e. a game is running (possibly started outside CB).
    bool is_game_running();

    // Opens their launcher UI (zero arguments) to sign in. Deliberately not tracked as a game.
    bool open_login_ui();

    // Runs their updater only when the local revision is behind the CDN. Never throws; a CDN failure means "assume current".
    void ensure_updated(const std::filesystem::path& updater_exe);

    struct launch_result
    {
        bool success{false};
        unsigned long bootstrapper_pid{0};
        // True when their launcher went through a UAC prompt, so the game it spawns is high-IL too.
        bool elevated{false};
        // True when that prompt was declined; distinct from a real launch failure.
        bool cancelled{false};
    };

    // Launches via plutonium://play/<game>, killing their launcher on failure before it can spawn a tokenless bootstrapper.
    // `elevate` forces the UAC path up front; a 740 from their exe elevates on its own regardless.
    launch_result launch_via_uri(const std::string& pluto_game, bool elevate = false);
}
