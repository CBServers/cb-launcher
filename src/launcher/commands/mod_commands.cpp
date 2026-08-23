#include "std_include.hpp"
#include "mod_commands.hpp"
#include "cef/cef_ui.hpp"
#include "mods/mod_store.hpp"

#include <utils/com.hpp>
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

        void update_job(const std::string& game, const std::function<void(import_job&)>& mutate)
        {
            std::lock_guard lock(jobs_mutex_);
            mutate(jobs_[game]);
        }

        void run_import(const game_config::game_config_t config, const std::filesystem::path path, const bool is_zip)
        {
            const auto progress = [&config](const std::string& phase, const std::string& name)
            {
                update_job(config.game_key, [&](import_job& job)
                {
                    job.phase = phase;
                    job.name = name;
                });
            };

            const auto result = is_zip
                ? mods::import_zip(config, path, progress)
                : mods::import_folder(config, path, progress);

            update_job(config.game_key, [&result](import_job& job)
            {
                job.active = false;
                job.phase = result.success ? "done" : "error";
                job.error = result.error;
                if (result.mod)
                {
                    job.name = result.mod->name;
                }
            });
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

            {
                std::lock_guard lock(jobs_mutex_);
                auto& job = jobs_[config->game_key];
                if (job.active)
                {
                    set_result(response, false, "Another import is already running for this game.");
                    return;
                }

                job = {true, "queued", {}, {}};
            }

            std::thread(run_import, *config, utils::string::utf8_to_path(path), mods::json_string(value, "kind") == "zip").detach();
            set_result(response, true);
        });

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
        });

        cef_ui.add_command("uninstall-mod", [&ctx](const rapidjson::Value& value, rapidjson::Document& response)
        {
            const auto config = ctx.get_game_config_from_request(value);
            if (!config)
            {
                set_result(response, false, "Unknown game.");
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
