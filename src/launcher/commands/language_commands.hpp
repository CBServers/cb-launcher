#pragma once

#include "commands.hpp"
#include <string_view>

namespace commands::language_commands
{
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
    bool active();
    bool active_for(std::string_view game);
    bool blocks_game(const game_config::game_config_t& config);
} // namespace commands::language_commands
