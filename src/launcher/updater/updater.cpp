#include <std_include.hpp>

#include "updater.hpp"
#include "updater_ui.hpp"
#include "launcher_updater.hpp"
#include "game_updater.hpp"
#include "client_updater.hpp"

#include <version.hpp>

#include <utils/properties.hpp>

namespace launcher_updater
{
    void run(const std::filesystem::path& base)
    {
        const utils::nt::library self;
        const auto self_file = self.get_path();

        updater_ui updater_ui{};
        const launcher_updater launcher_updater{updater_ui, base, self_file};

        launcher_updater.run();

        std::this_thread::sleep_for(1s);
    }
}

namespace game_updater
{
    void run(const game_config::game_config_t& config, bool skip_hash, bool delete_deselected, updater::ui_progress_listener* listener)
    {
        const game_updater game_updater{config, skip_hash, delete_deselected, listener};
        game_updater.run();
    }
}

namespace client_updater
{
    bool run(const game_config::game_config_t& config, const game_config::client_files_t& client,
        const std::vector<std::string>& skip_files, updater::ui_progress_listener* listener)
    {
        const client_updater client_updater{config, client, skip_files, listener};
        client_updater.run();
        return !client_updater.manifest_fetch_failed();
    }

    bool run_all(const game_config::game_config_t& config, const std::vector<std::string>& skip_files,
        updater::ui_progress_listener* listener)
    {
        auto fetched_all = true;
        for (const auto& client : config.clients)
        {
            fetched_all &= run(config, client, skip_files, listener);
        }

        return fetched_all;
    }

    bool run_for_mode(const game_config::game_config_t& config, const std::string& mode,
        const std::vector<std::string>& skip_files, updater::ui_progress_listener* listener)
    {
        if (config.clients.size() < 2)
        {
            return run_all(config, skip_files, listener);
        }

        if (const auto* client = game_config::select_client_for_mode(config, mode))
        {
            return run(config, *client, skip_files, listener);
        }

        // A mode no client claims: update everything rather than silently skip.
        return run_all(config, skip_files, listener);
    }
}
