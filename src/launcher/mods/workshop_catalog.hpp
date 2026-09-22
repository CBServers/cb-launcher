#pragma once

#include "game_config.hpp"

#include <optional>
#include <string>
#include <vector>

// Item details from the workshop worker (/v1/item): what an install needs beyond the bare id.
namespace mods::workshop_catalog
{
    struct child
    {
        std::string id;
        std::string title;
        uint64_t size{};
    };

    struct item
    {
        std::string id;
        std::string title;
        std::string kind;
        uint64_t size{};
        std::vector<child> children;
    };

    std::optional<item> fetch(const game_config::game_config_t& config, const std::string& workshop_id);
}
