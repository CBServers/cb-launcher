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

    using progress_callback = std::function<void(const std::string& phase, const std::string& name)>;

    std::string json_string(const rapidjson::Value& object, const char* key);
    rapidjson::Value to_json(const installed_mod& mod, rapidjson::Document::AllocatorType& allocator);

    bool supports(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> content_root(const game_config::game_config_t& config);
    std::vector<content_folder> content_folders(const game_config::game_config_t& config);
    std::optional<std::filesystem::path> ensure_content_folder(const game_config::game_config_t& config, const std::string& folder);

    std::vector<installed_mod> list_installed(const game_config::game_config_t& config);
    import_result import_folder(const game_config::game_config_t& config, const std::filesystem::path& source, const progress_callback& progress = {});
    import_result import_zip(const game_config::game_config_t& config, const std::filesystem::path& archive, const progress_callback& progress = {});
    bool uninstall(const game_config::game_config_t& config, const std::string& id, std::string& error);
}
