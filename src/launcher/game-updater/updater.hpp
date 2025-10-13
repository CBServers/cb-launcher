#pragma once

#include <utils/nt.hpp>
#include <string>

namespace game_updater
{
	void run(const std::string& game, bool force_update = false);
	bool is_update_needed();
}
