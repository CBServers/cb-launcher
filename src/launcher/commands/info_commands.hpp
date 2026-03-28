#pragma once

#include "commands.hpp"

namespace commands::info_commands
{
    // Registers: get-version, get-update-progress, cancel-update, check-launcher-update, set-game-path
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
