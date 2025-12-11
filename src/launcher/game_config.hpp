#pragma once

#include <string>
#include <unordered_map>
#include <vector>
#include <optional>

namespace game_config
{
	class game_config_t
	{
	public:
		// Generic property access methods
		std::optional<std::string> get(const std::string& property_suffix) const;
		void set(const std::string& property_suffix, const std::string& value) const;

		// List parsing/joining methods
		std::vector<std::string> get_list(const std::string& property_suffix) const;
		void set_list(const std::string& property_suffix, const std::vector<std::string>& values) const;

		// Convenience methods for common properties
		std::optional<std::string> get_install_path() const;
		void set_install_path(const std::string& path) const;
		bool is_installed() const;
		void set_installed(bool installed) const;
		bool is_steam_install() const;
		void set_steam_install(bool is_steam) const;
		std::optional<std::string> get_launch_options() const;

		// Reset all properties for this game
		void reset() const;

		// Get the game key used for this config
		const std::string& get_game_key() const { return game_key; }

		// Public fields
		std::string game_key;  // The map key ("bo3", "ghosts", "hmw", etc.) - must be initialized first
		std::string display_name;
		std::string id;
		std::string exe_name;
		std::string update_manifest_url;
		std::string update_folder_url;
		std::vector<std::string> required_updater_files;
		std::vector<std::string> valid_game_exes;
		std::unordered_map<std::string, std::string> mode_arguments;
		std::string base_url;
		std::string base_game;
		bool check_for_game_updates = false;
		std::string unlock_url_folder;

		// Base properties game for property sharing (e.g., HMW shares with MWR)
		std::string base_properties_game;
		// Property overrides for specific properties (e.g., HMW-specific overrides)
		std::unordered_map<std::string, std::string> property_overrides;

		// Helper to construct full property key (public to maintain aggregate status)
		std::string make_property_key(const std::string& suffix) const;
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
	void reset_all_games();
}