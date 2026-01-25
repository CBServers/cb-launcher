#include "std_include.hpp"
#include "property_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/properties.hpp>
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
