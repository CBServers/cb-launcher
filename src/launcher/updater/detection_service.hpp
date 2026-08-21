#pragma once

#include <string>
#include <game_config.hpp>

// Background component detection: property-only workers, no UI access.
namespace detection_service
{
    // True while a detection worker (on-demand or sweep) runs for this game.
    bool is_active(const std::string& game_key);

    // Spawns an on-demand detection worker; false if one is already running for this game.
    bool start_detection(const game_config::game_config_t& config);

    // One-shot startup sweep stamping legacy installs; subsequent calls are no-ops.
    void start_sweep();

    // Signals every worker to stop and joins the sweep thread.
    void shutdown();
}
