#include "std_include.hpp"
#include "cef/cef_ui.hpp"
#include "updater/updater.hpp"

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
	bool try_lock_termination_barrier()
	{
		static std::atomic_bool barrier{false};

		auto expected = false;
		return barrier.compare_exchange_strong(expected, true);
	}

	void set_working_directory()
	{
		const auto appdata = utils::properties::get_appdata_path();
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

			if (!try_lock_termination_barrier())
			{
				return;
			}

			client_updater::run(game);

			const auto game_directory = std::filesystem::path(game_install->data());
			const auto game_exe = game_directory / config->exe_name;

			if (utils::io::file_exists(game_exe.string()))
			{
				utils::nt::launch_process(game_exe, get_launch_options(launch_args, game), game_directory);
				cef_ui.close_browser();
			}
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

			if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("path"))
			{
				return;
			}

			const auto game = std::string{ value["game"].GetString() };
			const auto path = std::filesystem::path{ value["path"].GetString() };

			// Get game config
			const auto config = game_config::get_game_config(game);
			if (!config)
			{
				return;
			}

			// Validate the path
			if (!game_config::validate_game_path(game, path))
			{
				return; // Invalid - no valid game exe found
			}

			// Path is valid, store it
			utils::properties::store(config->install_property, path.string());
			response.SetBool(true); // Success
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

		if (!utils::flags::has_flag("noupdate"))
		{
			launcher_updater::run(path);
		}
#endif

		if (!is_dedi())
		{
			show_window(lib, path);
		}

		return 0;
	}
	catch (launcher_updater::update_cancelled&)
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
