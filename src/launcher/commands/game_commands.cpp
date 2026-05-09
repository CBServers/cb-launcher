#include "std_include.hpp"
#include "game_commands.hpp"
#include <utils/property_keys.hpp>
#include "cef/cef_ui.hpp"

#include <utils/io.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/registry.hpp>
#include <game_config.hpp>

#include "updater/updater.hpp"
#include "updater/game_updater.hpp"
#include "updater/client_updater.hpp"
#include "updater/ui_progress_listener.hpp"
#include "unlockall/unlockall.hpp"

namespace commands::game_commands
{
    namespace
    {
        std::atomic_bool* get_termination_barrier()
        {
            static std::atomic_bool barrier{ false };
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

        void apply_post_client_update(const game_config::game_config_t& config)
        {
            if (config.game_key == "cod4x")
            {
                const std::wstring subkey = L"SOFTWARE\\Activision\\Call of Duty 4";
                const std::wstring value_name = L"codkey";
                if (!utils::registry::hkcu_string_value_exists(subkey, value_name))
                {
                    if (!utils::registry::set_hkcu_string(subkey, value_name, L"LQTTDUYYEEPDMWWGA36F"))
                    {
                        printf("Failed to write COD4 codkey registry value\n");
                    }
                }
            }
        }

        std::string trim_ws(std::string s)
        {
            const auto first = s.find_first_not_of(" \t\r\n");
            if (first == std::string::npos) return "";
            const auto last = s.find_last_not_of(" \t\r\n");
            return s.substr(first, last - first + 1);
        }

        std::string sanitize_player_name(std::string name)
        {
            name.erase(std::remove(name.begin(), name.end(), '"'), name.end());
            name = trim_ws(std::move(name));
            if (name.size() > 16) name.resize(16);
            return name;
        }

        // Returns the effective player name to inject for this game, or empty when
        // nothing should be injected (game doesn't support a name argument, or no
        // override / global is set).
        std::string resolve_player_name(const game_config::game_config_t& config)
        {
            if (config.name_argument.empty()) return "";

            const auto override_val = config.get(property_keys::PLAYER_NAME_OVERRIDE);
            if (override_val && !override_val->empty())
            {
                auto sanitized = sanitize_player_name(*override_val);
                // Backend safety: ignore overrides that fail the 3-char minimum.
                if (sanitized.size() >= 3) return sanitized;
            }

            const auto global = utils::properties::load(property_keys::GLOBAL_PLAYER_NAME);
            if (!global) return "";
            return sanitize_player_name(*global);
        }

        std::string format_name_arg(const std::string& prefix, const std::string& name)
        {
            if (prefix.empty() || name.empty()) return "";
            // Names without whitespace don't need quoting; avoids embedding inner
            // double-quotes in the wrapper's --pass "..." token.
            if (name.find_first_of(" \t") == std::string::npos)
            {
                return std::format("{} {}", prefix, name);
            }
            return std::format("{} \"{}\"", prefix, name);
        }

        std::string build_launch_args(const std::string& base_args, const std::string& mode,
            const game_config::game_config_t& config, const std::string& player_name)
        {
            const auto user_options = config.get_launch_options().value_or("");
            const auto name_arg = format_name_arg(config.name_argument, player_name);

            // Modes that route through a wrapper launcher (e.g. AlterWare) need
            // their built-in pass-args + the user's options forwarded as a single
            // quoted token after --pass.
            const auto pass_it = config.mode_pass_arguments.find(mode);
            if (pass_it != config.mode_pass_arguments.end())
            {
                const auto inner = trim_ws(std::format("{} {} {}", pass_it->second, user_options, name_arg));
                if (inner.empty())
                {
                    return base_args;
                }
                return std::format("{} --pass \"{}\"", base_args, inner);
            }

            const auto extras = trim_ws(std::format("{} {}", user_options, name_arg));
            if (extras.empty()) return base_args;
            return std::format("{} {}", base_args, extras);
        }

        void launch_game(const game_config::game_config_t& config, const std::string& game, const std::string& mode, cef::cef_ui& cef_ui)
        {
            if (config.mode_arguments.size() > 0 && !mode.empty())
            {
                if (config.mode_arguments.find(mode) == config.mode_arguments.end())
                {
                    cef_ui.show_message_box("Game Launch Error", "Unknown game mode: " + mode);
                    return;
                }
            }

            // Get game installation path
            const auto game_install = config.get_install_path();
            if (!game_install)
            {
                cef_ui.show_message_box("Game Launch Error", "Failed to get game install path.");
                return;
            }

            const auto game_directory = std::filesystem::path(game_install->data());
            // Delete d3d11.dll if HMW and CB extension is disabled (or running under Wine, where d3d11 proxies don't work)
            if (game == "hmw")
            {
                const auto disable_ext = config.get(property_keys::DISABLE_CB_EXTENSION);
                const bool force_disable = utils::nt::is_wine_environment();
                if (force_disable || (disable_ext && *disable_ext == "true"))
                {
                    if (force_disable)
                    {
                        printf("[Wine] Disabling CB Extension (d3d11 proxy) - not compatible with Wine/Proton\n");
                    }
                    const auto dll_path = game_directory / "d3d11.dll";
                    if (utils::io::file_exists(dll_path.string()))
                    {
                        utils::io::remove_file(dll_path);
                    }
                }
            }

            const auto exe_name = game_config::get_exe_for_mode(game, mode);
            const auto game_exe = game_directory / exe_name;
            if (utils::io::file_exists(game_exe.string()))
            {
                if (!try_lock_termination_barrier())
                {
                    cef_ui.show_message_box("Game Launch Error", "Another game is already running! Please close it before running this game.");
                    return;
                }

                const auto player_name = resolve_player_name(config);
                const auto launch_args = build_launch_args(game_config::get_launch_arguments(game, mode), mode, config, player_name);

                printf("Launching %s with args: %s\n", exe_name.data(), launch_args.data());

                /*if (utils::nt::is_wine_environment())
                {
                    cef_ui.show_message_box("Wine/Proton Warning",
                        "Launching games directly from the launcher is not fully supported under Wine/Proton, you may experience issues.\n"
                        "It is recommended to launch '" + exe_name + "' separately under Proton instead.\n"
                         "For now, use the launcher for downloading and verifying game files on Linux.");
                }*/

                const auto pid = utils::nt::launch_process(game_exe, launch_args, game_directory);

                if (pid == 0)
                {
                    unlock_termination_barrier();
                    const auto error_msg = std::format("Failed to launch {}. Error code: {}", exe_name, GetLastError());
                    printf("Launch failed: %s\n", error_msg.data());
                    cef_ui.show_message_box("Game Launch Error", error_msg);
                    return;
                }

                // Check if launcher should close after game starts
                const auto close_on_launch = utils::properties::load(property_keys::CLOSE_ON_LAUNCH);
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
            else
            {
                cef_ui.show_message_box("Game Launch Error", "Could not find: " + exe_name);
            }
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context& ctx)
    {
        cef_ui.add_command("launch-game", [&cef_ui, &ctx](const rapidjson::Value& value, auto&)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const auto game = std::string{ value["game"].GetString() };

            // Get mode if provided, otherwise empty string
            const auto mode = value.HasMember("mode") ? std::string{ value["mode"].GetString() } : std::string{};

            updater::ui_progress_listener progress_listener;
            progress_listener.reset(true);

            // Run update and launch in a separate thread with progress tracking
            std::thread([config = *config, mode, game, &progress_listener, &cef_ui, &ctx]()
            {
                try
                {
                    // Check for game updates if configured (reduce unnecessary manifest fetch)
                    if (config.check_for_game_updates)
                    {
                        game_updater::game_updater game_updater(config, false, false, &progress_listener);
                        if (game_updater.is_update_needed())
                        {
                            cef_ui.show_message_box("Game Update Required", config.display_name + " requires an update. Please wait for update to complete before you can start playing.");
                            game_updater.run();
                        }
                    }

                    // Check if client update should be skipped
                    const auto skip_client_update_prop = utils::properties::load(property_keys::SKIP_CLIENT_UPDATE);
                    const bool skip_client_update = skip_client_update_prop && *skip_client_update_prop == "true";

                    if (skip_client_update)
                    {
                        printf("Skip client update enabled - skipping client update check\n");
                    }
                    else
                    {
                        // Get files to skip based on game configuration
                        const auto skip_files = ctx.get_skip_files(game, config);

                        client_updater::run(config, skip_files, &progress_listener);
                        apply_post_client_update(config);
                    }
                    progress_listener.done_update();

                    launch_game(config, game, mode, cef_ui);
                }
                catch (const updater::update_cancelled&)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Update cancelled by user\n");
                }
                catch (const std::exception& e)
                {
                    // Set error in progress tracker and show error popup in UI
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Launch error: %s\n", e.what());
                    cef_ui.show_message_box("Game Launch Error", e.what());

                    launch_game(config, game, mode, cef_ui); //Attempt to launch game even if error in update
                }
                catch (...)
                {
                    // Set generic error for unknown exceptions
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Unknown launch error\n");
                    cef_ui.show_message_box("Game Launch Error", "An unknown error occurred during game launch");

                    launch_game(config, game, mode, cef_ui); //Attempt to launch game even if error in update
                }
            }).detach();
        });

        cef_ui.add_command("is-game-running", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetBool(false); // Default to not running

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            // Check if any of the game's executables are running
            bool is_running = utils::nt::is_process_running(config->exe_name);
            if (!is_running && !config->check_running_exes.empty())
            {
                for (const auto& exe : config->check_running_exes)
                {
                    if (utils::nt::is_process_running(exe))
                    {
                        is_running = true;
                        break;
                    }
                }
            }
            response.SetBool(is_running);
        });

        cef_ui.add_command("stop-game", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetBool(false); // Default to failure

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            // Attempt to stop any of the game's executables
            bool stopped = utils::nt::stop_process(config->exe_name);
            if (!config->check_running_exes.empty())
            {
                for (const auto& exe : config->check_running_exes)
                {
                    if (utils::nt::stop_process(exe))
                    {
                        stopped = true;
                    }
                }
            }
            response.SetBool(stopped);

            // If we successfully stopped the game, unlock the termination barrier
            if (stopped)
            {
                unlock_termination_barrier();
            }
        });

        cef_ui.add_command("verify-game", [&cef_ui, &ctx](const rapidjson::Value& value, auto&)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const auto game = config->game_key;

            // Check if hash verification should be skipped
            bool skip_hash = false;
            const auto skip_hash_prop = utils::properties::load(property_keys::SKIP_HASH_VERIFICATION);
            if (skip_hash_prop && *skip_hash_prop == "true")
            {
                skip_hash = true;
                printf("Skip hash verification enabled\n");
            }

            // Check if deselected components should be deleted
            bool delete_deselected = false;
            if (value.HasMember("delete_components") && value["delete_components"].IsBool())
            {
                delete_deselected = value["delete_components"].GetBool();
            }

            // Clear component cache before verification
            config->set(property_keys::DETECTED_COMPONENTS, "");

            updater::ui_progress_listener progress_listener;
            progress_listener.reset(true);

            // Run verification in a separate thread with progress tracking
            std::thread([config = *config, &progress_listener, &cef_ui, skip_hash, delete_deselected, game, &ctx]()
            {
                try
                {
                    // If this game depends on a base game, verify/update the base game files first
                    if (!config.base_game.empty())
                    {
                        const auto base_config = game_config::get_game_config(config.base_game);
                        if (base_config)
                        {
                            game_updater::run(*base_config, skip_hash, delete_deselected, &progress_listener);
                        }
                    }

                    game_updater::run(config, skip_hash, delete_deselected, &progress_listener);

                    // Get files to skip based on game configuration
                    const auto skip_files = ctx.get_skip_files(game, config);

                    client_updater::run(config, skip_files, &progress_listener);
                    apply_post_client_update(config);
                    progress_listener.done_update();

                    cef_ui.show_toast(config.display_name + " verification/update complete!", "success");
                }
                catch (const updater::update_cancelled&)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Update cancelled by user\n");
                    cef_ui.show_toast(config.display_name + " verification/update cancelled", "info");
                }
                catch (const std::exception& e)
                {
                    // Set error in progress tracker and show error popup in UI
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Update error: %s\n", e.what());
                    cef_ui.show_message_box("Update Error", e.what());
                }
                catch (...)
                {
                    // Set generic error for unknown exceptions
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Unknown update error\n");
                    cef_ui.show_message_box("Update Error", "An unknown error occurred during update");
                }
            }).detach();
        });

        cef_ui.add_command("unlock-all", [&cef_ui, &ctx](const rapidjson::Value& value, auto&)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            updater::ui_progress_listener progress_listener;
            progress_listener.reset(true);

            std::thread([config = *config, &progress_listener, &cef_ui]()
            {
                try
                {
                    unlockall::run(config, &progress_listener);
                    progress_listener.done_update();
                    cef_ui.show_toast("Unlock all completed successfully!", "success");
                }
                catch (const std::exception& e)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Unlock All error: %s\n", e.what());
                    cef_ui.show_message_box("Unlock All Error", e.what());
                }
                catch (...)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Unlock All error\n");
                    cef_ui.show_message_box("Unlock All Error", "An unknown error occurred during unlock all");
                }
            }).detach();
        });

        cef_ui.add_command("delete-game", [&cef_ui, &ctx](const rapidjson::Value& value, auto&)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            // Check if game is running
            bool is_running = utils::nt::is_process_running(config->exe_name);
            if (!config->check_running_exes.empty())
            {
                for (const auto& exe : config->check_running_exes)
                {
                    if (utils::nt::is_process_running(exe))
                    {
                        is_running = true;
                        break;
                    }
                }
            }

            if (is_running)
            {
                cef_ui.show_message_box("Cannot Uninstall", "Please close the game before uninstalling.");
                return;
            }

            updater::ui_progress_listener progress_listener;
            progress_listener.reset(true);

            std::thread([config = *config, &progress_listener, &cef_ui]()
            {
                try
                {
                    game_updater::game_updater game_updater(config, true, false, &progress_listener);
                    game_updater.delete_game();

                    client_updater::client_updater client_updater(config, {}, &progress_listener);
                    client_updater.delete_client();

                    // Clear installation status and component caches
                    config.set_installed(false);
                    config.set_list(property_keys::DETECTED_COMPONENTS, {});
                    config.set_list(property_keys::SELECTED_COMPONENTS, {});

                    progress_listener.done_update();
                    cef_ui.show_toast(config.display_name + " uninstalled successfully.", "success");
                }
                catch (const updater::update_cancelled&)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Uninstall cancelled by user\n");
                    cef_ui.show_toast(config.display_name + " uninstall cancelled", "info");
                }
                catch (const std::exception& e)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Uninstall error: %s\n", e.what());
                    cef_ui.show_message_box("Uninstall Error", e.what());
                }
                catch (...)
                {
                    progress_listener.cancel_update();
                    progress_listener.done_update();
                    printf("Unknown uninstall error\n");
                    cef_ui.show_message_box("Uninstall Error", "An unknown error occurred during uninstall");
                }
            }).detach();
        });
    }
}
