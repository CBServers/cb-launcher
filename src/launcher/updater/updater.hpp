#pragma once

#include "update_cancelled.hpp"
#include "progress_listener.hpp"
#include "ui_progress_listener.hpp"
#include <game_config.hpp>

namespace launcher_updater
{
	void run(const std::filesystem::path& base);
}

namespace game_updater
{
	void run(const game_config::game_config_t& config, bool force_update = false, updater::ui_progress_listener* listener = nullptr);
	size_t get_game_size(const game_config::game_config_t& config);
}

namespace client_updater
{
	void run(const game_config::game_config_t& config, updater::ui_progress_listener* listener = nullptr);
}