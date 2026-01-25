#pragma once

#include "commands.hpp"

namespace commands::component_commands
{
	// Registers: get-game-component-info, get-game-components, detect-installed-components,
	//            set-game-components, get-component-sizes, get-available-space
	void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
