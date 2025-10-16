#include "std_include.hpp"
#include "game_config.hpp"
#include <utils/properties.hpp>
#include <utils/io.hpp>

#define CLIENT_UPDATE_SERVER "https://github.com/CBServers/updater/raw/main/updater/"
#define GAME_UPDATE_SERVER "https://cdn.brad.stream/"

namespace game_config
{
	const std::unordered_map<std::string, game_config_t> game_configs_ = {
		{
			"bo3",
			{
				.display_name = "Black Ops 3",
				.install_property = "bo3-install",
				.id = "boiii",
				.exe_name = "boiii.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "boiii.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "boiii/",
				.required_updater_files = {"boiii.exe"},
				.valid_game_exes = {"BlackOps3.exe"},
				.mode_arguments = {},
				.base_url = GAME_UPDATE_SERVER "bo3_game_files"
			}
		},
		{
			"ghosts",
			{
				.display_name = "Ghosts",
				.install_property = "ghosts-install",
				.id = "iw6x",
				.exe_name = "iw6x.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "iw6x.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "iw6x/",
				.required_updater_files = {"iw6x.exe"},
				.valid_game_exes = {"iw6mp64_ship.exe", "iw6mp64_ship.exe"},
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"}
				},
				.base_url = GAME_UPDATE_SERVER "ghosts_game_files"
			}
		},
		{
			"aw",
			{
				.display_name = "Advanced Warfare",
				.install_property = "aw-install",
				.id = "s1x",
				.exe_name = "s1x.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "s1x.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "s1x/",
				.required_updater_files = {"s1x.exe"},
				.valid_game_exes = {"s1_sp64_ship.exe", "s1_mp64_ship.exe"},
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"},
					{"zm", "-zombies"},
					{"sv", "-survival"}
				},
				.base_url = GAME_UPDATE_SERVER "aw_game_files"
			}
		},
		{
			"mwr",
			{
				.display_name = "Modern Warfare Remastered",
				.install_property = "mwr-install",
				.id = "h1-mod",
				.exe_name = "h1-mod.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "h1-mod/files.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "h1-mod/data/",
				.required_updater_files = {"h1-mod.exe"},
				.valid_game_exes = {"h1_sp64_ship.exe", "h1_mp64_ship.exe"},
				.mode_arguments = {
					{"sp", "-singleplayer"},
					{"mp", "-multiplayer"}
				},
				.base_url = "mwr_game_files"
			}
		},
		{
			"iw",
			{
				.display_name = "Infinite Warfare",
				.install_property = "iw-install",
				.id = "iw7-mod",
				.exe_name = "iw7-mod.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "iw7-mod/files.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "iw7-mod/data/",
				.required_updater_files = {"iw7-mod.exe"},
				.valid_game_exes = {"iw7_ship.exe"},
				.mode_arguments = {},
				.base_url = GAME_UPDATE_SERVER "iw_game_files"
			},
			
		},
		{
			"hmw",
			{
				.display_name = "HorizonMW",
				.install_property = "hmw-install",
				.id = "hmw-mod",
				.exe_name = "hmw-mod.exe",
				.update_manifest_url = CLIENT_UPDATE_SERVER "h2m.json",
				.update_folder_url = CLIENT_UPDATE_SERVER "h2m/",
				.required_updater_files = {"hmw-mod.exe", "d3d11.dll"},
				.valid_game_exes = {"h1_mp64_ship.exe"},
				.mode_arguments = {},
				.base_url = GAME_UPDATE_SERVER "mwr_game_files"
			},
			
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

	bool validate_game_path(const std::string& game, const std::filesystem::path& path)
	{
		const auto config = get_game_config(game);
		if (!config)
		{
			return false;
		}

		// Check if any of the valid game executables exist
		for (const auto& exe : config->valid_game_exes)
		{
			const auto exe_path = path / exe;
			if (utils::io::file_exists(exe_path.string()))
			{
				return true;
			}
		}

		return false;
	}
}