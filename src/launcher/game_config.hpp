#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <optional>

namespace game_config
{
	struct game_config_t
	{
		std::string display_name;
		std::string install_property;
		std::string id;
		std::string exe_name;
		std::string update_manifest_url;
		std::string update_folder_url;
		std::vector<std::string> required_updater_files;
		std::vector<std::string> valid_game_exes;
		std::unordered_map<std::string, std::string> mode_arguments;
		std::string base_url;
	};

	// Forward declarations
	extern const std::unordered_map<std::string, game_config_t> game_configs_;
	extern const std::unordered_map<std::string, std::string> ui_to_backend_mapping_;

	// Function declarations
	std::optional<game_config_t> get_game_config(const std::string& game);
	bool has_multiple_modes(const std::string& game);
	std::optional<std::string> get_mode_argument(const std::string& game, const std::string& mode);
	std::string get_launch_arguments(const std::string& game, const std::string& mode = "");
	bool validate_game_path(const std::string& game, const std::filesystem::path& path);
}