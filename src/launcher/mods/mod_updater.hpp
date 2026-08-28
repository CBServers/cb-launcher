#pragma once

#include "mod_store.hpp"

namespace mod_updater
{
    struct override_entry
    {
        std::string id;
        std::string version;
        std::string kind;
        uint64_t size{};
        std::vector<mods::workshop_download> children;
    };

    // CDN-hosted overrides for Workshop ids ("<cdn>/mods/<game>/overrides.json"), cached briefly.
    std::vector<override_entry> get_overrides(const game_config::game_config_t& config);
    std::optional<override_entry> find_override(const game_config::game_config_t& config, const std::string& workshop_id);

    // Converges target to the entry's hosted manifest; returns an error message, empty on success.
    std::string sync_item(const game_config::game_config_t& config, const override_entry& entry,
                          const std::filesystem::path& target, const mods::progress_callback& progress);
}
