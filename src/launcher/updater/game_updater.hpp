#pragma once

#include "file_info.hpp"
#include "ui_progress_listener.hpp"
#include <atomic>
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

        // External stop signal for listener-less detection (background sweep, shutdown)
        void set_cancel_flag(const std::atomic<bool>* flag) { this->cancel_flag_ = flag; }

        // Component management methods
        [[nodiscard]] std::vector<component_info> get_available_components() const;
        // Input components plus every component the manifest marks required, so base can never be dropped
        [[nodiscard]] std::vector<std::string> with_required_components(const std::vector<std::string>& components) const;
        [[nodiscard]] std::vector<std::string> detect_installed_components() const;
        // True while the stored detection matches the current manifest hash and install path
        [[nodiscard]] bool detection_cache_valid() const;
        // Persists the detection result together with its validity stamp
        void store_detection_result(const std::vector<std::string>& detected) const;
        [[nodiscard]] std::vector<updater::file_info> filter_files_by_components(
            const std::vector<updater::file_info>& all_files,
            const std::vector<std::string>& selected_components) const;
        [[nodiscard]] size_t calculate_component_size(const std::vector<std::string>& components) const;

    private:
        const game_config::game_config_t& config_;
        std::filesystem::path install_path;
        std::string base_url;
        update_manifest manifest_;
        // Per-prefix steam remaps (zone/ and raw/video/ to the install root), probed from disk
        bool remap_zone_{false};
        bool remap_video_{false};
        bool skip_hash_check_;
        bool delete_deselected_;
        updater::ui_progress_listener* progress_listener_;
        const std::atomic<bool>* cancel_flag_{nullptr};

        void update_file(const updater::file_info& file) const;

        // Downloads into the file's .part, returning the streamed hash when the whole file was covered
        [[nodiscard]] std::optional<std::string> download_to_part(const updater::file_info& file, const std::string& url,
            const std::filesystem::path& part, std::size_t offset) const;
        // Verifies the .part and swaps it over the real file; throws and drops the .part on mismatch
        void publish_part(const updater::file_info& file, const std::filesystem::path& part,
            const std::filesystem::path& target, const std::optional<std::string>& streamed_hash) const;
        [[nodiscard]] std::filesystem::path get_part_filename(const updater::file_info& file) const;
        // Drops .part files left by a manifest version we're no longer downloading
        void remove_stale_parts(const std::vector<updater::file_info>& files) const;
        // Drops every .part belonging to these files, current manifest version included
        void remove_all_parts(const std::vector<updater::file_info>& files) const;
        void remove_parts(const std::vector<updater::file_info>& files, bool keep_current) const;

        // Download with retry support
        void download_with_retry(const std::vector<updater::file_info>& files) const;
        // Returns the files that failed, for the caller to retry
        [[nodiscard]] std::vector<updater::file_info> download_files(const std::vector<updater::file_info>& files) const;

        std::size_t get_update_size(const std::vector<updater::file_info>& files) const;
        std::size_t get_available_drive_space() const;

        [[nodiscard]] bool is_outdated_file(const updater::file_info& file) const;
        // Probes the install's layout from disk; the persisted steam flag only breaks ties
        void probe_layout();
        // Canonical path first, then the steam-remapped one where the prefix applies
        [[nodiscard]] std::vector<std::filesystem::path> get_candidate_paths(const updater::file_info& file) const;
        // First candidate present on disk; presence checks accept either layout
        [[nodiscard]] std::optional<std::filesystem::path> resolve_existing(const updater::file_info& file) const;
        // The one deterministic path downloads and deletions act on, from the probed layout
        [[nodiscard]] std::filesystem::path resolve_target(const updater::file_info& file) const;
        [[nodiscard]] std::filesystem::path get_manifest_file_path() const;
        [[nodiscard]] std::string make_detection_stamp() const;
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
