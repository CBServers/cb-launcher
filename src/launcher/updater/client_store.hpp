#pragma once

#include "file_info.hpp"
#include <game_config.hpp>

#include <rapidjson/document.h>

#include <set>

namespace client_store
{
    // Live-destination resolution for one client: manifest name + dest -> absolute path.
    class client_paths
    {
    public:
        client_paths(std::filesystem::path install_path, const game_config::client_files_t& client);

        [[nodiscard]] std::filesystem::path resolve_file(const std::string& name, updater::file_dest dest) const;
        [[nodiscard]] std::filesystem::path resolve_base(const std::string& name, updater::file_dest dest) const;
        [[nodiscard]] std::filesystem::path resolve_data_dir(const game_config::data_folder_t& entry) const;

    private:
        std::filesystem::path install_path_;
        std::filesystem::path client_default_path_;
        std::unordered_set<std::string> install_path_files_;
    };

    // Unknown tokens fall back to automatic, never a hard failure.
    updater::file_dest parse_file_dest(const std::string& token);
    // Optional 4th manifest element: a bare string, or {"dest": "..."} for future flags.
    updater::file_dest parse_file_dest(const rapidjson::Value& element);

    // One applied-manifest cache entry: the name plus the dest it was resolved with.
    struct cached_file
    {
        std::string name;
        updater::file_dest dest;
    };

    std::filesystem::path manifest_cache_path(const std::string& client_id);
    std::vector<cached_file> read_manifest_cache(const std::string& client_id);

    // Comparable key for a path: absolute, normalized, case-folded like the filesystem.
    std::wstring path_key(const std::filesystem::path& path);

    bool is_inside_folder(const std::filesystem::path& file, const std::filesystem::path& folder);

    // Deepest-first, so a nested directory is gone before its parent is tested.
    void prune_empty_directories(const std::set<std::filesystem::path>& directories);

    // Private per-client store for store-routed games; launcher-owned, never read by the game.
    std::filesystem::path store_path(const std::string& client_id);

    // Delete anything under the store subdir the manifest doesn't name; no-op on an empty manifest.
    void sweep_store(const std::string& client_id, const std::vector<updater::file_info>& manifest_files);

    void delete_store(const std::string& client_id);

    // Reconcile the live layout to `mode`'s selected client; no-op unless store-routed.
    void reconcile(const game_config::game_config_t& config, const std::string& mode);

    // Verify-end pass: every mode's selected client, single-client modes first.
    void reconcile_all(const game_config::game_config_t& config);
}
