#include "std_include.hpp"
#include "component_commands.hpp"
#include <utils/property_keys.hpp>
#include <utils/string.hpp>
#include "cef/cef_ui.hpp"

#include <game_config.hpp>

#include "updater/updater.hpp"
#include "updater/game_updater.hpp"
#include "updater/ui_progress_listener.hpp"
#include "updater/progress_tracker.hpp"

#include <mutex>
#include <unordered_set>

namespace commands::component_commands
{
    namespace
    {
        // Per-game detection flag, kept separate from progress_tracker so
        // detection can run while another game is verifying/updating.
        std::mutex& detection_mutex()
        {
            static std::mutex m;
            return m;
        }

        std::unordered_set<std::string>& detection_in_progress_games()
        {
            static std::unordered_set<std::string> set;
            return set;
        }

        bool detection_is_active(const std::string& game_key)
        {
            std::lock_guard lock(detection_mutex());
            return detection_in_progress_games().count(game_key) > 0;
        }

        struct detection_scope
        {
            std::string game_key;
            explicit detection_scope(std::string key) : game_key(std::move(key))
            {
                std::lock_guard lock(detection_mutex());
                detection_in_progress_games().insert(game_key);
            }
            ~detection_scope()
            {
                std::lock_guard lock(detection_mutex());
                detection_in_progress_games().erase(game_key);
            }
            detection_scope(const detection_scope&) = delete;
            detection_scope& operator=(const detection_scope&) = delete;
        };
    }

    void register_commands(cef::cef_ui& cef_ui, command_context& ctx)
    {
        cef_ui.add_command("get-game-component-info", [&cef_ui, &ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const auto game = config->game_key;

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

            // Clear cache if force refresh requested
            if (force_refresh && detect_existing)
            {
                config->set_list(property_keys::DETECTED_COMPONENTS, {});
            }

            std::vector<game_updater::component_info> components;
            std::optional<game_updater::game_updater> updater;

            try {
                updater.emplace(*config);
                components = updater->get_available_components();

                // If this game depends on a base game, add a virtual component for the base game files
                ctx.aggregate_base_game_components(*config, components);
            }
            catch (const updater::update_cancelled&) {
                return;
            }
            catch (const std::exception& e) {
                cef_ui.show_message_box("Manage Install Error", e.what());
                return;
            }

            // Only detect installed components if requested (expensive operation, skip for setup/download flow)
            bool detection_in_progress = false;
            std::vector<std::string> installed;

            if (detect_existing)
            {
                // Try cache first (unless force refresh)
                const auto cached = force_refresh ? std::vector<std::string>{} : config->get_list(property_keys::DETECTED_COMPONENTS);
                if (!cached.empty())
                {
                    // Cache hit - instant response
                    installed = cached;
                }
                else if (detection_is_active(game))
                {
                    // Already detecting for this game; just report in-progress.
                    detection_in_progress = true;
                }
                else
                {
                    detection_in_progress = true;
                    std::thread([config = *config, &cef_ui]() {
                        const detection_scope scope(config.game_key);
                        try {
                            // nullptr listener: keep detection off the global progress_tracker.
                            const game_updater::game_updater thread_updater(config, false, false, nullptr);
                            const auto detected = thread_updater.detect_installed_components();

                            config.set_list(property_keys::DETECTED_COMPONENTS, detected);
                            if (config.get_list(property_keys::SELECTED_COMPONENTS).empty())
                            {
                                config.set_list(property_keys::SELECTED_COMPONENTS, thread_updater.with_required_components(detected));
                            }
                        }
                        catch (const updater::update_cancelled&) {
                        }
                        catch (const std::exception& e) {
                            cef_ui.show_message_box("Manage Install Error", e.what());
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
                displayName.SetString(comp.display_name.data(), static_cast<rapidjson::SizeType>(comp.display_name.length()), allocator);
                compObj.AddMember("displayName", displayName, allocator);

                compObj.AddMember("required", comp.required, allocator);
                compObj.AddMember("defaultEnabled", comp.default_enabled, allocator);

                rapidjson::Value compId;
                compId.SetString(comp.id.data(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
                componentsObj.AddMember(compId, compObj, allocator);
            }
            response.AddMember("components", componentsObj, allocator);

            // Add installed components array
            rapidjson::Value installedArray(rapidjson::kArrayType);
            for (const auto& comp_id : installed)
            {
                rapidjson::Value val;
                val.SetString(comp_id.data(), static_cast<rapidjson::SizeType>(comp_id.length()), allocator);
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
                    size = updater->calculate_component_size(single_component);
                }

                rapidjson::Value compId;
                compId.SetString(comp.id.data(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
                sizesObj.AddMember(compId, static_cast<uint64_t>(size), allocator);
            }
            response.AddMember("sizes", sizesObj, allocator);
        });

        cef_ui.add_command("get-component-detection-status", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            response.SetObject();
            auto& allocator = response.GetAllocator();
            const bool active = config ? detection_is_active(config->game_key) : false;
            response.AddMember("active", active, allocator);
        });

        cef_ui.add_command("get-available-space", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            if (!value.IsObject() || !value.HasMember("path"))
            {
                return;
            }

            auto path = utils::string::utf8_to_path(value["path"].GetString());

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

        cef_ui.add_command("get-game-components", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
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
                displayName.SetString(comp.display_name.data(), static_cast<rapidjson::SizeType>(comp.display_name.length()), allocator);
                compObj.AddMember("displayName", displayName, allocator);

                compObj.AddMember("required", comp.required, allocator);
                compObj.AddMember("defaultEnabled", comp.default_enabled, allocator);

                rapidjson::Value compId;
                compId.SetString(comp.id.data(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
                response.AddMember(compId, compObj, allocator);
            }
        });

        cef_ui.add_command("detect-installed-components", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const game_updater::game_updater updater(*config);
            const auto installed = updater.detect_installed_components();

            // Build response as array of component IDs
            response.SetArray();
            auto& allocator = response.GetAllocator();

            for (const auto& comp_id : installed)
            {
                rapidjson::Value val;
                val.SetString(comp_id.data(), static_cast<rapidjson::SizeType>(comp_id.length()), allocator);
                response.PushBack(val, allocator);
            }
        });

        cef_ui.add_command("set-game-components", [&ctx](const rapidjson::Value& value, auto&)
        {
            if (!value.HasMember("components"))
            {
                return;
            }

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
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
            config->set_list(property_keys::SELECTED_COMPONENTS, components_vec);
        });

        cef_ui.add_command("get-component-sizes", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const game_updater::game_updater updater(*config);
            auto components = updater.get_available_components();

            // If this game depends on a base game, add a virtual component for the base game files
            ctx.aggregate_base_game_components(*config, components);

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
                compId.SetString(comp.id.data(), static_cast<rapidjson::SizeType>(comp.id.length()), allocator);
                response.AddMember(compId, static_cast<uint64_t>(size), allocator);
            }
        });
    }
}
