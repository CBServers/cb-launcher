#pragma once

#include "update_cancelled.hpp"
#include "progress_listener.hpp"
#include "ui_progress_listener.hpp"
#include <game_config.hpp>

namespace launcher_updater
{
    void run(const std::filesystem::path& base);
}

namespace game_updater
{
    void run(const game_config::game_config_t& config, bool skip_hash = false, bool delete_deselected = false, updater::ui_progress_listener* listener = nullptr);
}

namespace client_updater
{
    // Each returns false when some attempted client's manifest could not be fetched.
    bool run(const game_config::game_config_t& config, const game_config::client_files_t& client,
        const std::vector<std::string>& skip_files = {}, updater::ui_progress_listener* listener = nullptr);

    // Updates every client the game declares, in order.
    bool run_all(const game_config::game_config_t& config, const std::vector<std::string>& skip_files = {},
        updater::ui_progress_listener* listener = nullptr);

    // Updates only the client a mode maps to; unmapped or blank modes fall back to run_all().
    bool run_for_mode(const game_config::game_config_t& config, const std::string& mode,
        const std::vector<std::string>& skip_files = {}, updater::ui_progress_listener* listener = nullptr);
}
