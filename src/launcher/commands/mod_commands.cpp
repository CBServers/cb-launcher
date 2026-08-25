#include "std_include.hpp"
#include "mod_commands.hpp"
#include "cef/cef_ui.hpp"
#include "mods/mod_store.hpp"

#include <utils/com.hpp>
#include <utils/io.hpp>
#include <utils/nt.hpp>
#include <utils/string.hpp>

#include <thread>

namespace commands::mod_commands
{
    namespace
    {
        struct import_job
        {
            bool active{};
            std::string phase;
            std::string name;
            std::string error;
            int percent{};
            bool cancelled{};
        };

        std::mutex jobs_mutex_;
        std::unordered_map<std::string, import_job> jobs_;

        rapidjson::Value make_string(const std::string& value, rapidjson::Document::AllocatorType& allocator)
        {
            rapidjson::Value v{};
            v.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
            return v;
        }

        void set_result(rapidjson::Document& response, const bool success, const std::string& error = {})
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            response.AddMember("success", success, allocator);
            if (!error.empty())
            {
                response.AddMember("error", make_string(error, allocator), allocator);
            }
        }

        std::optional<game_config::game_config_t> config_or_fail(const command_context& ctx, const rapidjson::Value& value, rapidjson::Document& response)
        {
            auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                set_result(response, false, "Unknown game.");
            }

            return config;
        }

        void update_job(const std::string& game, const std::function<void(import_job&)>& mutate)
        {
            std::lock_guard lock(jobs_mutex_);
            mutate(jobs_[game]);
        }

        mods::progress_callback job_progress(const std::string& game)
        {
            return [game](const std::string& phase, const std::string& name, const int percent)
            {
                auto keep_running = true;
                update_job(game, [&](import_job& job)
                {
                    job.phase = phase;
                    job.name = name;
                    job.percent = percent;
                    keep_running = !job.cancelled;
                });
                return keep_running;
            };
        }

        void finish_job(const std::string& game, const mods::import_result& result)
        {
            update_job(game, [&result](import_job& job)
            {
                job.active = false;
                job.phase = result.success ? "done" : (result.error == "cancelled" ? "cancelled" : "error");
                job.error = result.error;
                if (result.mod)
                {
                    job.name = result.mod->name;
                }
            });
        }

        void run_import(const game_config::game_config_t config, const std::filesystem::path path, const bool is_zip)
        {
            const auto progress = job_progress(config.game_key);
            finish_job(config.game_key, is_zip
                ? mods::import_zip(config, path, progress)
                : mods::import_folder(config, path, progress));
        }

        void run_workshop_install(const game_config::game_config_t config, const std::string workshop_id, const uint64_t size)
        {
            finish_job(config.game_key, mods::install_workshop_item(config, workshop_id, size, job_progress(config.game_key)));
        }

        // One import/install job per game at a time; returns false (and answers the
        // request) when one is already running.
        bool claim_job(const game_config::game_config_t& config, rapidjson::Document& response)
        {
            std::lock_guard lock(jobs_mutex_);
            auto& job = jobs_[config.game_key];
            if (job.active)
            {
                set_result(response, false, "Another install is already running for this game.");
                return false;
            }

            job = {true, "queued", {}, {}, 0, false};
            return true;
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context& ctx)
    {
        cef_ui.add_command("get-mods-folder", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetNull();

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            if (const auto path = mods::ensure_content_folder(*config, mods::json_string(value, "folder")))
            {
                response.SetString(utils::string::path_to_utf8(*path), response.GetAllocator());
            }
        });

        cef_ui.add_command("get-mod-folder", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetNull();

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            const auto path = mods::mod_path(*config, mods::json_string(value, "id"));
            if (path && utils::io::directory_exists(*path))
            {
                response.SetString(utils::string::path_to_utf8(*path), response.GetAllocator());
            }
        });

        cef_ui.add_command("get-installed-mods", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetArray();
            auto& allocator = response.GetAllocator();

            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                return;
            }

            for (const auto& mod : mods::list_installed(*config))
            {
                response.PushBack(mods::to_json(mod, allocator), allocator);
            }
        });

        cef_ui.add_command("import-mod", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config || !mods::supports(*config))
            {
                set_result(response, false, "This game does not support mods.");
                return;
            }

            const auto path = mods::json_string(value, "path");
            if (path.empty())
            {
                set_result(response, false, "No path was provided.");
                return;
            }

            if (!claim_job(*config, response))
            {
                return;
            }

            std::thread(run_import, *config, utils::string::utf8_to_path(path), mods::json_string(value, "kind") == "zip").detach();
            set_result(response, true);
        });

        const auto workshop_install = [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = config_or_fail(ctx, value, response);
            if (!config)
            {
                return;
            }

            const auto id = mods::json_string(value, "id");
            const auto size = value.IsObject() && value.HasMember("size") && value["size"].IsUint64() ? value["size"].GetUint64() : 0;

            if (!claim_job(*config, response))
            {
                return;
            }

            std::thread(run_workshop_install, *config, id, size).detach();
            set_result(response, true);
        };
        cef_ui.add_command("install-workshop-mod", workshop_install);
        cef_ui.add_command("update-mod", workshop_install);


        cef_ui.add_command("get-mod-progress", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            import_job job{};
            if (const auto config = ctx.get_game_config_from_request(value))
            {
                std::lock_guard lock(jobs_mutex_);
                const auto it = jobs_.find(config->game_key);
                if (it != jobs_.end())
                {
                    job = it->second;
                }
            }

            response.AddMember("active", job.active, allocator);
            response.AddMember("phase", make_string(job.phase, allocator), allocator);
            response.AddMember("name", make_string(job.name, allocator), allocator);
            response.AddMember("error", make_string(job.error, allocator), allocator);
            response.AddMember("percent", job.percent, allocator);
        });

        cef_ui.add_command("cancel-mod-install", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = config_or_fail(ctx, value, response);
            if (!config)
            {
                return;
            }

            auto found = false;
            update_job(config->game_key, [&found](import_job& job)
            {
                if (job.active)
                {
                    job.cancelled = true;
                    found = true;
                }
            });
            set_result(response, found);
        });

        cef_ui.add_command("uninstall-mod", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = config_or_fail(ctx, value, response);
            if (!config)
            {
                return;
            }

            std::string error{};
            const auto success = mods::uninstall(*config, mods::json_string(value, "id"), error);
            set_result(response, success, error);
        });

        cef_ui.add_command("browse-file", [&cef_ui](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetNull();

            std::vector<utils::com::file_filter> filters{};
            if (value.IsObject() && value.HasMember("filters") && value["filters"].IsArray())
            {
                for (const auto& filter : value["filters"].GetArray())
                {
                    const auto name = mods::json_string(filter, "name");
                    const auto pattern = mods::json_string(filter, "pattern");
                    if (!name.empty() && !pattern.empty())
                    {
                        filters.push_back({name, pattern});
                    }
                }
            }

            auto title = mods::json_string(value, "title");
            if (title.empty())
            {
                title = "Select a File";
            }

            try
            {
                std::string file{};
                if (utils::com::select_file(file, title, filters))
                {
                    response.SetString(file, response.GetAllocator());
                }
            }
            catch (const std::exception& e)
            {
                printf("browse-file failed: %s\n", e.what());
                if (utils::nt::is_wine_environment())
                {
                    cef_ui.show_message_box("Browse Failed", "File browser is not available under Wine.");
                }
            }
        });
    }
}
