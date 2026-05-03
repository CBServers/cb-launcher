#include "std_include.hpp"
#include "info_commands.hpp"
#include "cef/cef_ui.hpp"

#include <utils/properties.hpp>
#include <utils/nt.hpp>
#include <game_config.hpp>
#include <version.hpp>

#include "updater/updater.hpp"
#include "updater/progress_tracker.hpp"

namespace commands::info_commands
{
    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("get-update-progress", [](const auto&, rapidjson::Document& response)
        {
            const auto state = updater::progress_tracker::instance().get_progress();

            response.SetObject();
            auto& allocator = response.GetAllocator();

            response.AddMember("active", state.is_active, allocator);
            response.AddMember("paused", state.is_paused, allocator);
            response.AddMember("progress", state.progress_percent, allocator);

            rapidjson::Value message_value;
            message_value.SetString(state.status_message.data(), static_cast<rapidjson::SizeType>(state.status_message.length()), allocator);
            response.AddMember("message", message_value, allocator);

            rapidjson::Value file_value;
            file_value.SetString(state.current_file.data(), static_cast<rapidjson::SizeType>(state.current_file.length()), allocator);
            response.AddMember("currentFile", file_value, allocator);

            response.AddMember("totalFiles", state.total_files, allocator);
            response.AddMember("completedFiles", state.completed_files, allocator);
            response.AddMember("totalBytes", state.total_bytes, allocator);
            response.AddMember("downloadedBytes", state.downloaded_bytes, allocator);
        });

        cef_ui.add_command("cancel-update", [](const auto&, rapidjson::Document& response)
        {
            response.SetBool(false); // Default to failure

            updater::progress_tracker::instance().cancel_update();
            response.SetBool(true);
        });

        cef_ui.add_command("pause-update", [](const auto&, rapidjson::Document& response)
        {
            updater::progress_tracker::instance().pause_update();
            response.SetBool(true);
        });

        cef_ui.add_command("resume-update", [](const auto&, rapidjson::Document& response)
        {
            updater::progress_tracker::instance().resume_update();
            response.SetBool(true);
        });

        cef_ui.add_command("get-version", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            response.AddMember("version", VERSION, allocator);
            response.AddMember("versionFile", VERSION_FILE, allocator);
            response.AddMember("versionProduct", VERSION_PRODUCT, allocator);
            response.AddMember("gitHash", GIT_HASH, allocator);
            response.AddMember("gitBranch", GIT_BRANCH, allocator);
            response.AddMember("gitDirty", GIT_DIRTY, allocator);
        });

        cef_ui.add_command("is-wine-environment", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetBool(utils::nt::is_wine_environment());
        });

        cef_ui.add_command("check-launcher-update", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            try
            {
#if !defined(DEBUG)
                const auto path = utils::properties::get_appdata_path();
                printf("Checking for launcher updates...\n");
                launcher_updater::run(path);
#endif
                response.AddMember("updateComplete", true, allocator);
            }
            catch (const updater::update_cancelled&)
            {
                printf("Update cancelled by user\n");
                response.AddMember("updateComplete", false, allocator);
            }
            catch (const std::exception& e)
            {
                printf("Update check error: %s\n", e.what());
                response.AddMember("updateComplete", false, allocator);
            }
        });
    }
}
