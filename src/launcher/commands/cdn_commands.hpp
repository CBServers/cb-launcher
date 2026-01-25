#pragma once

#include "commands.hpp"

namespace commands::cdn_commands
{
	// Registers: get-cdn-servers, set-cdn-preference, test-cdn-latency
	void register_commands(cef::cef_ui& cef_ui, command_context& ctx);
}
