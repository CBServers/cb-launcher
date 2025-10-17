#pragma once

#include "update_cancelled.hpp"
#include <game_config.hpp>

namespace launcher_updater
{
	void run(const std::filesystem::path& base);
}

namespace game_updater
{
	void run(const game_config::game_config_t& config, bool force_update = false);
}

namespace client_updater
{
	void run(const game_config::game_config_t& config);
}