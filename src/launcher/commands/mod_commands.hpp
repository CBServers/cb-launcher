#pragma once
#include "commands.hpp"

namespace commands::mod_commands
{
    // Registers: get-mods-folder, get-installed-mods, import-mod, get-mod-progress, uninstall-mod, browse-file
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
