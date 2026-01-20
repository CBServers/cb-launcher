#include "std_include.hpp"
#include "cef/cef_ui.hpp"
#include "updater/updater.hpp"
#include "updater/game_updater.hpp"
#include "updater/progress_tracker.hpp"
#include "updater/ui_progress_listener.hpp"
#include "unlockall/unlockall.hpp"

#include <utils/com.hpp>
#include <utils/flags.hpp>
#include <utils/named_mutex.hpp>
#include <utils/exit_callback.hpp>
#include <utils/properties.hpp>
#include <utils/io.hpp>
#include <utils/string.hpp>
#include <utils/cdn.hpp>
#include <game_config.hpp>
#include <version.hpp>

namespace
{
	std::atomic_bool* get_termination_barrier()
	{
		static std::atomic_bool barrier{false};
		return &barrier;
	}

	bool try_lock_termination_barrier()
	{
		auto* barrier = get_termination_barrier();
		auto expected = false;
		return barrier->compare_exchange_strong(expected, true);
	}

	void unlock_termination_barrier()
	{
		auto* barrier = get_termination_barrier();
		barrier->store(false);
	}

	void set_working_directory()
	{
		const auto appdata = utils::properties::get_appdata_path();

		if (!utils::io::directory_exists(appdata / "data"))
		{
			utils::io::create_directory(appdata / "data");
		}

		std::filesystem::current_path(appdata);
	}

	void enable_dpi_awareness()
	{
		const utils::nt::library user32{"user32.dll"};

		const auto set_dpi_awareness_context = user32
			? user32.get_proc<BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT)>("SetProcessDpiAwarenessContext")
			: nullptr;

		// Minimum: Windows 10, version 1703
		if (set_dpi_awareness_context)
		{
			set_dpi_awareness_context(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
			return;
		}

		const utils::nt::library shcore{"shcore.dll"};

		const auto set_dpi_awareness = shcore
			? shcore.get_proc<HRESULT(WINAPI*)(PROCESS_DPI_AWARENESS)>("SetProcessDpiAwareness")
			: nullptr;

		// Minimum: Windows 8.1
		if (set_dpi_awareness)
		{
			set_dpi_awareness(PROCESS_PER_MONITOR_DPI_AWARE);
			return;
		}

		// Call vista function if nothing else was not resolved
		SetProcessDPIAware();
	}

	void run_as_singleton()
	{
		static utils::named_mutex mutex{"cb-launcher"};
		if (!mutex.try_lock(3s))
		{
			throw std::runtime_error{"CB Servers Launcher is already running"};
		}
	}

	bool is_subprocess()
	{
		return strstr(GetCommandLineA(), "--cb-subprocess");
	}

	bool is_dedi()
	{
		return !is_subprocess() && (utils::flags::has_flag("dedicated") || utils::flags::has_flag("update"));
	}

	void run_watchdog()
	{
		std::thread([]()
		{
			const auto parent = utils::nt::get_parent_pid();
			if (utils::nt::wait_for_process(parent))
			{
				std::this_thread::sleep_for(3s);
				utils::nt::terminate();
			}
		}).detach();
	}

	int run_subprocess(const utils::nt::library& process, const std::filesystem::path& path)
	{
		const cef::cef_ui cef_ui{process, path};
		return cef_ui.run_process();
	}

	std::string get_launch_options(const std::string& arg, const game_config::game_config_t& config)
	{
		const auto options = config.get_launch_options();
		if (!options.has_value())
		{
			return arg;
		}

		return std::format("{} {}", arg, options.value());
	}

	void add_commands(cef::cef_ui& cef_ui)
	{
		cef_ui.add_command("launch-game", [&cef_ui](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get mode if provided, otherwise empty string
			const auto mode = value.HasMember("mode") ? std::string{ value["mode"].GetString() } : std::string{};

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Get launch arguments using the utility
			const auto launch_args = game_config::get_launch_arguments(game, mode);
			if (launch_args.empty() && config->mode_arguments.size() > 0)
			{
				return; // Mode required but not provided or invalid
			}

			// Get game installation path
			const auto game_install = config->get_install_path();
			if (!game_install)
			{
				return;
			}

			updater::ui_progress_listener progress_listener;
			progress_listener.reset(true);

			// Run update and launch in a separate thread with progress tracking
			std::thread([config, mode, game, game_install, launch_args, &progress_listener, &cef_ui]()
			{
				try
				{
					// Check for game updates if configured
					game_updater::game_updater game_updater(*config, false, &progress_listener);
					if (config->check_for_game_updates && game_updater.is_update_needed())
					{
						cef_ui.show_message_box("Game Update Required", "This game requires an update. Please wait for update to complete before you can start playing.");
						game_updater.run();
					}

					// Check if HMW and CB extension is disabled
					std::vector<std::string> skip_files;
					if (game == "hmw")
					{
						const auto disable_ext = config->get("disable-cb-extension");
						if (disable_ext && *disable_ext == "true")
						{
							skip_files.push_back("d3d11.dll");
						}
					}

					client_updater::run(*config, &progress_listener, skip_files);

					progress_listener.done_update();

					const auto game_directory = std::filesystem::path(game_install->data());

					// Delete d3d11.dll if HMW and CB extension is disabled
					if (game == "hmw")
					{
						const auto disable_ext = config->get("disable-cb-extension");
						if (disable_ext && *disable_ext == "true")
						{
							const auto dll_path = game_directory / "d3d11.dll";
							if (utils::io::file_exists(dll_path.string()))
							{
								utils::io::remove_file(dll_path);
							}
						}
					}

					const auto game_exe = game_directory / config->exe_name;

					if (utils::io::file_exists(game_exe.string()))
					{
						if (!try_lock_termination_barrier())
						{
							cef_ui.show_message_box("Game Launch Error", "Another game is already running! Please close it before running this game.");
							return;
						}

						const auto pid = utils::nt::launch_process(game_exe, get_launch_options(launch_args, *config), game_directory);

						// Check if launcher should close after game starts
						const auto close_on_launch = utils::properties::load("launcher-close-on-launch");
						if (close_on_launch && *close_on_launch == "true")
						{
							printf("Close on launch enabled - closing launcher\n");
							// Close the launcher browser window
							cef_ui.close_browser();
							return;
						}

						// Spawn watchdog thread to unlock barrier when game exits
						std::thread([pid]()
						{
							if (utils::nt::wait_for_process(pid))
							{
								unlock_termination_barrier();
							}
						}).detach();
					}
				}
				catch (const updater::update_cancelled&)
				{
					progress_listener.cancel_update();
					printf("Update cancelled by user\n");
				}
				catch (const std::exception& e)
				{
					// Set error in progress tracker and show error popup in UI
					progress_listener.cancel_update();
					printf("Launch error: %s\n", e.what());
					cef_ui.show_message_box("Launch Error", e.what());
				}
				catch (...)
				{
					// Set generic error for unknown exceptions
					progress_listener.cancel_update();
					printf("Unknown launch error\n");
					cef_ui.show_message_box("Launch Error", "An unknown error occurred during game launch");
				}
			}).detach();
		});

		cef_ui.add_command("is-game-running", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			response.SetBool(false); // Default to not running

			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Check if the game process is running
			const bool is_running = utils::nt::is_process_running(config->exe_name);
			response.SetBool(is_running);
		});

		cef_ui.add_command("stop-game", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			response.SetBool(false); // Default to failure

			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Attempt to stop the game process
			const bool stopped = utils::nt::stop_process(config->exe_name);
			response.SetBool(stopped);

			// If we successfully stopped the game, unlock the termination barrier
			if (stopped)
			{
				unlock_termination_barrier();
			}
		});

		cef_ui.add_command("verify-game", [&cef_ui](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Check if hash verification should be skipped
			bool skip_hash = false;
			const auto skip_hash_prop = utils::properties::load("launcher-skip-hash-verification");
			if (skip_hash_prop && *skip_hash_prop == "true")
			{
				skip_hash = true;
				printf("Skip hash verification enabled\n");
			}

			// Clear component cache before verification
			config->set("detected-components", "");

			updater::ui_progress_listener progress_listener;
			progress_listener.reset(true);

			// Run verification in a separate thread with progress tracking
			std::thread([config, &progress_listener , &cef_ui, skip_hash]()
			{
				try
				{
					// If this game depends on a base game, verify/update the base game files first
					if (!config->base_game.empty())
					{
						const auto base_config = game_config::get_game_config(config->base_game);
						if (base_config)
						{
							game_updater::run(*base_config, skip_hash, &progress_listener);
						}
					}

					game_updater::run(*config, skip_hash, &progress_listener);

					// Check if HMW and CB extension is disabled
					std::vector<std::string> skip_files;
					if (config->game_key == "hmw")
					{
						const auto disable_ext = config->get("disable-cb-extension");
						if (disable_ext && *disable_ext == "true")
						{
							skip_files.push_back("d3d11.dll");
						}
					}

					client_updater::run(*config, &progress_listener, skip_files);
					progress_listener.done_update();

					cef_ui.show_message_box("Update Complete", config->display_name + " download/verification has completed successfully!");
				}
				catch (const updater::update_cancelled&)
				{
					progress_listener.cancel_update();
					printf("Update cancelled by user\n");
				}
				catch (const std::exception& e)
				{
					// Set error in progress tracker and show error popup in UI
					progress_listener.cancel_update();
					printf("Update error: %s\n", e.what());
					cef_ui.show_message_box("Update Error", e.what());
				}
				catch (...)
				{
					// Set generic error for unknown exceptions
					progress_listener.cancel_update();
					printf("Unknown update error\n");
					cef_ui.show_message_box("Update Error", "An unknown error occurred during update");
				}
			}).detach();
		});

		cef_ui.add_command("unlock-all", [&cef_ui](const rapidjson::Value& value, auto&)
			{
				if (!value.IsObject() || !value.HasMember("game"))
				{
					return;
				}

				const auto game = std::string{ value["game"].GetString() };

				// Get game configuration
				const auto config = game_config::get_game_config(game);
				if (!config)
				{
					return; // Invalid game
				}

				updater::ui_progress_listener progress_listener;
				progress_listener.reset(true);

				std::thread([config, &progress_listener, &cef_ui]()
				{
					try
					{
						unlockall::run(*config, &progress_listener);
						progress_listener.done_update();
						cef_ui.show_message_box("Unlock All Complete", "Unlock all completed successfully! You can now start the game with all content unlocked.");
					}
					catch (const std::exception& e)
					{
						progress_listener.cancel_update();
						printf("Unlock All error: %s\n", e.what());
						cef_ui.show_message_box("Unlock All Error", e.what());
					}
					catch (...)
					{
						progress_listener.cancel_update();
						printf("Unlock All error\n");
						cef_ui.show_message_box("Unlock All Error", "An unknown error occurred during unlock all");
					}
				}).detach();
			});

		cef_ui.add_command("browse-folder", [](const auto&, rapidjson::Document& response)
		{
			response.SetNull();

			std::string folder;
			if (utils::com::select_folder(folder))
			{
				response.SetString(folder, response.GetAllocator());
			}
		});

		cef_ui.add_command("close", [&cef_ui](const auto&, auto&)
		{
			cef_ui.close_browser();
		});

		cef_ui.add_command("minimize", [&cef_ui](const auto&, auto&)
		{
			ShowWindow(cef_ui.get_window(), SW_MINIMIZE);
		});

		cef_ui.add_command("show", [&cef_ui](const auto&, auto&)
		{
			auto* const window = cef_ui.get_window();
			ShowWindow(window, SW_SHOWDEFAULT);
			SetForegroundWindow(window);

			PostMessageA(window, WM_DELAYEDDPICHANGE, 0, 0);
		});

		cef_ui.add_command("open-url", [](const rapidjson::Value& value, auto&)
		{
			if (value.IsObject() && value.HasMember("url") && value["url"].IsString())
			{
				const auto url = value["url"].GetString();
				ShellExecuteA(nullptr, "open", url, nullptr, nullptr, SW_SHOWNORMAL);
			}
		});

		cef_ui.add_command("install-redist", [](const rapidjson::Value&, auto&)
		{
			ShellExecuteA(nullptr, "open", "powershell",
				"-NoProfile -ExecutionPolicy Bypass -Command \"irm https://chse.sh/ri | iex\"",
				nullptr, SW_SHOWNORMAL);
		});

		cef_ui.add_command("set-console-visible", [](const rapidjson::Value& request, rapidjson::Document& response)
		{
			static bool console_allocated = false;

			bool visible = false;
			if (request.HasMember("visible") && request["visible"].IsBool())
			{
				visible = request["visible"].GetBool();
			}

			if (visible)
			{
				if (!console_allocated)
				{
					AllocConsole();
					FILE* fp;
					freopen_s(&fp, "CONOUT$", "w", stdout);
					freopen_s(&fp, "CONOUT$", "w", stderr);
					console_allocated = true;
				}
				ShowWindow(GetConsoleWindow(), SW_SHOW);
			}
			else
			{
				if (console_allocated)
				{
					ShowWindow(GetConsoleWindow(), SW_HIDE);
				}
			}

			response.SetObject();
			response.AddMember("success", true, response.GetAllocator());
		});

		cef_ui.add_command("get-property", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			response.SetNull();

			if (!value.IsString())
			{
				return;
			}

			const auto key = std::string{ value.GetString() };
			const auto property = utils::properties::load(key);
			if (!property)
			{
				return;
			}

			response.SetString(*property, response.GetAllocator());
		});

		cef_ui.add_command("set-property", [](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject())
			{
				return;
			}

			const auto _ = utils::properties::lock();

			for (auto i = value.MemberBegin(); i != value.MemberEnd(); ++i)
			{
				if (!i->value.IsString())
				{
					continue;
				}

				const auto key = std::string{ i->name.GetString() };
				const auto val = std::string{ i->value.GetString() };

				utils::properties::store(key, val);
			}
		});

		cef_ui.add_command("set-game-property", [](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject() || !value.HasMember("game") ||
				!value.HasMember("suffix") || !value.HasMember("value"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };
			const auto suffix = std::string{ value["suffix"].GetString() };
			const auto val = std::string{ value["value"].GetString() };

			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			config->set(suffix, val);
		});

		cef_ui.add_command("get-game-property", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("suffix"))
			{
				response.SetNull();
				return;
			}

			const auto game = std::string{ value["game"].GetString() };
			const auto suffix = std::string{ value["suffix"].GetString() };

			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				response.SetNull();
				return;
			}

			const auto result = config->get(suffix);
			if (result.has_value())
			{
				response.SetString(result->c_str(), static_cast<rapidjson::SizeType>(result->length()), response.GetAllocator());
			}
			else
			{
				response.SetNull();
			}
		});

		cef_ui.add_command("reset-game-settings", [](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			if (game == "all")
			{
				game_config::reset_all_games();
			}
			else
			{
				const auto config = game_config::get_game_config(game);
				if (!config)
				{
					return; // Invalid game
				}

				config->reset();
			}
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

		cef_ui.add_command("get-update-progress", [](const auto&, rapidjson::Document& response)
		{
			const auto state = updater::progress_tracker::instance().get_progress();

			response.SetObject();
			auto& allocator = response.GetAllocator();

			response.AddMember("active", state.is_active, allocator);
			response.AddMember("progress", state.progress_percent, allocator);

			rapidjson::Value message_value;
			message_value.SetString(state.status_message.c_str(), static_cast<rapidjson::SizeType>(state.status_message.length()), allocator);
			response.AddMember("message", message_value, allocator);

			rapidjson::Value file_value;
			file_value.SetString(state.current_file.c_str(), static_cast<rapidjson::SizeType>(state.current_file.length()), allocator);
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

		cef_ui.add_command("get-game-component-info", [&cef_ui](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Check if caller wants to detect existing install (only true for "Manage Install" button)
			bool detect_existing = false;
			if (value.HasMember("detectExisting") && value["detectExisting"].IsBool())
			{
				detect_existing = value["detectExisting"].GetBool();
			}

			// Check if caller wants to force refresh (clear cache)
			bool force_refresh = false;
			if (value.HasMember("forceRefresh") && value["forceRefresh"].IsBool())
			{
				force_refresh = value["forceRefresh"].GetBool();
			}

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Clear cache if force refresh requested
			if (force_refresh && detect_existing)
			{
				config->set_list("detected-components", {});
			}

			// Create single updater instance (fetches manifest once)
			const game_updater::game_updater updater(*config);
			auto components = updater.get_available_components();

			// If this game depends on a base game, add a virtual component for the base game files
			if (!config->base_game.empty())
			{
				const auto base_config = game_config::get_game_config(config->base_game);
				if (base_config)
				{
					try
					{
						// Create updater for base game
						const game_updater::game_updater base_updater(*base_config);
						const auto base_components = base_updater.get_available_components();

						// Filter to required or default components
						std::vector<std::string> base_component_ids;
						for (const auto& comp : base_components)
						{
							if (comp.required || comp.default_enabled)
							{
								base_component_ids.push_back(comp.id);
							}
						}

						// Calculate total size of base game components
						const auto base_total_size = base_updater.calculate_component_size(base_component_ids);

						// Create virtual component representing the base game
						game_updater::component_info virtual_comp;
						virtual_comp.id = "base_game_" + config->base_game;
						virtual_comp.display_name = "Base Game (" + base_config->display_name + ")";
						virtual_comp.required = true;
						virtual_comp.default_enabled = true;
						virtual_comp.show = true;
						virtual_comp.total_size = base_total_size;

						// Prepend virtual component to the list so it appears first
						components.insert(components.begin(), virtual_comp);
					}
					catch (const std::exception& e)
					{
						// If base game component aggregation fails, continue without it
						// The backend will still download base game files correctly
						printf("Warning: Failed to aggregate base game components: %s\n", e.what());
					}
				}
			}

			// Only detect installed components if requested (expensive operation, skip for setup/download flow)
			bool detection_in_progress = false;
			std::vector<std::string> installed;

			if (detect_existing)
			{
				// Try cache first (unless force refresh)
				const auto cached = force_refresh ? std::vector<std::string>{} : config->get_list("detected-components");
				if (!cached.empty())
				{
					// Cache hit - instant response
					installed = cached;
				}
				else
				{
					// Cache miss
					detection_in_progress = true;
					std::thread([config, &cef_ui]() {
						try {
							updater::ui_progress_listener listener;
							listener.reset(true);

							game_updater::game_updater updater(*config, false, &listener);
							const auto detected = updater.detect_installed_components();

							// Cache results
							config->set_list("detected-components", detected);
							if (config->get_list("selected-components").empty())
							{
								config->set_list("selected-components", detected);
							}

							listener.done_update();
						}
						catch (const updater::update_cancelled&) {
							updater::progress_tracker::instance().cancel_update();
						}
						catch (const std::exception& e) {
							updater::progress_tracker::instance().cancel_update();
							cef_ui.show_message_box("Detection Error", e.what());
						}
					}).detach();
				}
			}

			// Build response object
			response.SetObject();
			auto& allocator = response.GetAllocator();

			// Add components metadata
			rapidjson::Value componentsObj(rapidjson::kObjectType);
			for (const auto& comp : components)
			{
				rapidjson::Value compObj(rapidjson::kObjectType);

				rapidjson::Value displayName;
				displayName.SetString(comp.display_name.c_str(), static_cast<rapidjson::SizeType>(comp.display_name.length()), allocator);
				compObj.AddMember("displayName", displayName, allocator);

				compObj.AddMember("required", comp.required, allocator);
				compObj.AddMember("defaultEnabled", comp.default_enabled, allocator);

				rapidjson::Value compId;
				compId.SetString(comp.id.c_str(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
				componentsObj.AddMember(compId, compObj, allocator);
			}
			response.AddMember("components", componentsObj, allocator);

			// Add installed components array
			rapidjson::Value installedArray(rapidjson::kArrayType);
			for (const auto& comp_id : installed)
			{
				rapidjson::Value val;
				val.SetString(comp_id.c_str(), static_cast<rapidjson::SizeType>(comp_id.length()), allocator);
				installedArray.PushBack(val, allocator);
			}
			response.AddMember("installed", installedArray, allocator);
			response.AddMember("detectionInProgress", detection_in_progress, allocator);

			// Add component sizes
			rapidjson::Value sizesObj(rapidjson::kObjectType);
			for (const auto& comp : components)
			{
				size_t size;
				// Virtual base game components already have their size calculated, use it directly
				if (comp.id.starts_with("base_game_"))
				{
					size = comp.total_size;
				}
				else
				{
					std::vector<std::string> single_component = { comp.id };
					size = updater.calculate_component_size(single_component);
				}

				rapidjson::Value compId;
				compId.SetString(comp.id.c_str(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
				sizesObj.AddMember(compId, static_cast<uint64_t>(size), allocator);
			}
			response.AddMember("sizes", sizesObj, allocator);
		});

		cef_ui.add_command("get-available-space", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("path"))
			{
				return;
			}

			auto path = std::filesystem::path{ value["path"].GetString() };

			// If the path doesn't exist, check parent directories until we find one that exists
			while (!path.empty() && !std::filesystem::exists(path))
			{
				path = path.parent_path();
			}

			// If no valid path found, return 0
			uint64_t available_space = 0;
			if (!path.empty())
			{
				std::filesystem::space_info spaceInfo = std::filesystem::space(path);
				available_space = spaceInfo.available;
			}

			response.SetObject();
			auto& allocator = response.GetAllocator();
			response.AddMember("availableSpace", available_space, allocator);
		});

		cef_ui.add_command("get-game-components", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			const game_updater::game_updater updater(*config);
			const auto components = updater.get_available_components();

			// Build response as object with component details
			response.SetObject();
			auto& allocator = response.GetAllocator();

			for (const auto& comp : components)
			{
				rapidjson::Value compObj(rapidjson::kObjectType);

				rapidjson::Value displayName;
				displayName.SetString(comp.display_name.c_str(), static_cast<rapidjson::SizeType>(comp.display_name.length()), allocator);
				compObj.AddMember("displayName", displayName, allocator);

				compObj.AddMember("required", comp.required, allocator);
				compObj.AddMember("defaultEnabled", comp.default_enabled, allocator);

				rapidjson::Value compId;
				compId.SetString(comp.id.c_str(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
				response.AddMember(compId, compObj, allocator);
			}
		});

		cef_ui.add_command("detect-installed-components", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			const game_updater::game_updater updater(*config);
			const auto installed = updater.detect_installed_components();

			// Build response as array of component IDs
			response.SetArray();
			auto& allocator = response.GetAllocator();

			for (const auto& comp_id : installed)
			{
				rapidjson::Value val;
				val.SetString(comp_id.c_str(), static_cast<rapidjson::SizeType>(comp_id.length()), allocator);
				response.PushBack(val, allocator);
			}
		});

		cef_ui.add_command("set-game-components", [](const rapidjson::Value& value, auto&)
		{
			if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("components"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			// Parse components array
			if (!value["components"].IsArray())
			{
				return;
			}

			const auto& componentsArray = value["components"];
			std::vector<std::string> components_vec;

			for (rapidjson::SizeType i = 0; i < componentsArray.Size(); ++i)
			{
				if (componentsArray[i].IsString())
				{
					components_vec.push_back(componentsArray[i].GetString());
				}
			}

			// Store selected components using list helper
			config->set_list("selected-components", components_vec);
		});

		cef_ui.add_command("get-component-sizes", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };

			// Get game configuration
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return; // Invalid game
			}

			const game_updater::game_updater updater(*config);
			auto components = updater.get_available_components();

			// If this game depends on a base game, add a virtual component for the base game files
			if (!config->base_game.empty())
			{
				const auto base_config = game_config::get_game_config(config->base_game);
				if (base_config)
				{
					try
					{
						const game_updater::game_updater base_updater(*base_config);
						const auto base_components = base_updater.get_available_components();

						std::vector<std::string> base_component_ids;
						for (const auto& comp : base_components)
						{
							if (comp.required || comp.default_enabled)
							{
								base_component_ids.push_back(comp.id);
							}
						}

						const auto base_total_size = base_updater.calculate_component_size(base_component_ids);

						game_updater::component_info virtual_comp;
						virtual_comp.id = "base_game_" + config->base_game;
						virtual_comp.display_name = "Base Game (" + base_config->display_name + ")";
						virtual_comp.required = true;
						virtual_comp.default_enabled = true;
						virtual_comp.show = true;
						virtual_comp.total_size = base_total_size;

						components.insert(components.begin(), virtual_comp);
					}
					catch (const std::exception& e)
					{
						printf("Warning: Failed to aggregate base game components: %s\n", e.what());
					}
				}
			}

			// Build response as object with component sizes
			response.SetObject();
			auto& allocator = response.GetAllocator();

			for (const auto& comp : components)
			{
				size_t size;
				// Virtual base game components already have their size calculated, use it directly
				if (comp.id.starts_with("base_game_"))
				{
					size = comp.total_size;
				}
				else
				{
					std::vector<std::string> single_component = { comp.id };
					size = updater.calculate_component_size(single_component);
				}

				rapidjson::Value compId;
				compId.SetString(comp.id.c_str(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
				response.AddMember(compId, static_cast<uint64_t>(size), allocator);
			}
		});

		cef_ui.add_command("get-cdn-servers", [](const rapidjson::Value&, rapidjson::Document& response)
		{
			response.SetObject();
			auto& allocator = response.GetAllocator();

			auto& cdn = utils::cdn::cdn_manager::instance();
			const auto servers = cdn.get_servers();
			const auto preference = cdn.get_preference();
			const auto& cached_latency = cdn.get_cached_latency();

			// Add preference
			rapidjson::Value pref_value;
			const auto pref_str = utils::cdn::cdn_manager::region_to_string(preference);
			pref_value.SetString(pref_str.c_str(), static_cast<rapidjson::SizeType>(pref_str.length()), allocator);
			response.AddMember("preference", pref_value, allocator);

			// Add servers array
			rapidjson::Value servers_array(rapidjson::kArrayType);
			for (const auto& server : servers)
			{
				rapidjson::Value server_obj(rapidjson::kObjectType);

				rapidjson::Value region_val;
				const auto region_str = utils::cdn::cdn_manager::region_to_string(server.region);
				region_val.SetString(region_str.c_str(), static_cast<rapidjson::SizeType>(region_str.length()), allocator);
				server_obj.AddMember("region", region_val, allocator);

				rapidjson::Value name_val;
				name_val.SetString(server.name.c_str(), static_cast<rapidjson::SizeType>(server.name.length()), allocator);
				server_obj.AddMember("name", name_val, allocator);

				rapidjson::Value url_val;
				url_val.SetString(server.url.c_str(), static_cast<rapidjson::SizeType>(server.url.length()), allocator);
				server_obj.AddMember("url", url_val, allocator);

				if (server.latency_ms.has_value())
				{
					server_obj.AddMember("latency", server.latency_ms.value(), allocator);
				}
				else
				{
					server_obj.AddMember("latency", rapidjson::Value(rapidjson::kNullType), allocator);
				}

				servers_array.PushBack(server_obj, allocator);
			}
			response.AddMember("servers", servers_array, allocator);

			// Add recommended server if latency was tested
			if (cached_latency.success)
			{
				rapidjson::Value rec_val;
				const auto rec_str = utils::cdn::cdn_manager::region_to_string(cached_latency.recommended);
				rec_val.SetString(rec_str.c_str(), static_cast<rapidjson::SizeType>(rec_str.length()), allocator);
				response.AddMember("recommended", rec_val, allocator);
			}
			else
			{
				response.AddMember("recommended", rapidjson::Value(rapidjson::kNullType), allocator);
			}
		});

		cef_ui.add_command("set-cdn-preference", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			response.SetBool(false);

			if (!value.IsObject() || !value.HasMember("region"))
			{
				return;
			}

			const auto region_str = std::string{ value["region"].GetString() };
			const auto region = utils::cdn::cdn_manager::string_to_region(region_str);

			auto& cdn = utils::cdn::cdn_manager::instance();
			cdn.set_preference(region);

			response.SetBool(true);
		});

		cef_ui.add_command("test-cdn-latency", [](const rapidjson::Value&, rapidjson::Document& response)
		{
			response.SetObject();
			auto& allocator = response.GetAllocator();

			auto& cdn = utils::cdn::cdn_manager::instance();
			const auto result = cdn.test_all_latencies();

			response.AddMember("success", result.success, allocator);

			// Add servers array with latencies
			rapidjson::Value servers_array(rapidjson::kArrayType);
			for (const auto& server : result.servers)
			{
				rapidjson::Value server_obj(rapidjson::kObjectType);

				rapidjson::Value region_val;
				const auto region_str = utils::cdn::cdn_manager::region_to_string(server.region);
				region_val.SetString(region_str.c_str(), static_cast<rapidjson::SizeType>(region_str.length()), allocator);
				server_obj.AddMember("region", region_val, allocator);

				rapidjson::Value name_val;
				name_val.SetString(server.name.c_str(), static_cast<rapidjson::SizeType>(server.name.length()), allocator);
				server_obj.AddMember("name", name_val, allocator);

				if (server.latency_ms.has_value())
				{
					server_obj.AddMember("latency", server.latency_ms.value(), allocator);
				}
				else
				{
					server_obj.AddMember("latency", rapidjson::Value(rapidjson::kNullType), allocator);
				}

				servers_array.PushBack(server_obj, allocator);
			}
			response.AddMember("servers", servers_array, allocator);

			// Add recommended server
			rapidjson::Value rec_val;
			const auto rec_str = utils::cdn::cdn_manager::region_to_string(result.recommended);
			rec_val.SetString(rec_str.c_str(), static_cast<rapidjson::SizeType>(rec_str.length()), allocator);
			response.AddMember("recommended", rec_val, allocator);
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

	void show_window(const utils::nt::library& process, const std::filesystem::path& path)
	{
		cef::cef_ui cef_ui{process, path};
		add_commands(cef_ui);
		cef_ui.create(path / "data" / "launcher-ui", "main.html");
		cef::cef_ui::work();
	}
}

int CALLBACK WinMain(const HINSTANCE instance, HINSTANCE, LPSTR, int)
{
	try
	{
		set_working_directory();

		const utils::nt::library lib{instance};
		const auto path = utils::properties::get_appdata_path();

		if (is_subprocess())
		{
			run_watchdog();
			return run_subprocess(lib, path);
		}

		enable_dpi_awareness();

#if !defined(DEBUG)
		run_as_singleton();
#else
		AllocConsole();
		FILE* fp;
		freopen_s(&fp, "CONOUT$", "w", stdout);
		freopen_s(&fp, "CONOUT$", "w", stderr);
		printf("Debug console enabled\n");
#endif

		if (!utils::flags::has_flag("noupdate"))
		{
			launcher_updater::run(path);
		}

		if (!is_dedi())
		{
			show_window(lib, path);
		}

		return 0;
	}
	catch (updater::update_cancelled&)
	{
		return 0;
	}
	catch (std::exception& e)
	{
		MessageBoxA(nullptr, e.what(), "ERROR", MB_ICONERROR);
	}
	catch (...)
	{
		MessageBoxA(nullptr, "An unknown error occurred", "ERROR", MB_ICONERROR);
	}

	return 1;
}
