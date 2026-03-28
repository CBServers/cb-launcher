#pragma once

#include "commands.hpp"

namespace commands::property_commands
{
    // Registers: get-property, set-property, get-game-property, set-game-property, reset-game-settings
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
