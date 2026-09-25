#pragma once

#include "mod_store.hpp"

namespace mods::steamcmd
{
    bool ensure_installed(const progress_callback& progress, std::string& error);
    // Content lands under install_dir (SteamCMD's force_install_dir), so staging on the game's volume makes the install a rename.
    std::optional<std::filesystem::path> download_item(const std::filesystem::path& install_dir, uint32_t appid, const std::string& workshop_id,
                                                       uint64_t expected_size, const progress_callback& progress, std::string& error);
    void cleanup_downloads(const std::filesystem::path& install_dir, uint32_t appid, const std::string& workshop_id);
}
