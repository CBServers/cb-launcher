#include "std_include.hpp"
#include "property_commands.hpp"
#include "cef/cef_ui.hpp"
#include <utils/io.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/string.hpp>
#include <game_config.hpp>

namespace commands::property_commands
{
    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
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
                response.SetString(result->data(), static_cast<rapidjson::SizeType>(result->length()), response.GetAllocator());
            }
            else
            {
                response.SetNull();
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
            const auto path = utils::string::utf8_to_path(value["path"].GetString());
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

                if (config->supports_steam_install)
                {
                    const auto has_zone_folder = utils::io::directory_exists(path / "zone");
                    const auto has_video_folder = utils::io::directory_exists(path / "raw" / "video");
                    // Steam copies vary; any missing canonical dir marks a steam-shaped install
                    config->set_steam_install(!has_zone_folder || !has_video_folder);
                }
                else
                {
                    config->set_steam_install(false);
                }

                // Installed flips only once the setup pipeline's verify succeeds
            }
            else
            {
                // For new downloads, mark as not installed yet
                config->set_installed(false);
            }

            // A changed path invalidates any cached detection result
            const auto previous_path = config->get_install_path();
            if (!previous_path.has_value() || *previous_path != path)
            {
                config->set_list(property_keys::DETECTED_COMPONENTS, {});
                config->set(property_keys::DETECTED_COMPONENTS_STAMP, "");
            }

            if (!utils::io::directory_exists(path))
            {
                utils::io::create_directory(path);
            }

            // Path is valid, store it (set_install_path serializes to UTF-8 internally)
            config->set_install_path(path);
            response.SetBool(true); // Success
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
    }
}
