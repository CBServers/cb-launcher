#pragma once

#include "mod_store.hpp"

namespace mods::steamcmd
{
    bool ensure_installed(const progress_callback& progress, std::string& error);
    std::optional<std::filesystem::path> download_item(uint32_t appid, const std::string& workshop_id, uint64_t expected_size,
                                                       const progress_callback& progress, std::string& error);
    void cleanup_downloads(uint32_t appid, const std::string& workshop_id);
}
