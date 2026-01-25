#include "std_include.hpp"
#include "info_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/io.hpp>
#include <utils/properties.hpp>
#include <game_config.hpp>
#include <version.hpp>

#include "updater/updater.hpp"
#include "updater/progress_tracker.hpp"

namespace commands::info_commands
{
	void register_commands(cef::cef_ui& cef_ui, command_context&)
	{
		cef_ui.add_command("get-update-progress", [](const auto&, rapidjson::Document& response)
		{
			const auto state = updater::progress_tracker::instance().get_progress();

			response.SetObject();
			auto& allocator = response.GetAllocator();

			response.AddMember("active", state.is_active, allocator);
			response.AddMember("progress", state.progress_percent, allocator);

			rapidjson::Value message_value;
			message_value.SetString(state.status_message.data(), static_cast<rapidjson::SizeType>(state.status_message.length()), allocator);
			response.AddMember("message", message_value, allocator);

			rapidjson::Value file_value;
			file_value.SetString(state.current_file.data(), static_cast<rapidjson::SizeType>(state.current_file.length()), allocator);
			response.AddMember("currentFile", file_value, allocator);

			response.AddMember("totalFiles", state.total_files, allocator);
			response.AddMember("completedFiles", state.completed_files, allocator);
			response.AddMember("totalBytes", state.total_bytes, allocator);
			response.AddMember("downloadedBytes", state.downloaded_bytes, allocator);
		});

		cef_ui.add_command("cancel-update", [](const auto&, rapidjson::Document& response)
		{
			response.SetBool(false); // Default to failure

			updater::progress_tracker::instance().cancel_update();
			response.SetBool(true);
		});

		cef_ui.add_command("set-game-path", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			response.SetBool(false); // Default to failure

			if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("path") || !value.HasMember("existing_install"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };
			const auto path = std::filesystem::path{ value["path"].GetString() };
			const auto existing_install = value["existing_install"].GetBool();

			// Get game config
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return;
			}

			if (existing_install)
			{
				if (!game_config::validate_game_path(game, path))
				{
					return; // Invalid - no valid game exe found
				}

				const auto has_zone_folder = utils::io::directory_exists(path / "zone");
				const auto has_video_folder = utils::io::directory_exists(path / "raw" / "video");
				if (!has_zone_folder && !has_video_folder) //if this is the case, we assume its a steam install (which doesnt have these folders)
				{
					config->set_steam_install(true);
				}
				else
				{
					config->set_steam_install(false);
				}

				// Mark as installed since validation passed
				config->set_installed(true);
			}
			else
			{
				// For new downloads, mark as not installed yet
				config->set_installed(false);
			}

			if (!utils::io::directory_exists(path))
			{
				utils::io::create_directory(path);
			}

			// Path is valid, store it
			config->set_install_path(path.string());
			response.SetBool(true); // Success
		});

		cef_ui.add_command("get-version", [](const rapidjson::Value&, rapidjson::Document& response)
		{
			response.SetObject();
			auto& allocator = response.GetAllocator();

			response.AddMember("version", VERSION, allocator);
			response.AddMember("versionFile", VERSION_FILE, allocator);
			response.AddMember("versionProduct", VERSION_PRODUCT, allocator);
			response.AddMember("gitHash", GIT_HASH, allocator);
			response.AddMember("gitBranch", GIT_BRANCH, allocator);
			response.AddMember("gitDirty", GIT_DIRTY, allocator);
		});

		cef_ui.add_command("check-launcher-update", [](const rapidjson::Value&, rapidjson::Document& response)
		{
			response.SetObject();
			auto& allocator = response.GetAllocator();

			try
			{
#if !defined(DEBUG)
				const auto path = utils::properties::get_appdata_path();
				printf("Checking for launcher updates...\n");
				launcher_updater::run(path);
#endif
				response.AddMember("updateComplete", true, allocator);
			}
			catch (const updater::update_cancelled&)
			{
				printf("Update cancelled by user\n");
				response.AddMember("updateComplete", false, allocator);
			}
			catch (const std::exception& e)
			{
				printf("Update check error: %s\n", e.what());
				response.AddMember("updateComplete", false, allocator);
			}
		});
	}
}
