#pragma once

#include <game_config.hpp>
#include <rapidjson/document.h>
#include <optional>
#include <vector>
#include <string>

namespace cef
{
	class cef_ui;
}

namespace game_updater
{
	struct component_info;
	class game_updater;
}

namespace commands
{
	struct command_context
	{
		cef::cef_ui& cef_ui;

		// Returns nullopt if validation fails (no game in request or invalid game)
		std::optional<game_config::game_config_t> get_game_config_from_request(
			const rapidjson::Value& request) const;

		// Returns list of files to skip for this game based on configuration
		std::vector<std::string> get_skip_files(
			const std::string& game,
			const game_config::game_config_t& config) const;

		// Adds a virtual "base_game_X" component representing base game files
		void aggregate_base_game_components(
			const game_config::game_config_t& config,
			std::vector<game_updater::component_info>& components) const;
	};

	// Register all commands with the CEF UI
	void register_all_commands(cef::cef_ui& cef_ui);
}
