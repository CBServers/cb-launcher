#include "std_include.hpp"
#include "game_config.hpp"
#include <utils/properties.hpp>

namespace game_config
{
	const std::unordered_map<std::string, game_config_t> game_configs_ = {
		{
			"bo3",
			{
				.display_name = "Black Ops 3",
				.install_property = "bo3-install",
				.ui_id = "boiii",
				.exe_name = "boiii.exe",
				.mode_arguments = {},
			}
		},
		{
			"ghosts",
			{
				.display_name = "Ghosts",
				.install_property = "ghosts-install",
				.ui_id = "iw6x",
				.exe_name = "iw6x.exe",
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"}
				}
			}
		},
		{
			"aw",
			{
				.display_name = "Advanced Warfare",
				.install_property = "aw-install",
				.ui_id = "s1x",
				.exe_name = "s1x.exe",
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"},
					{"zm", "-zombies"},
					{"sv", "-survival"}
				}
			}
		},
		{
			"mwr",
			{
				.display_name = "Modern Warfare Remastered",
				.install_property = "mwr-install",
				.ui_id = "h1-mod",
				.exe_name = "h1-mod.exe",
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"}
				}
			}
		},
		{
			"iw",
			{
				.display_name = "Infinite Warfare",
				.install_property = "iw-install",
				.ui_id = "iw7-mod",
				.exe_name = "iw7-mod.exe",
				.mode_arguments = {}
			}
		},
		{
			"hmw",
			{
				.display_name = "HorizonMW",
				.install_property = "hmw-install",
				.ui_id = "hmw-mod",
				.exe_name = "hmw-mod.exe",
				.mode_arguments = {}
			}
		}
	};

	const std::unordered_map<std::string, std::string> ui_to_backend_mapping_ = {
		{"boiii", "bo3"},
		{"iw6x", "ghosts"},
		{"s1x", "aw"},
		{"h1-mod", "mwr"},
		{"iw7-mod", "iw"},
		{"hmw-mod", "hmw"}
	};

	std::optional<game_config_t> get_game_config(const std::string& game)
	{
		const auto it = game_configs_.find(game);
		if (it != game_configs_.end())
		{
			return it->second;
		}
		return std::nullopt;
	}

	bool has_multiple_modes(const std::string& game)
	{
		const auto config = get_game_config(game);
		return config ? config->mode_arguments.size() > 0 : false;
	}

	std::optional<std::string> get_mode_argument(const std::string& game, const std::string& mode)
	{
		const auto config = get_game_config(game);
		if (!config)
		{
			return std::nullopt;
		}

		const auto it = config->mode_arguments.find(mode);
		if (it != config->mode_arguments.end())
		{
			return it->second;
		}

		return std::nullopt;
	}

	std::string get_launch_arguments(const std::string& game, const std::string& mode)
	{
		const auto config = get_game_config(game);
		if (!config)
		{
			return "";
		}

		// For games with modes
		if (config->mode_arguments.size() > 0)
		{
			if (mode.empty())
			{
				return ""; // Mode required but not provided
			}

			const auto mode_arg = get_mode_argument(game, mode);
			return mode_arg.value_or("");
		}
		else
		{
			// Games with no modes use -launch argument
			std::string launch_args = "-launch";

			// Special handling for BO3 cinematic setting
			if (game == "bo3")
			{
				const auto cinematic_setting = utils::properties::load("bo3-skip-intro-cinematic");
				if (cinematic_setting && cinematic_setting->data() == std::string("true"))
				{
					launch_args += " -nointro";
				}
			}

			return launch_args;
		}
	}
}