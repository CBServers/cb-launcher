#pragma once

#include "file_info.hpp"
#include "ui_progress_listener.hpp"
#include <game_config.hpp>

namespace client_updater
{
    class client_updater
    {
    public:
        client_updater(const game_config::game_config_t& config, const game_config::client_files_t& client,
            const std::vector<std::string>& skip_files = {}, updater::ui_progress_listener * listener = nullptr);

        void run() const;
        void delete_client() const;

        [[nodiscard]] std::vector<updater::file_info> get_outdated_files(const std::vector<updater::file_info>& files) const;

        void update_files(const std::vector<updater::file_info>& outdated_files) const;

    private:
        std::filesystem::path install_path;
        std::filesystem::path client_default_path_;
        std::filesystem::path manifest_cache_path_;   // Last successfully applied manifest, per client
        std::string update_manifest_url_;
        std::string update_folder_url_;
        std::vector<updater::file_info> valid_files_;
        std::vector<updater::file_info> manifest_files_;   // FULL manifest, pre-filter
        std::vector<std::string> skip_files_;
        std::unordered_set<std::string> client_install_path_files_;
        std::vector<game_config::data_folder_t> client_data_folders_;
        updater::ui_progress_listener* progress_listener_;

        void update_file(const updater::file_info& file) const;

        [[nodiscard]] bool is_outdated_file(const updater::file_info& file) const;
        [[nodiscard]] std::filesystem::path get_drive_filename(const updater::file_info& file) const;
        [[nodiscard]] std::filesystem::path resolve_drive_path(const std::string& name, updater::file_dest dest) const;
        [[nodiscard]] std::filesystem::path resolve_base_path(const std::string& name, updater::file_dest dest) const;
        [[nodiscard]] std::filesystem::path resolve_data_dir(const game_config::data_folder_t& entry) const;
        void remove_stale_files() const;
        void store_applied_manifest() const;
        [[nodiscard]] bool is_update_cancelled() const;
    };
}
