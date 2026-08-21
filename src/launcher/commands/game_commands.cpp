#include "std_include.hpp"
#include "game_commands.hpp"
#include <utils/property_keys.hpp>
#include "cef/cef_ui.hpp"

#include <utils/concurrency.hpp>
#include <utils/flags.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/registry.hpp>
#include <utils/string.hpp>
#include <game_config.hpp>

#include <charconv>
#include <cmath>

#include "discord/discord_service.hpp"
#include "ipc/ipc_server.hpp"
#include "plutonium/plutonium.hpp"

#include "updater/updater.hpp"
#include "updater/game_updater.hpp"
#include "updater/client_updater.hpp"
#include "updater/client_store.hpp"
#include "updater/ui_progress_listener.hpp"

namespace commands::game_commands
{
    namespace
    {
        std::atomic_bool* get_launch_barrier()
        {
            static std::atomic_bool barrier{ false };
            return &barrier;
        }

        bool try_lock_launch_barrier()
        {
            auto* barrier = get_launch_barrier();
            auto expected = false;
            return barrier->compare_exchange_strong(expected, true);
        }

        void unlock_launch_barrier()
        {
            auto* barrier = get_launch_barrier();
            barrier->store(false);
        }

        // Monotonic launch id; a relaunch reserves a fresh one so the old exit watchdog can't unlock the barrier mid-handoff.
        std::atomic<uint64_t>& launch_generation()
        {
            static std::atomic<uint64_t> gen{0};
            return gen;
        }

        uint64_t reserve_launch_generation()
        {
            return ++launch_generation();
        }

        bool is_current_generation(const uint64_t generation)
        {
            return launch_generation().load() == generation;
        }

        // The single launched game's PID + id (one game at a time via the launch barrier).
        struct tracked_launch
        {
            unsigned long pid{0};
            std::string game_id{};
            bool active{false};
            uint64_t generation{0};
            bool elevated{false};
        };

        utils::concurrency::container<tracked_launch>& get_tracked_launch()
        {
            static utils::concurrency::container<tracked_launch> tracked{};
            return tracked;
        }

        void set_tracked_launch(unsigned long pid, const std::string& game_id, const uint64_t generation, const bool elevated)
        {
            get_tracked_launch().access([&](tracked_launch& t)
            {
                t.pid = pid;
                t.game_id = game_id;
                t.active = true;
                t.generation = generation;
                t.elevated = elevated;
            });
        }

        void clear_tracked_launch()
        {
            get_tracked_launch().access([](tracked_launch& t)
            {
                t = {};
            });
        }

        // TerminateProcess can't reach an elevated game from a non-elevated launcher, so stop those via elevated taskkill.
        bool stop_game_processes(const game_config::game_config_t& config)
        {
            std::vector<std::string> exes{ config.exe_name };
            for (const auto& exe : config.check_running_exes)
            {
                exes.push_back(exe);
            }

            // Covers configured elevation and the runtime 740 fallback (exe manifest demanded elevation).
            const auto launched_elevated = get_tracked_launch().access<bool>([&](const tracked_launch& t)
            {
                return t.active && t.game_id == config.id && t.elevated;
            });

            if ((config.launch_elevated() || launched_elevated) && !utils::nt::is_elevated())
            {
                std::string args = "/F";
                for (const auto& exe : exes)
                {
                    if (!exe.empty()) args += " /IM \"" + exe + "\"";
                }

                wchar_t system32[MAX_PATH];
                GetSystemDirectoryW(system32, MAX_PATH);
                const auto taskkill = std::filesystem::path(system32) / "taskkill.exe";
                return utils::nt::launch_process_elevated(taskkill, args, {}) != 0;
            }

            bool stopped = false;
            for (const auto& exe : exes)
            {
                if (!exe.empty() && utils::nt::stop_process(exe))
                {
                    stopped = true;
                }
            }
            return stopped;
        }

        // Stops the game holding the barrier and waits for it to fully exit (single-instance; barrier stays held).
        // False => the game survived the stop (e.g. declined UAC taskkill); the caller must not launch on top of it.
        bool stop_tracked_game_and_wait()
        {
            const auto running_id = get_tracked_launch().access<std::string>([](const tracked_launch& t)
            {
                return t.active ? t.game_id : std::string{};
            });
            if (running_id.empty())
            {
                return true;
            }

            const auto config = game_config::get_game_config_by_id(running_id);
            if (!config)
            {
                return true;
            }

            std::vector<std::string> exes{ config->exe_name };
            for (const auto& exe : config->check_running_exes)
            {
                exes.push_back(exe);
            }

            stop_game_processes(*config);

            // Poll for up to ~10s for every tracked exe to disappear.
            bool any_running = true;
            for (int i = 0; i < 100 && any_running; ++i)
            {
                any_running = false;
                for (const auto& exe : exes)
                {
                    if (!exe.empty() && utils::nt::is_process_running(exe))
                    {
                        any_running = true;
                        break;
                    }
                }
                if (any_running)
                {
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                }
            }
            return !any_running;
        }

        // Some clients (e.g. Plutonium) exit the launched PID and continue under a child with a different PID, so poll the full exe list.
        void spawn_exit_watchdog(unsigned long pid, const game_config::game_config_t& config, const uint64_t generation)
        {
            std::vector<std::string> tracked_exes{ config.exe_name };
            for (const auto& exe : config.check_running_exes)
            {
                tracked_exes.push_back(exe);
            }

            std::thread([pid, generation, tracked_exes = std::move(tracked_exes)]()
            {
                utils::nt::wait_for_process(pid);

                // Grace period for updater→child handoff before polling.
                std::this_thread::sleep_for(std::chrono::seconds(1));

                int empty_ticks = 0;
                while (empty_ticks < 2)
                {
                    std::this_thread::sleep_for(std::chrono::seconds(1));

                    bool any_running = false;
                    for (const auto& exe : tracked_exes)
                    {
                        if (!exe.empty() && utils::nt::is_process_running(exe))
                        {
                            any_running = true;
                            break;
                        }
                    }

                    empty_ticks = any_running ? 0 : empty_ticks + 1;
                }

                // A newer launch (e.g. a mode-switch relaunch) superseded us; it owns the barrier now.
                if (!is_current_generation(generation))
                {
                    return;
                }

                discord::discord_service::instance().clear_activity();
                clear_tracked_launch();
                unlock_launch_barrier();
            }).detach();
        }

        // Fixes broken DPI scaling on very old CoDs.
        void apply_highdpi_override(const std::filesystem::path& exe_path)
        {
            static const std::wstring layers = L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers";
            const auto value_name = exe_path.wstring();

            std::vector<std::wstring> tokens;
            if (const auto existing = utils::registry::get_hkcu_string(layers, value_name))
            {
                std::wistringstream stream(*existing);
                std::wstring token;
                while (stream >> token)
                {
                    if (token == L"~") continue;
                    if (token == L"HIGHDPIAWARE") return; // already applied
                    if (token == L"DPIUNAWARE" || token == L"GDIDPISCALING") continue; // conflicting DPI flags
                    tokens.push_back(token); // preserve unrelated flags (e.g. RUNASADMIN)
                }
            }

            std::wstring value = L"~";
            for (const auto& token : tokens) value += L" " + token;
            value += L" HIGHDPIAWARE";

            if (!utils::registry::set_hkcu_string(layers, value_name, value))
            {
                printf("Failed to write high-DPI override registry value\n");
            }
        }

        // Guarded, idempotent preconditions (DPI flags, registry keys, Plutonium path) applied on every launch.
        void ensure_launch_prerequisites(const game_config::game_config_t& config)
        {
            if (config.game_key == "cod1" || config.game_key == "coduo" || config.game_key == "cod2x")
            {
                const auto install = config.get_install_path();
                if (install && install.has_value())
                {
                    for (const auto& exe : config.valid_game_files)
                    {
                        apply_highdpi_override(*install / exe);
                    }
                }
            }

            if (config.game_key == "cod2x")
            {
                // CoD2 reads the virtualized HKLM path; unelevated writes land in the per-user VirtualStore, so target it directly.
                // Also check real HKLM: elevated CoD2x migrates VirtualStore there (and deletes the store copy), and a retail key must not be shadowed.
                const std::wstring subkey = L"SOFTWARE\\Classes\\VirtualStore\\MACHINE\\SOFTWARE\\WOW6432Node\\Activision\\Call of Duty 2";
                const std::wstring real_subkey = L"SOFTWARE\\Activision\\Call of Duty 2";
                const std::wstring value_name = L"codkey";
                if (!utils::registry::hkcu_string_value_exists(subkey, value_name) &&
                    !utils::registry::hklm_wow32_string_value_exists(real_subkey, value_name))
                {
                    if (!utils::registry::set_hkcu_string(subkey, value_name, L"65JHZ75PW67WLJGJF0FF"))
                    {
                        printf("Failed to write COD2 codkey registry value\n");
                    }
                }
            }

            if (config.game_key == "coduo")
            {
                // CoDUO reads the virtualized HKLM path; unelevated writes land in the per-user VirtualStore, so target it directly.
                // Skip when real HKLM already has the value (e.g. retail install) so the store copy doesn't shadow it.
                const std::wstring subkey = L"SOFTWARE\\Classes\\VirtualStore\\MACHINE\\SOFTWARE\\WOW6432Node\\Activision\\Call of Duty United Offensive";
                const std::wstring real_subkey = L"SOFTWARE\\Activision\\Call of Duty United Offensive";
                const std::vector<std::wstring> value_names = {L"key", L"codkey"};
                for (const auto& name : value_names)
                {
                    if (!utils::registry::hkcu_string_value_exists(subkey, name) &&
                        !utils::registry::hklm_wow32_string_value_exists(real_subkey, name))
                    {
                        if (!utils::registry::set_hkcu_string(subkey, name, L"KW7RWZ77JJJDRUZ4EBEC"))
                        {
                            printf("Failed to write CoDUO key registry value\n");
                        }
                    }
                }
            }

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

            if (config.game_key == "bo4")
            {
                const std::wstring subkey = L"SOFTWARE\\Blizzard Entertainment\\Battle.net";
                if (!utils::registry::ensure_hkcu_key_exists(subkey))
                {
                    printf("Failed to create Battle.net registry key for BO4\n");
                }
            }

            config.ensure_plutonium_path();
        }

        // iw3sp_mod re-runs its one-time config migration whenever its marker files are absent, truncating
        // the profile's configs on the way. Seeding the markers on populated profiles keeps it dormant.
        void protect_iw3sp_mod_profiles(const game_config::game_config_t& config)
        {
            if (config.game_key != "cod4x")
            {
                return;
            }

            const auto install = config.get_install_path();
            if (!install || install->empty())
            {
                return;
            }

            const auto profiles_dir = *install / "players" / "profiles";
            if (!utils::io::directory_exists(profiles_dir))
            {
                return;
            }

            // Only seed where the config already holds data; a fresh profile still needs the real migration.
            // Both marker generations are covered so rolling the client between builds can't re-trigger it.
            static constexpr struct { const char* cfg; const char* marker; } markers[] = {
                {"iw3sp_mod_config.cfg", "iw3sp_mod_init_cfg/IW3SP_MOD_CONFIG_INIT_DONE"},
                {"mods_config.cfg", "iw3sp_mod_init_cfg/IW3SP_MOD_CONFIG_MODS_INIT_DONE"},
                {"mods_config.cfg", "DO_NOT_DELETE"},
            };

            try
            {
                for (const auto& profile : utils::io::list_files(profiles_dir))
                {
                    if (!utils::io::directory_exists(profile))
                    {
                        continue;
                    }

                    for (const auto& [cfg, marker] : markers)
                    {
                        if (utils::io::file_size(profile / cfg) == 0)
                        {
                            continue;
                        }

                        const auto marker_path = profile / marker;
                        if (utils::io::file_exists(marker_path))
                        {
                            continue;
                        }

                        if (utils::io::write_file(marker_path, "// seeded by CB Servers Launcher"))
                        {
                            printf("Seeded iw3sp_mod config marker: %s\n", utils::string::path_to_utf8(marker_path).data());
                        }
                        else
                        {
                            printf("Failed to seed iw3sp_mod config marker: %s\n", marker);
                        }
                    }
                }
            }
            catch (const std::exception& e)
            {
                // Never block a launch over this
                printf("Failed to seed iw3sp_mod config markers: %s\n", e.what());
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

        // Returns the effective player name to inject for this game, or empty when nothing should be injected
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
            // Names without whitespace don't need quoting
            if (name.find_first_of(" \t") == std::string::npos)
            {
                return std::format("{} {}", prefix, name);
            }
            return std::format("{} \"{}\"", prefix, name);
        }

        // Builds the +set r_* args for the custom-resolution setting (CoD1/CoDUO/CoD2 only); empty when disabled or invalid.
        std::string build_custom_resolution_args(const game_config::game_config_t& config)
        {
            if (config.game_key != "cod1" && config.game_key != "coduo" && config.game_key != "cod2x") return "";

            const auto enabled = config.get(property_keys::CUSTOM_RESOLUTION_ENABLED);
            if (!enabled || *enabled != "true") return "";

            const auto width_str = config.get(property_keys::CUSTOM_RESOLUTION_WIDTH).value_or("");
            const auto height_str = config.get(property_keys::CUSTOM_RESOLUTION_HEIGHT).value_or("");

            int width = 0, height = 0;
            const auto [wp, wec] = std::from_chars(width_str.data(), width_str.data() + width_str.size(), width);
            const auto [hp, hec] = std::from_chars(height_str.data(), height_str.data() + height_str.size(), height);
            if (wec != std::errc{} || hec != std::errc{} || width <= 0 || height <= 0) return "";

            // Aspect truncated to 1 decimal to match the game's expected values (16:9 -> 1.7, 4:3 -> 1.3).
            const double aspect = std::floor(static_cast<double>(width) / height * 10.0) / 10.0;

            return std::format("+set r_mode -1 +set r_customheight \"{}\" +set r_customwidth \"{}\" +set r_customaspect {:.1f}",
                height, width, aspect);
        }

        std::string build_launch_args(const std::string& base_args, const std::string& mode,
            const game_config::game_config_t& config, const std::string& player_name)
        {
            const auto user_options = config.get_launch_options().value_or("");
            const auto name_arg = format_name_arg(config.name_argument, player_name);
            const auto res_args = build_custom_resolution_args(config);

            // Wrapper-launcher modes (e.g. AlterWare) forward pass-args + user options as one --pass token.
            const auto pass_it = config.mode_pass_arguments.find(mode);
            if (pass_it != config.mode_pass_arguments.end())
            {
                const auto inner = trim_ws(std::format("{} {} {} {}", pass_it->second, user_options, name_arg, res_args));
                if (inner.empty())
                {
                    return base_args;
                }
                return std::format("{} --pass \"{}\"", base_args, inner);
            }

            const auto extras = trim_ws(std::format("{} {} {}", user_options, name_arg, res_args));
            if (extras.empty()) return base_args;
            return std::format("{} {}", base_args, extras);
        }

        // Launches a Plutonium mode via plutonium://, or nullopt when this mode isn't a Plutonium target.
        std::optional<bool> try_launch_plutonium(const game_config::game_config_t& config, const std::string& mode,
            cef::cef_ui& cef_ui, const uint64_t generation)
        {
            const auto name_it = config.plutonium_game_names.find(mode);
            if (name_it == config.plutonium_game_names.end())
            {
                return std::nullopt;
            }

            // Wine gate disabled for testing - restore this to fall back to plutonium.exe there.
            // if (utils::nt::is_wine_environment())
            // {
            //     return std::nullopt;
            // }

            if (!plutonium::is_available())
            {
                return std::nullopt;
            }

            if (utils::nt::is_wine_environment())
            {
                utils::logger::write("[pluto] attempting direct launch under Wine (experimental)");
            }

            // Every failure recovers the same way: open their UI once so the user can repair whatever broke.
            const auto recover = [&](const std::string& reason)
            {
                cef_ui.show_message_box("Plutonium Sign-In Needed",
                    reason + "\n\nThe Plutonium launcher is opening now. Sign in and start " + config.display_name +
                    " from there this once, after that launching from CB Servers goes straight into the game.");
                plutonium::open_login_ui();
            };

            // CB's barrier can't see a game the user started from Plutonium directly.
            if (plutonium::is_game_running())
            {
                cef_ui.show_message_box("Game Launch Error",
                    "A Plutonium game is already running. Only one game can run at a time, close it before launching "
                    + config.display_name + ".");
                return false;
            }

            if (plutonium::get_token().empty())
            {
                recover("You're not signed in to Plutonium.");
                return false;
            }

            const auto elevate = config.launch_elevated() && !utils::nt::is_elevated();
            const auto result = plutonium::launch_via_uri(name_it->second, elevate);

            // Declining the prompt isn't a broken session, and re-opening their UI would only prompt again.
            if (result.cancelled)
            {
                cef_ui.show_message_box("Game Launch Cancelled",
                    "The Plutonium launcher requires administrator permission to start " + config.display_name + ".");
                return false;
            }

            if (!result.success)
            {
                recover("Plutonium couldn't start " + config.display_name + ". Your session may have expired.");
                return false;
            }

            discord::discord_service::instance().set_game_activity(config.id, config.display_name, mode);
            // Track the bootstrapper, not the launcher we spawned - that one exits after the handoff.
            // An elevated launcher hands its integrity level down, so stopping the game needs the elevated path too.
            set_tracked_launch(result.bootstrapper_pid, config.id, generation, result.elevated);

            const auto close_on_launch = utils::properties::load(property_keys::CLOSE_ON_LAUNCH);
            if (close_on_launch && *close_on_launch == "true")
            {
                printf("Close on launch enabled - closing launcher\n");
                cef_ui.close_browser();
                return true;
            }

            spawn_exit_watchdog(result.bootstrapper_pid, config, generation);
            return true;
        }

        // Assumes the caller already holds the launch barrier and reserved `generation`.
        bool launch_game(const game_config::game_config_t& config, const std::string& game, const std::string& mode, cef::cef_ui& cef_ui, const uint64_t generation)
        {
            if (config.mode_arguments.size() > 0 && !mode.empty())
            {
                if (config.mode_arguments.find(mode) == config.mode_arguments.end())
                {
                    cef_ui.show_message_box("Game Launch Error", "Unknown game mode: " + mode);
                    return false;
                }
            }

            // Get game installation path
            const auto game_install = config.get_install_path();
            if (!game_install)
            {
                cef_ui.show_message_box("Game Launch Error", "Failed to get game install path.");
                return false;
            }

            const auto game_directory = *game_install;

            // Match the live layout to this mode's selected client before any exe check.
            try
            {
                client_store::reconcile(config, mode);
            }
            catch (const std::exception& e)
            {
                printf("Reconcile failed: %s\n", e.what());
            }

            // Here rather than after the client update, so a skipped or failed update can't leave these unset.
            ensure_launch_prerequisites(config);

            protect_iw3sp_mod_profiles(config);
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
                    if (utils::io::file_exists(dll_path))
                    {
                        utils::io::remove_file(dll_path);
                    }
                }
            }

            if (const auto handled = try_launch_plutonium(config, mode, cef_ui, generation))
            {
                return *handled;
            }

            const auto exe_name = game_config::get_exe_for_mode(game, mode);
            const auto game_exe = game_directory / exe_name;
            if (utils::io::file_exists(game_exe))
            {
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

                // The non-elevated path still ends up at a UAC prompt when the exe itself demands elevation (740).
                auto elevate = config.launch_elevated() && !utils::nt::is_elevated();
                const auto pid = elevate
                    ? utils::nt::launch_process_elevated(game_exe, launch_args, game_directory)
                    : utils::nt::launch_process_maybe_elevated(game_exe, launch_args, game_directory, &elevate);

                if (pid == 0)
                {
                    const auto error = GetLastError();
                    if (elevate && error == ERROR_CANCELLED)
                    {
                        cef_ui.show_message_box("Game Launch Cancelled", config.display_name + " requires administrator permission to launch.");
                        return false;
                    }

                    auto error_msg = std::format("Failed to launch {}. Error code: {}", exe_name, error);
                    if (error == ERROR_ACCESS_DENIED)
                    {
                        error_msg += "\n\nIf this keeps happening, try running the launcher as administrator or check that your antivirus isn't blocking the game.";
                    }
                    printf("Launch failed: %s\n", error_msg.data());
                    cef_ui.show_message_box("Game Launch Error", error_msg);
                    return false;
                }

                discord::discord_service::instance().set_game_activity(config.id, config.display_name, mode);
                set_tracked_launch(pid, config.id, generation, elevate);

                // Check if launcher should close after game starts
                const auto close_on_launch = utils::properties::load(property_keys::CLOSE_ON_LAUNCH);
                if (close_on_launch && *close_on_launch == "true")
                {
                    printf("Close on launch enabled - closing launcher\n");
                    // Close the launcher browser window
                    cef_ui.close_browser();
                    return true;
                }

                spawn_exit_watchdog(pid, config, generation);
                return true;
            }

            cef_ui.show_message_box("Game Launch Error", "Could not find: " + exe_name);
            return false;
        }

        // Set at command registration so the invite-accept path (no command scope) can launch.
        cef::cef_ui* g_cef_ui = nullptr;
        command_context* g_ctx = nullptr;

        // Update-then-launch sequence; assumes the caller holds the barrier and reserved `generation`.
        void run_launch_worker(game_config::game_config_t config, std::string game, std::string mode,
            cef::cef_ui& cef_ui, command_context& ctx, const uint64_t generation)
        {
            updater::ui_progress_listener progress_listener;
            progress_listener.reset(true);

            bool launched = false;
            try
            {
                if (config.check_for_game_updates && !utils::flags::has_flag("offline"))
                {
                    game_updater::game_updater game_updater(config, false, false, &progress_listener);
                    if (game_updater.is_update_needed())
                    {
                        cef_ui.show_message_box("Game Update Required", config.display_name + " requires an update. Please wait for update to complete before you can start playing.");
                        game_updater.run();
                    }
                }

                const auto skip_client_update_prop = utils::properties::load(property_keys::SKIP_CLIENT_UPDATE);
                const bool skip_client_update = (skip_client_update_prop && *skip_client_update_prop == "true")
                    || utils::flags::has_flag("offline");

                if (skip_client_update)
                {
                    printf("Skip client update enabled - skipping client update check\n");
                }
                else
                {
                    const auto skip_files = ctx.get_skip_files(game, config);
                    client_updater::run_for_mode(config, mode, skip_files, &progress_listener);

                    // Revision-gated, so this only runs when behind. Wine gate disabled for testing: && !utils::nt::is_wine_environment()
                    if (!config.plutonium_game_names.empty())
                    {
                        if (const auto install = config.get_install_path())
                        {
                            plutonium::ensure_updated(*install / config.exe_name);
                        }
                    }
                }
                progress_listener.done_update();

                launched = launch_game(config, game, mode, cef_ui, generation);
            }
            catch (const updater::update_cancelled&)
            {
                progress_listener.cancel_update();
                progress_listener.done_update();
                printf("Update cancelled by user\n");
            }
            catch (const std::exception& e)
            {
                progress_listener.cancel_update();
                progress_listener.done_update();
                printf("Launch error: %s\n", e.what());
                cef_ui.show_message_box("Game Launch Error", e.what());

                launched = launch_game(config, game, mode, cef_ui, generation); //Attempt to launch game even if error in update
            }
            catch (...)
            {
                progress_listener.cancel_update();
                progress_listener.done_update();
                printf("Unknown launch error\n");
                cef_ui.show_message_box("Game Launch Error", "An unknown error occurred during game launch");

                launched = launch_game(config, game, mode, cef_ui, generation); //Attempt to launch game even if error in update
            }

            // Release the barrier unless a game process is now running (the exit watchdog or stop-game owns it).
            if (!launched)
            {
                // Drop any join queued against this launch so a stale connect can't fire on a later hello.
                ipc::ipc_server::instance().clear_pending_join();
                unlock_launch_barrier();
            }
        }

        // A sensible mode for an invite cold-launch; connecting switches mode as needed (parity with native cold-start).
        std::string default_join_mode(const game_config::game_config_t& config)
        {
            if (config.mode_arguments.empty())
            {
                return {};
            }
            if (config.mode_arguments.contains("mp"))
            {
                return "mp";
            }
            return config.mode_arguments.begin()->first;
        }

        // The host's mode from the secret when it's a real mode for this game; otherwise a sensible default.
        std::string resolve_join_mode(const game_config::game_config_t& config, const std::string& mode)
        {
            if (!mode.empty() && config.mode_arguments.contains(mode))
            {
                return mode;
            }
            return default_join_mode(config);
        }

        // True if the game is installed and the exe for `mode` exists, so a launch can actually succeed.
        bool is_game_launchable(const game_config::game_config_t& config, const std::string& mode)
        {
            const auto install = config.get_install_path();
            if (!install)
            {
                return false;
            }
            const auto exe = game_config::get_exe_for_mode(config.game_key, mode);
            return !exe.empty() && utils::io::file_exists(*install / exe);
        }
    }

    void launch_for_join(const std::string& game_id, const std::string& mode)
    {
        if (!g_cef_ui || !g_ctx)
        {
            return;
        }

        const auto config = game_config::get_game_config_by_id(game_id);
        if (!config)
        {
            return;
        }

        const auto launch_mode = resolve_join_mode(*config, mode);

        if (!is_game_launchable(*config, launch_mode))
        {
            utils::logger::write("[cbl-join] launch_for_join('{}', '{}'): not launchable", game_id, launch_mode);
            g_cef_ui->show_message_box("Join Failed",
                config->display_name + " isn't installed. Install it from the library to join.");
            return;
        }

        // Already launching/running => the running-game accept path (send_connect/relaunch) handles it.
        if (!try_lock_launch_barrier())
        {
            utils::logger::write("[cbl-join] launch_for_join('{}', '{}'): barrier held, not launching", game_id, launch_mode);
            g_cef_ui->show_message_box("Join Failed",
                "Another game is already launching or running. Close it before joining.");
            return;
        }

        const auto generation = reserve_launch_generation();
        std::thread([cfg = *config, game = config->game_key, mode = launch_mode,
            cef = g_cef_ui, ctx = g_ctx, generation]()
        {
            run_launch_worker(cfg, game, mode, *cef, *ctx, generation);
        }).detach();
    }

    void relaunch_for_join(const std::string& game_id, const std::string& mode)
    {
        if (!g_cef_ui || !g_ctx)
        {
            return;
        }

        const auto config = game_config::get_game_config_by_id(game_id);
        if (!config)
        {
            return;
        }

        const auto launch_mode = resolve_join_mode(*config, mode);

        // Validate the target before stopping anything, so we never kill the running game for a doomed launch.
        if (!is_game_launchable(*config, launch_mode))
        {
            g_cef_ui->show_message_box("Join Failed",
                config->display_name + " isn't installed. Install it from the library to join.");
            return;
        }

        // Inherit the barrier from the running game (or take it if free); a fresh generation supersedes its old watchdog.
        const bool already_running = !try_lock_launch_barrier();
        const auto generation = reserve_launch_generation();

        std::thread([cfg = *config, game = config->game_key, mode = launch_mode,
            cef = g_cef_ui, ctx = g_ctx, generation, already_running]()
        {
            if (already_running && !stop_tracked_game_and_wait())
            {
                // The old game survived; re-arm its watchdog under the new generation and drop the join instead of launching a second instance.
                get_tracked_launch().access([&](const tracked_launch& t)
                {
                    if (t.active)
                    {
                        if (const auto old_config = game_config::get_game_config_by_id(t.game_id))
                        {
                            spawn_exit_watchdog(t.pid, *old_config, generation);
                        }
                    }
                });
                ipc::ipc_server::instance().clear_pending_join();
                cef->show_message_box("Join Failed", "Couldn't close the running game. Close it manually and accept the invite again.");
                return;
            }
            run_launch_worker(cfg, game, mode, *cef, *ctx, generation);
        }).detach();
    }

    bool is_tracked_game_pid(const unsigned long pid, const std::string_view game_id)
    {
        return get_tracked_launch().access<bool>([&](const tracked_launch& t)
        {
            return t.active && t.pid == pid && t.game_id == game_id;
        });
    }

    std::string tracked_game_id()
    {
        return get_tracked_launch().access<std::string>([](const tracked_launch& t)
        {
            return t.active ? t.game_id : std::string{};
        });
    }

    bool try_adopt_running_game(const unsigned long pid, const std::string& game_id)
    {
        if (is_tracked_game_pid(pid, game_id))
        {
            return true;
        }

        const auto config = game_config::get_game_config_by_id(game_id);
        if (!config)
        {
            return false;
        }

        const auto install = config->get_install_path();
        if (!install)
        {
            return false;
        }

        const auto process_path = utils::nt::get_process_path(pid);
        if (process_path.empty())
        {
            return false;
        }

        // The PID must be one of this game's exes inside its configured install.
        bool matches = false;
        for (const auto& exe : config->collect_exes())
        {
            std::error_code ec{};
            if (!exe.empty() && std::filesystem::equivalent(process_path, *install / utils::string::utf8_to_path(exe), ec))
            {
                matches = true;
                break;
            }
        }
        if (!matches)
        {
            utils::logger::write("[cbl-adopt] reject pid {}: '{}' not in '{}' install exe list",
                                 pid, utils::string::path_to_utf8(process_path), game_id);
            return false;
        }

        // Same game already tracked under another PID (e.g. wrapper parent): accept without re-tracking.
        const auto tracked_same_game = get_tracked_launch().access<bool>([&](const tracked_launch& t)
        {
            return t.active && t.game_id == game_id;
        });
        if (tracked_same_game)
        {
            return true;
        }

        // Untracked instance (launcher restarted or game started manually): take the barrier and track it.
        if (!try_lock_launch_barrier())
        {
            return false;
        }

        const auto generation = reserve_launch_generation();
        set_tracked_launch(pid, config->id, generation, utils::nt::is_process_elevated(pid));
        spawn_exit_watchdog(pid, *config, generation);

        utils::logger::write("[cbl-adopt] adopted running game '{}' (pid {})", game_id, pid);
        return true;
    }

    void register_commands(cef::cef_ui& cef_ui, command_context& ctx)
    {
        g_cef_ui = &cef_ui;
        g_ctx = &ctx;

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

            if (!try_lock_launch_barrier())
            {
                const auto running_id = tracked_game_id();
                const auto running_config = running_id.empty()
                    ? std::nullopt
                    : game_config::get_game_config_by_id(running_id);

                std::string message;
                if (running_id == config->id)
                {
                    message = "This game is already launching or running. Please wait for it to finish, or close it before launching again.";
                }
                else if (running_config)
                {
                    message = running_config->display_name + " is already launching or running. Only one game can run at a time, close it before launching another.";
                }
                else
                {
                    message = "Another game is already launching or running. Only one game can run at a time, please wait for it to finish or close it before launching another.";
                }

                cef_ui.show_message_box("Game Launch Error", message);
                return;
            }

            // A user-initiated launch supersedes any invite join still queued for this game's hello.
            ipc::ipc_server::instance().clear_pending_join();

            // Run update and launch in a separate thread with progress tracking
            const auto generation = reserve_launch_generation();
            std::thread([config = *config, mode, game, &cef_ui, &ctx, generation]()
            {
                run_launch_worker(config, game, mode, cef_ui, ctx, generation);
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

            response.SetBool(game_config::is_game_process_running(config->id));
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
            const bool stopped = stop_game_processes(*config);
            response.SetBool(stopped);

            // If we successfully stopped the game, unlock the launch barrier
            if (stopped)
            {
                ipc::ipc_server::instance().clear_pending_join();
                clear_tracked_launch();
                unlock_launch_barrier();
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
            config->set(property_keys::DETECTED_COMPONENTS_STAMP, "");

            // Shared, not a local: this handler returns while the detached worker still reports progress.
            const auto progress_listener = std::make_shared<updater::ui_progress_listener>();
            progress_listener->reset(true);

            // Run verification in a separate thread with progress tracking
            std::thread([config = *config, progress_listener, &cef_ui, skip_hash, delete_deselected, game, &ctx]()
            {
                try
                {
                    // If this game depends on a base game, verify/update the base game files first
                    if (!config.base_game.empty())
                    {
                        const auto base_config = game_config::get_game_config(config.base_game);
                        if (base_config)
                        {
                            game_updater::run(*base_config, skip_hash, delete_deselected, progress_listener.get());
                            base_config->set_installed(true);
                        }
                    }

                    game_updater::run(config, skip_hash, delete_deselected, progress_listener.get());

                    // Get files to skip based on game configuration
                    const auto skip_files = ctx.get_skip_files(game, config);

                    const auto clients_fetched = client_updater::run_all(config, skip_files, progress_listener.get());
                    ensure_launch_prerequisites(config);

                    // Store-routed games write nothing live above, so reconcile every mode.
                    client_store::reconcile_all(config);

                    // Installed means game files verified and client files in place, not just the former.
                    if (clients_fetched)
                    {
                        config.set_installed(true);
                    }

                    progress_listener->done_update();

                    if (clients_fetched)
                    {
                        cef_ui.show_toast(config.display_name + " verification/update complete!", "success");
                    }
                    else
                    {
                        cef_ui.show_toast(config.display_name + " updated, but a client update check could not be reached. Please verify again later.", "error");
                    }
                }
                catch (const updater::update_cancelled&)
                {
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Update cancelled by user\n");
                    cef_ui.show_toast(config.display_name + " verification/update cancelled", "info");
                }
                catch (const std::exception& e)
                {
                    // Set error in progress tracker and show error popup in UI
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Update error: %s\n", e.what());
                    cef_ui.show_message_box("Update Error", e.what());
                }
                catch (...)
                {
                    // Set generic error for unknown exceptions
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Unknown update error\n");
                    cef_ui.show_message_box("Update Error", "An unknown error occurred during update");
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

            // Shared, not a local: this handler returns while the detached worker still reports progress.
            const auto progress_listener = std::make_shared<updater::ui_progress_listener>();
            progress_listener->reset(true);

            std::thread([config = *config, progress_listener, &cef_ui]()
            {
                try
                {
                    game_updater::game_updater game_updater(config, true, false, progress_listener.get());
                    game_updater.delete_game();

                    for (const auto& client : config.clients)
                    {
                        client_updater::client_updater client_updater(config, client, {}, progress_listener.get());
                        client_updater.delete_client();
                    }

                    // Clear installation status and component caches
                    config.reset();

                    progress_listener->done_update();
                    cef_ui.show_toast(config.display_name + " uninstalled successfully.", "success");
                }
                catch (const updater::update_cancelled&)
                {
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Uninstall cancelled by user\n");
                    cef_ui.show_toast(config.display_name + " uninstall cancelled", "info");
                }
                catch (const std::exception& e)
                {
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Uninstall error: %s\n", e.what());
                    cef_ui.show_message_box("Uninstall Error", e.what());
                }
                catch (...)
                {
                    progress_listener->cancel_update();
                    progress_listener->done_update();
                    printf("Unknown uninstall error\n");
                    cef_ui.show_message_box("Uninstall Error", "An unknown error occurred during uninstall");
                }
            }).detach();
        });
    }
}
