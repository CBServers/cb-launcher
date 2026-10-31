#pragma once

#include "mod_store.hpp"

// Mod index entries (CBServers/mods-index, served by the workshop worker): loose files placed under the game
// install or Plutonium storage, recorded in the mod index so updates and uninstalls work from what was placed.
namespace catalog_installer
{
    // Installs or updates an entry, the entries it requires first.
    mods::import_result install(const game_config::game_config_t& config, const std::string& entry_id, const mods::progress_callback& progress);
    // Deletes the files an install recorded and prunes the folders that leaves empty.
    bool uninstall(const game_config::game_config_t& config, const std::string& entry_id, std::string& error);
}
