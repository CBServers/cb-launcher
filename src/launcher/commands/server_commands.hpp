#pragma once
#include "commands.hpp"

namespace commands::server_commands
{
    // Registers: ping-servers
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
