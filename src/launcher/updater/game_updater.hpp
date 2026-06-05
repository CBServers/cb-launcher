#pragma once

#include "file_info.hpp"
#include "ui_progress_listener.hpp"
#include <string>
#include <filesystem>
#include <optional>
#include <game_config.hpp>

namespace game_updater
{
    class game_updater
    {
    public:
        game_updater(const game_config::game_config_t& config, bool skip_hash = false, bool delete_deselected = false, updater::ui_progress_listener* listener = nullptr);

        void run() const;
        void delete_game() const;
        size_t get_game_size() const;
        bool is_update_needed() const;

        [[nodiscard]] std::vector<updater::file_info> get_outdated_files(const std::vector<updater::file_info>& files) const;

        bool needs_to_update(const std::string& hash) const;

        // Component management methods
        [[nodiscard]] std::vector<component_info> get_available_components() const;
        [[nodiscard]] std::vector<std::string> detect_installed_components() const;
        [[nodiscard]] std::vector<updater::file_info> filter_files_by_components(
            const std::vector<updater::file_info>& all_files,
            const std::vector<std::string>& selected_components) const;
        [[nodiscard]] size_t calculate_component_size(const std::vector<std::string>& components) const;

    private:
        const game_config::game_config_t& config_;
        std::filesystem::path install_path;
        std::string base_url;
        update_manifest manifest_;
        bool is_steam_install;
        bool skip_hash_check_;
        bool delete_deselected_;
        updater::ui_progress_listener* progress_listener_;

        void update_file(const updater::file_info& file) const;

        // Download with retry support
        void update_and_verify_with_retry(const std::vector<updater::file_info>& files) const;
        void update_files_no_verify(const std::vector<updater::file_info>& files) const;

        std::size_t get_update_size(const std::vector<updater::file_info>& files) const;
        std::size_t get_available_drive_space() const;

        [[nodiscard]] bool is_outdated_file(const updater::file_info& file) const;
        [[nodiscard]] std::filesystem::path get_drive_filename(const updater::file_info& file) const;
        [[nodiscard]] std::filesystem::path get_manifest_file_path() const;
        [[nodiscard]] std::string read_installed_hash() const;
        void write_installed_hash(const std::string& hash) const;
        void delete_installed_hash() const;
        [[nodiscard]] bool is_update_cancelled() const;
        [[nodiscard]] bool is_update_paused() const;
        void check_cancelled() const; // Throws update_cancelled exception if cancelled
        // Blocks the current thread while the update is paused, then runs a cancellation
        // check. Use at per-file boundaries to give pause-resume the desired granularity.
        void wait_if_paused_or_cancelled() const;

        // Get files that should be deleted (files from deselected components)
        [[nodiscard]] std::vector<updater::file_info> get_files_to_delete(
            const std::vector<std::string>& selected_components) const;

        // Delete files with progress tracking
        void delete_files(const std::vector<updater::file_info>& files) const;
    };
}
