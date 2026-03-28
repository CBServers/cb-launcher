#pragma once

#include "commands.hpp"

namespace commands::ui_commands
{
    // Registers: close, minimize, show, open-url, install-redist, set-console-visible, browse-folder
    void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
