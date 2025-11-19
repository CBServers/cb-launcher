#include "std_include.hpp"
#include "cef/cef_ui.hpp"
#include "updater/updater.hpp"
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
#include <game_config.hpp>

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

	std::string get_launch_options(const std::string& arg, const std::string& game)
	{
		const auto options = utils::properties::load(std::format("{}-{}", "launch-options", game));
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
			const auto game_install = utils::properties::load(config->install_property);
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
					if (config->check_for_game_updates && game_updater::is_update_needed(*config))
					{
						cef_ui.show_message_box("Game Update Required", "This game requires an update. Please wait for update to complete before you can start playing.");
						game_updater::run(*config, &progress_listener);
					}

					client_updater::run(*config, &progress_listener);

					progress_listener.done_update();

					const auto game_directory = std::filesystem::path(game_install->data());
					const auto game_exe = game_directory / config->exe_name;

					if (utils::io::file_exists(game_exe.string()))
					{
						if (!try_lock_termination_barrier())
						{
							cef_ui.show_message_box("Game Launch Error", "Another game is already running! Please close it before running this game.");
							return;
						}

						const auto pid = utils::nt::launch_process(game_exe, get_launch_options(launch_args, game), game_directory);

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

			updater::ui_progress_listener progress_listener;
			progress_listener.reset(true);

			// Run verification in a separate thread with progress tracking
			std::thread([config, &progress_listener , &cef_ui]()
			{
				try
				{
					// If this game depends on a base game, verify/update the base game files first
					if (!config->base_game.empty())
					{
						const auto base_config = game_config::get_game_config(config->base_game);
						if (base_config)
						{
							game_updater::run(*base_config, &progress_listener);
						}
					}

					game_updater::run(*config, &progress_listener);
					client_updater::run(*config, &progress_listener);
					progress_listener.done_update();
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
					utils::properties::store(config->steam_install_property, "true");
				}
				else
				{
					utils::properties::store(config->steam_install_property, "false");
				}
				

				// Mark as installed since validation passed
				utils::properties::store(config->is_installed_property, "true");
			}
			else
			{
				// For new downloads, mark as not installed yet
				utils::properties::store(config->is_installed_property, "false");
			}

			if (!utils::io::directory_exists(path))
			{
				utils::io::create_directory(path);
			}

			// Path is valid, store it
			utils::properties::store(config->install_property, path.string());
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

		cef_ui.add_command("get-game-download-info", [](const rapidjson::Value& value, rapidjson::Document& response)
		{
			if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("path"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };
			auto path = std::filesystem::path{ value["path"].GetString() };

			// Get game config
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return;
			}

			auto game_size = game_updater::get_game_size(*config);

			if (!config->base_game.empty())
			{
				const auto base_config = game_config::get_game_config(config->base_game);
				if (base_config)
				{
					game_size += game_updater::get_game_size(*base_config);
				}
			}

			// If the path doesn't exist, check parent directories until we find one that exists
			while (!path.empty() && !std::filesystem::exists(path))
			{
				path = path.parent_path();
			}

			// If no valid path found, return without setting response
			if (path.empty())
			{
				return;
			}

			std::filesystem::space_info spaceInfo = std::filesystem::space(path);
			const auto available_space = spaceInfo.available;

			response.SetObject();
			auto& allocator = response.GetAllocator();
			response.AddMember("game_size", game_size, allocator);
			response.AddMember("available_space", available_space, allocator);
		});

		cef_ui.add_command("cancel-update", [](const auto&, rapidjson::Document& response)
		{
			response.SetBool(false); // Default to failure

			updater::progress_tracker::instance().cancel_update();
			response.SetBool(true);

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
