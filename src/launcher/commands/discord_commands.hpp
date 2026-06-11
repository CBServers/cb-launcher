#pragma once

#include "commands.hpp"

namespace commands::discord_commands
{
    // Registers: discord-get-status, discord-link, discord-unlink, discord-get-friends
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
