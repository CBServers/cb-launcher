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

        cef_ui.add_command("get-launch-flags", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetArray();
            auto& allocator = response.GetAllocator();

            if (!value.IsObject() || !value.HasMember("game") || !value["game"].IsString())
            {
                return;
            }

            const auto config = game_config::get_game_config(value["game"].GetString());
            if (!config)
            {
                return;
            }

            for (const auto& flag : config->launch_flags)
            {
                rapidjson::Value entry(rapidjson::kObjectType);
                entry.AddMember("id", rapidjson::Value(flag.id, allocator), allocator);
                entry.AddMember("argument", rapidjson::Value(flag.argument, allocator), allocator);
                entry.AddMember("risky", flag.risky, allocator);

                if (flag.choices.empty())
                {
                    entry.AddMember("enabled", config->launch_flag_enabled(flag), allocator);
                }
                else
                {
                    rapidjson::Value choices(rapidjson::kArrayType);
                    for (const auto& choice : flag.choices)
                    {
                        choices.PushBack(rapidjson::Value(choice.value, allocator), allocator);
                    }
                    entry.AddMember("choices", choices, allocator);

                    const auto* selected = config->launch_flag_choice(flag);
                    entry.AddMember("value", rapidjson::Value(selected ? selected->value : flag.choices.front().value, allocator), allocator);
                }

                response.PushBack(entry, allocator);
            }
        });

        // Only ids the game declares are stored, so the UI can never inject an arbitrary argument.
        cef_ui.add_command("set-launch-flags", [](const rapidjson::Value& value, auto&)
        {
            if (!value.IsObject() || !value.HasMember("game") || !value["game"].IsString() ||
                !value.HasMember("flags") || !value["flags"].IsObject())
            {
                return;
            }

            const auto config = game_config::get_game_config(value["game"].GetString());
            if (!config)
            {
                return;
            }

            const auto& flags = value["flags"];
            for (const auto& flag : config->launch_flags)
            {
                const auto it = flags.FindMember(flag.id);
                if (it == flags.MemberEnd())
                {
                    continue;
                }

                if (flag.choices.empty())
                {
                    if (it->value.IsBool())
                    {
                        config->set(config->launch_flag_property(flag), it->value.GetBool() ? "true" : "");
                    }
                    continue;
                }

                if (!it->value.IsString())
                {
                    continue;
                }

                const std::string picked = it->value.GetString();
                const auto known = std::any_of(flag.choices.begin(), flag.choices.end(),
                    [&picked](const game_config::launch_choice_t& choice) { return choice.value == picked; });
                if (known)
                {
                    config->set(config->launch_flag_property(flag), picked);
                }
            }
        });

        cef_ui.add_command("get-client-channel", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto config = (value.IsObject() && value.HasMember("game") && value["game"].IsString())
                ? game_config::get_game_config(value["game"].GetString())
                : std::nullopt;

            const auto available = config && config->has_dev_channel();
            response.AddMember("available", available, allocator);
            response.AddMember("channel", rapidjson::StringRef(available && config->uses_dev_channel() ? "dev" : "release"), allocator);
            response.AddMember("defaultChannel", rapidjson::StringRef(game_config::build_defaults_to_dev_channel() ? "dev" : "release"), allocator);
        });

        // Picking the build's own channel clears the property, so the game keeps following the launcher.
        cef_ui.add_command("set-client-channel", [](const rapidjson::Value& value, auto&)
        {
            if (!value.IsObject() || !value.HasMember("game") || !value["game"].IsString() ||
                !value.HasMember("channel") || !value["channel"].IsString())
            {
                return;
            }

            const auto config = game_config::get_game_config(value["game"].GetString());
            if (!config || !config->has_dev_channel())
            {
                return;
            }

            const std::string channel = value["channel"].GetString();
            if (channel != "dev" && channel != "release")
            {
                return;
            }

            const auto default_channel = game_config::build_defaults_to_dev_channel() ? "dev" : "release";
            config->set(property_keys::CLIENT_CHANNEL, channel == default_channel ? "" : channel);
        });

        cef_ui.add_command("set-game-path", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetBool(false); // Default to failure

            if (!value.IsObject() || !value.HasMember("game") || !value.HasMember("path") || !value.HasMember("existing_install"))
            {
                return;
            }

            const auto game = std::string{ value["game"].GetString() };
            auto path = utils::string::utf8_to_path(value["path"].GetString());
            const auto existing_install = value["existing_install"].GetBool();

            // Get game config
            const auto config = game_config::get_game_config(game);
            if (!config)
            {
                return;
            }

            if (existing_install)
            {
                // The Xbox app keeps the game in Content, one level below the folder it shows users
                if (!config->microsoft_store_components.empty() && !game_config::validate_game_path(game, path)
                    && utils::io::file_exists(path / "Content" / "MicrosoftGame.config"))
                {
                    path /= "Content";
                }

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
