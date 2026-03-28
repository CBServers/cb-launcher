#pragma once

#include <game_config.hpp>
#include "updater/ui_progress_listener.hpp"
#include "updater/updater.hpp"

namespace unlockall
{
    class unlockall
    {
    public:
        unlockall(const game_config::game_config_t& config, updater::ui_progress_listener* listener = nullptr);

        void run() const;

    private:
        std::filesystem::path install_path;
        std::string unlock_url;
        updater::ui_progress_listener* progress_listener_;

        std::filesystem::path get_unlock_directory() const;
        std::vector<updater::file_info> get_unlock_file_infos() const;
        bool is_already_unlocked(const std::vector<updater::file_info>& file_infos) const;
        bool verify_unlock_file(const updater::file_info& file_info) const;
        void download_unlock_file(const updater::file_info& file_info) const;
        bool is_update_cancelled() const;
        void check_cancelled() const;
    };

    inline void run(const game_config::game_config_t& config, updater::ui_progress_listener* listener)
    {
        const unlockall unlockall{config, listener};
        unlockall.run();
    }
}