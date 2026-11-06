#pragma once

#include "game_config.hpp"

namespace mods
{
    struct content_folder
    {
        std::string name;
        std::filesystem::path path;
    };

    // One file of a mod index entry. urls are the download links (several = ordered parts) and are not recorded.
    struct catalog_file
    {
        std::string root;
        std::string path;
        uint64_t size{};
        std::string hash;
        std::vector<std::string> urls;
    };

    struct installed_mod
    {
        std::string id;
        std::string name;
        std::string kind;
        std::string folder;
        std::string source;
        std::string version;
        std::string workshop_id;
        std::string installed_at;
        // Read from the folder on every listing, never stored in the index.
        std::string author;
        std::string description;
        uint64_t size{};
        // Mod index installs: every file the launcher placed, and whether any has gone missing since.
        std::vector<catalog_file> files;
        bool missing_files{};
    };

    struct import_result
    {
        bool success{};
        std::string error;
        std::optional<installed_mod> mod;
    };

    struct workshop_download
    {
        std::string id;
        uint64_t size{};
    };

    constexpr size_t MAX_WORKSHOP_CHILDREN = 16;
    constexpr auto SOURCE_CATALOG = "catalog";

    // Return false to cancel the running operation (honoured during downloads).
    using progress_callback = std::function<bool(const std::string& phase, const std::string& name, int percent)>;

    // Coordinates installs started by the launcher UI and trusted game IPC.
    bool try_claim_install(const game_config::game_config_t& config);
    void release_install(const game_config::game_config_t& config);

    std::string json_string(const rapidjson::Value& object, const char* key);
    std::string now_iso8601();
    rapidjson::Value to_json(const installed_mod& mod, rapidjson::Document::AllocatorType& allocator);

    bool supports(const game_config::game_config_t& config);
    // Games whose Browse tab is the community mod index rather than the Steam Workshop.
    bool uses_catalog(const game_config::game_config_t& config);
    // Roots a mod index file may target ("game", "storage"), the default first.
    std::vector<std::string> catalog_roots(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> catalog_root_path(const game_config::game_config_t& config, const std::string& root);
    std::string catalog_record_id(const std::string& entry_id);

    std::vector<installed_mod> read_index(const game_config::game_config_t& config);
    void upsert_index(const game_config::game_config_t& config, const installed_mod& mod);
    void erase_index(const game_config::game_config_t& config, const std::string& id);
    bool is_workshop_item_installed(const game_config::game_config_t& config, const std::string& workshop_id);
    std::optional<std::filesystem::path> content_root(const game_config::game_config_t& config);
    std::vector<content_folder> content_folders(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> ensure_content_folder(const game_config::game_config_t& config, const std::string& folder);

    std::string extract_zip(const std::filesystem::path& archive, const std::filesystem::path& into);
    uint64_t folder_size(const std::filesystem::path& directory);

    std::vector<installed_mod> list_installed(const game_config::game_config_t& config);
    // move_source renames the folder into place when it is on the same volume (consuming it); never set for user folders.
    import_result import_folder(const game_config::game_config_t& config, const std::filesystem::path& source, const progress_callback& progress = {},
                                const std::string& origin = "import", bool move_source = false);
    import_result import_zip(const game_config::game_config_t& config, const std::filesystem::path& archive, const progress_callback& progress = {});
    import_result install_workshop_item(const game_config::game_config_t& config, const std::string& workshop_id, uint64_t expected_size,
                                        const std::vector<workshop_download>& children = {}, const progress_callback& progress = {});
    std::optional<std::filesystem::path> mod_path(const game_config::game_config_t& config, const std::string& id);
    bool uninstall(const game_config::game_config_t& config, const std::string& id, std::string& error);
}
