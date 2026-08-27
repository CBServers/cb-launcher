#pragma once

#include "commands.hpp"

namespace commands::social_commands
{
    // Registers the cbfriends-* commands: profile, friends, invites, community.
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
