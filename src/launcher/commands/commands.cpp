#include "std_include.hpp"
#include "commands.hpp"
#include <utils/property_keys.hpp>
#include <utils/nt.hpp>
#include "cef/cef_ui.hpp"
#include "updater/game_updater.hpp"

#include "ui_commands.hpp"
#include "property_commands.hpp"
#include "info_commands.hpp"
#include "game_commands.hpp"
#include "component_commands.hpp"
#include "cdn_commands.hpp"
#include "discord_commands.hpp"
#include "mod_commands.hpp"
#include "social_commands.hpp"

namespace commands
{
    std::optional<game_config::game_config_t> command_context::get_game_config_from_request(
        const rapidjson::Value& request) const
    {
        if (!request.IsObject() || !request.HasMember("game"))
        {
            return std::nullopt;
        }

        const auto game = std::string{ request["game"].GetString() };
        return game_config::get_game_config(game);
    }

    std::vector<std::string> command_context::get_skip_files(
        const std::string& game,
        const game_config::game_config_t& /*config*/) const
    {
        std::vector<std::string> skip_files;

        // CB Extension retired; d3d11.dll is never installed for HMW anymore
        if (game == "hmw")
        {
            //const auto disable_ext = config.get(property_keys::DISABLE_CB_EXTENSION);
            //if (utils::nt::is_wine_environment() || (disable_ext && *disable_ext == "true"))
            skip_files.push_back("d3d11.dll");
        }

        return skip_files;
    }

    void command_context::aggregate_base_game_components(
        const game_config::game_config_t& config,
        std::vector<game_updater::component_info>& components) const
    {
        if (config.base_game.empty())
        {
            return;
        }

        const auto base_config = game_config::get_game_config(config.base_game);
        if (!base_config)
        {
            return;
        }

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
            virtual_comp.id = "base_game_" + config.base_game;
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

    void register_all_commands(cef::cef_ui& cef_ui)
    {
        // Create shared command context
        static command_context ctx{ cef_ui };

        // Register all command groups
        ui_commands::register_commands(cef_ui, ctx);
        property_commands::register_commands(cef_ui, ctx);
        info_commands::register_commands(cef_ui, ctx);
        game_commands::register_commands(cef_ui, ctx);
        component_commands::register_commands(cef_ui, ctx);
        cdn_commands::register_commands(cef_ui, ctx);
        discord_commands::register_commands(cef_ui, ctx);
    mod_commands::register_commands(cef_ui, ctx);
        social_commands::register_commands(cef_ui, ctx);
    }
}
