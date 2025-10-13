#include <std_include.hpp>

#include "updater.hpp"
#include "file_updater.hpp"
#include "utils/properties.hpp"
#include <game_config.hpp>

namespace game_updater
{
	bool update_needed = false;

	void run(const std::string& game, bool force_update)
	{
		// Get game config to retrieve base URL
		const auto config = game_config::get_game_config(game);
		if (!config)
		{
			throw std::runtime_error("Invalid game: " + game);
		}

		if (config->base_url.empty())
		{
			throw std::runtime_error("No base URL configured for game: " + game);
		}

		// Get the install path for this game
		const auto install_path_prop = utils::properties::load(config->install_property);
		if (!install_path_prop || install_path_prop->empty())
		{
			throw std::runtime_error("Game install path not set for: " + game);
		}

		const std::filesystem::path install_path = install_path_prop->data();
		const auto base_url = config->base_url;

		const file_updater file_updater{install_path, base_url, force_update};

		file_updater.run(update_needed);
	}

	bool is_update_needed()
	{
		return update_needed;
	}
}
