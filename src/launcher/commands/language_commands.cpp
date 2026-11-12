#include "std_include.hpp"
#include "language_commands.hpp"
#include "game_commands.hpp"
#include "cef/cef_ui.hpp"
#include "languages/game_languages.hpp"
#include "mods/mod_store.hpp"
#include "updater/ui_progress_listener.hpp"
#include <utils/finally.hpp>
#include <utils/flags.hpp>
#include <utils/nt.hpp>
#include <utils/property_keys.hpp>

namespace commands::language_commands
{
    namespace
    {
        std::atomic_bool running{false};
        std::mutex status_mutex;
        struct job_status
        {
            std::string game;
            bool success{};
            std::string error;
            std::string message;
        };
        job_status status;

        rapidjson::Value json_string(const std::string& value, rapidjson::Document::AllocatorType& allocator)
        {
            return rapidjson::Value(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
        }

        std::optional<game_config::game_config_t> request_config(const rapidjson::Value& value)
        {
            if (!value.IsObject() || !value.HasMember("game") || !value["game"].IsString())
                return {};
            const auto config =
                game_config::get_game_config(std::string(value["game"].GetString(), value["game"].GetStringLength()));
            return config && game_languages::supported(config->game_key) ? config : std::nullopt;
        }

        void answer(rapidjson::Document& response, const bool started, const std::string& error = {})
        {
            response.SetObject();
            response.AddMember("started", started, response.GetAllocator());
            if (!error.empty())
                response.AddMember("error", json_string(error, response.GetAllocator()), response.GetAllocator());
        }

        bool game_running(const game_config::game_config_t& config)
        {
            // Include retail exes as well as CB/Plutonium processes. Never edit a live game's banks.
            for (const auto& exe : config.valid_game_files)
            {
                if (std::filesystem::path(exe).extension() == ".exe" && utils::nt::is_process_running(exe))
                    return true;
            }
            return game_config::is_game_process_running(config.id, 0);
        }
    } // namespace

    bool active()
    {
        return running.load();
    }

    bool active_for(std::string_view game)
    {
        std::lock_guard lock(status_mutex);
        return active() && status.game == game;
    }

    bool blocks_game(const game_config::game_config_t& config)
    {
        if (active())
            return true;
        try
        {
            return game_languages::supported(config.game_key) && game_languages::pending(config);
        }
        catch (const std::exception&)
        {
            return true;
        } // A damaged recovery record must not launch a half-installed game.
    }

    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command(
            "get-game-languages",
            [](const rapidjson::Value& value, rapidjson::Document& response)
            {
                response.SetObject();
                auto& allocator = response.GetAllocator();
                const auto config = request_config(value);
                response.AddMember("supported", config.has_value(), allocator);
                if (!config)
                    return;
                const auto saved = config->get(property_keys::GAME_LANGUAGE).value_or("");
                response.AddMember("selected", json_string(saved.empty() ? "source" : saved, allocator), allocator);
                rapidjson::Value choices(rapidjson::kArrayType);
                rapidjson::Value follow(rapidjson::kObjectType);
                follow.AddMember("value", "auto", allocator);
                follow.AddMember("label", "Use CB launcher language", allocator);
                choices.PushBack(follow, allocator);
                for (const auto& option : game_languages::options(config->game_key))
                {
                    if (option.value == "auto")
                        continue;
                    rapidjson::Value entry(rapidjson::kObjectType);
                    entry.AddMember("value", json_string(option.value, allocator), allocator);
                    entry.AddMember("label", json_string(option.label, allocator), allocator);
                    choices.PushBack(entry, allocator);
                }
                response.AddMember("options", choices, allocator);
                rapidjson::Value job(rapidjson::kObjectType);
                {
                    std::lock_guard lock(status_mutex);
                    const auto matches = status.game == config->game_key;
                    job.AddMember("running", active(), allocator);
                    job.AddMember("success", matches && status.success, allocator);
                    job.AddMember("error", json_string(matches ? status.error : "", allocator), allocator);
                    job.AddMember("message",
                                  json_string(active() && !matches ? "Another game's language files are being changed."
                                              : matches            ? status.message
                                                                   : "",
                                              allocator),
                                  allocator);
                }
                try
                {
                    response.AddMember("installed", json_string(game_languages::installed(*config), allocator),
                                       allocator);
                    response.AddMember("recoveryRequired", game_languages::pending(*config), allocator);
                }
                catch (const std::exception& e)
                {
                    job["error"] = json_string(e.what(), allocator);
                    response.AddMember("recoveryRequired", true, allocator);
                }
                response.AddMember("active", job, allocator);
            });

        cef_ui.add_command(
            "apply-game-language",
            [](const rapidjson::Value& value, rapidjson::Document& response)
            {
                const auto config = request_config(value);
                if (!config || !value.HasMember("language") || !value["language"].IsString())
                {
                    answer(response, false, "Language downloads currently support BO1, BO2 and WaW only.");
                    return;
                }
                const std::string selected(value["language"].GetString(), value["language"].GetStringLength());
                auto language = selected;
                if (selected == "auto")
                {
                    if (!value.HasMember("launcherLanguage") || !value["launcherLanguage"].IsString())
                    {
                        answer(response, false, "Choose a CB launcher language first.");
                        return;
                    }
                    language.assign(value["launcherLanguage"].GetString(), value["launcherLanguage"].GetStringLength());
                    if (language == "es-ES")
                        language = "es";
                }
                const auto options = game_languages::options(config->game_key);
                if (std::none_of(options.begin(), options.end(),
                                 [&](const auto& option) { return option.value == language; }))
                {
                    answer(response, false,
                           "No verified pack is available for this game and language. Existing files were kept.");
                    return;
                }
                if (utils::flags::has_flag("offline") && language != "source" && language != "en")
                {
                    answer(response, false,
                           "Language downloads are unavailable in offline mode. Original files can still be restored.");
                    return;
                }
                bool expected = false;
                if (!running.compare_exchange_strong(expected, true))
                {
                    answer(response, false, "A language operation is already running.");
                    return;
                }
                const auto release_on_failure = utils::finally(
                    [&]
                    {
                        if (!response.IsObject() || !response.HasMember("started") || !response["started"].GetBool())
                            running = false;
                    });
                if (game_commands::launch_busy() || updater::progress_tracker::instance().is_active() ||
                    game_running(*config))
                {
                    answer(
                        response, false,
                        "Close the game and wait for other downloads or updates to finish before changing language.");
                    return;
                }
                if (!config->get_install_path() || !mods::try_claim_install(*config))
                {
                    answer(response, false, "Locate the complete game and wait for any mod install to finish first.");
                    return;
                }
                bool handed_off = false;
                const auto release_claim = utils::finally(
                    [&]
                    {
                        if (!handed_off)
                            mods::release_install(*config);
                    });
                const auto listener = std::make_shared<updater::ui_progress_listener>();
                const auto release_progress = utils::finally(
                    [&]
                    {
                        if (!handed_off)
                            listener->done_update();
                    });
                listener->reset(true);
                {
                    std::lock_guard lock(status_mutex);
                    status = {config->game_key, false, {}, "Preparing and verifying language files..."};
                }
                try
                {
                    std::thread(
                        [config = *config, language, selected, listener]
                        {
                            const auto cleanup = utils::finally(
                                [&]
                                {
                                    listener->done_update();
                                    mods::release_install(config);
                                    running = false;
                                });
                            try
                            {
                                game_languages::apply(config, language, *listener);
                                config.set(property_keys::GAME_LANGUAGE, selected);
                                std::lock_guard lock(status_mutex);
                                status = {config.game_key,
                                          true,
                                          {},
                                          language == "en" || language == "source"
                                              ? "Original game files restored. Their language depends on your original "
                                                "installation."
                                              : "Language files installed and verified. You can launch the game."};
                            }
                            catch (const std::exception& e)
                            {
                                std::lock_guard lock(status_mutex);
                                status = {config.game_key, false, e.what(), {}};
                            }
                            catch (...)
                            {
                                std::lock_guard lock(status_mutex);
                                status = {config.game_key,
                                          false,
                                          "Language installation failed. Retry Original game files to recover.",
                                          {}};
                            }
                        })
                        .detach();
                    handed_off = true;
                }
                catch (const std::exception& e)
                {
                    answer(response, false, e.what());
                    return;
                }
                answer(response, true);
            });
    }
} // namespace commands::language_commands
