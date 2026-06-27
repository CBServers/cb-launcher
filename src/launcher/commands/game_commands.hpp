#pragma once

#include "commands.hpp"

#include <string>
#include <string_view>

namespace commands::game_commands
{
    // Registers: launch-game, stop-game, is-game-running, verify-game
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);

    // True if pid is the tracked launcher-launched game with matching id; used to validate IPC clients.
    bool is_tracked_game_pid(unsigned long pid, std::string_view game_id);

    // game_config.id of the game holding the launch barrier (authoritative "what's running"), or empty.
    std::string tracked_game_id();

    // Cold-launch a fork to accept a Discord invite; mode picks the play mode for non-switchable forks. No-op if a game holds the barrier.
    void launch_for_join(const std::string& game_id, const std::string& mode = {});

    // Stop whatever game holds the barrier and launch game_id in mode (mode switch or different game); connect completes via the IPC pending-join.
    void relaunch_for_join(const std::string& game_id, const std::string& mode);
}
