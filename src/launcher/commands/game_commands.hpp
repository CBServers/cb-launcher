#pragma once

#include "commands.hpp"

namespace commands::game_commands
{
    // Registers: launch-game, stop-game, is-game-running, verify-game, unlock-all
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
