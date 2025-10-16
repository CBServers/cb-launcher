#pragma once

#include "update_cancelled.hpp"

namespace launcher_updater
{
	void run(const std::filesystem::path& base);
}

namespace game_updater
{
	void run(const std::string& game, bool force_update = false);
}

namespace client_updater
{
	void run(const std::string& game);
}