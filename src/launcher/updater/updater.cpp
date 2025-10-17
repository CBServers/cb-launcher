#include <std_include.hpp>

#include "updater.hpp"
#include "updater_ui.hpp"
#include "launcher_updater.hpp"
#include "game_updater.hpp"
#include "client_updater.hpp"

#include <version.hpp>

#include <utils/properties.hpp>

namespace launcher_updater
{
	void run(const std::filesystem::path& base)
	{
		const utils::nt::library self;
		const auto self_file = self.get_path();

		updater_ui updater_ui{};
		const launcher_updater launcher_updater{updater_ui, base, self_file};

		launcher_updater.run();

		std::this_thread::sleep_for(1s);
	}
}

namespace game_updater
{
	bool update_needed = false;

	void run(const game_config::game_config_t& config, bool force_update)
	{
		const game_updater game_updater{config, force_update};
		game_updater.run(update_needed);
	}

	bool is_update_needed()
	{
		return update_needed;
	}
}

namespace client_updater
{
	void run(const game_config::game_config_t& config)
	{
		const client_updater client_updater{config};
		client_updater.run();
	}
}
