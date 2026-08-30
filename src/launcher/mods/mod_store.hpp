#pragma once

#include "game_config.hpp"

namespace mods
{
    struct content_folder
    {
        std::string name;
        std::filesystem::path path;
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
        uint64_t size{};
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

    // Return false to cancel the running operation (honoured during downloads).
    using progress_callback = std::function<bool(const std::string& phase, const std::string& name, int percent)>;

    std::string json_string(const rapidjson::Value& object, const char* key);
    rapidjson::Value to_json(const installed_mod& mod, rapidjson::Document::AllocatorType& allocator);

    bool supports(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> content_root(const game_config::game_config_t& config);
    std::vector<content_folder> content_folders(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> ensure_content_folder(const game_config::game_config_t& config, const std::string& folder);

    std::string extract_zip(const std::filesystem::path& archive, const std::filesystem::path& into);
    uint64_t folder_size(const std::filesystem::path& directory);

    std::vector<installed_mod> list_installed(const game_config::game_config_t& config);
    import_result import_folder(const game_config::game_config_t& config, const std::filesystem::path& source, const progress_callback& progress = {}, const std::string& origin = "import");
    import_result import_zip(const game_config::game_config_t& config, const std::filesystem::path& archive, const progress_callback& progress = {});
    import_result install_workshop_item(const game_config::game_config_t& config, const std::string& workshop_id, uint64_t expected_size,
                                        const std::vector<workshop_download>& children = {}, const progress_callback& progress = {});
    std::optional<std::filesystem::path> mod_path(const game_config::game_config_t& config, const std::string& id);
    bool uninstall(const game_config::game_config_t& config, const std::string& id, std::string& error);
}
