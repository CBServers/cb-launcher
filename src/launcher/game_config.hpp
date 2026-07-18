#pragma once

#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <optional>
#include <filesystem>

namespace game_config
{
    class game_config_t
    {
    public:
        // Generic property access methods
        std::optional<std::string> get(const std::string& property_suffix) const;
        void set(const std::string& property_suffix, const std::string& value) const;

        // List parsing/joining methods
        std::vector<std::string> get_list(const std::string& property_suffix) const;
        void set_list(const std::string& property_suffix, const std::vector<std::string>& values) const;

        // Convenience methods for common properties
        std::optional<std::filesystem::path> get_install_path() const;
        void set_install_path(const std::filesystem::path& path) const;
        bool is_installed() const;
        void set_installed(bool installed) const;
        bool is_steam_install() const;
        void set_steam_install(bool is_steam) const;
        std::optional<std::string> get_launch_options() const;

        // Effective "launch as admin" value: user property if set, else requires_elevation default.
        bool launch_elevated() const;

        // Every exe this game can run as: launch exe, per-mode exes, and known child/companion exes.
        std::vector<std::string> collect_exes() const;

        // Reset all properties for this game
        void reset() const;

        void ensure_plutonium_path() const;

        // Get the game key used for this config
        const std::string& get_game_key() const { return game_key; }

        // Public fields
        std::string game_key;  // The map key ("bo3", "ghosts", "hmw", etc.) - must be initialized first
        std::string display_name;
        std::string id;
        std::string exe_name;
        std::string update_manifest_url;
        std::string update_folder_url;
        std::string manifest_path;
        std::vector<std::string> required_updater_files;
        std::vector<std::string> valid_game_files;
        std::vector<std::string> check_running_exes;
        std::unordered_map<std::string, std::string> mode_arguments;
        std::unordered_map<std::string, std::string> mode_executables;  // mode -> exe name
        std::unordered_map<std::string, std::string> mode_pass_arguments; // Per-mode args forwarded inside --pass "..." (e.g. AlterWare launcher).
        std::string default_args;  // Arguments always passed when launching, regardless of mode
        std::string name_argument; // Command-line prefix for setting in-game name (e.g. "+set name", "-name"). Empty = unsupported.
        std::string pluto_path_key;
        std::string base_folder;
        std::string base_game;
        bool check_for_game_updates = false;

        // Base properties game for property sharing (e.g., HMW shares with MWR)
        std::string base_properties_game;
        // Property overrides for specific properties (e.g., HMW-specific overrides)
        std::unordered_map<std::string, std::string> property_overrides;

        // Default directory for client files. Empty = use install_path (current behavior).
        std::filesystem::path client_default_path;
        // Files that always go to install_path even when client_default_path is set
        std::unordered_set<std::string> client_install_path_files;
        // Relative folder path(s) under the client data root to clean of non-manifest files.
        std::vector<std::string> client_data_folders;

        // Redist group IDs required by this client (from redist_packages.cpp). Unioned with base_game's list at resolve time.
        std::vector<std::string> required_redists;

        // Launch via UAC prompt (e.g. CoD2x needs HKLM access for its HWID key).
        bool requires_elevation = false;

        // Game can be installed from a Steam copy (lacks zone/ and raw/video/ folders), so those manifest prefixes are remapped.
        bool supports_steam_install = false;

        // Helper to construct full property key (public to maintain aggregate status)
        std::string make_property_key(const std::string& suffix) const;
    };

    // Forward declarations
    extern const std::unordered_map<std::string, game_config_t> game_configs_;
    extern const std::unordered_map<std::string, std::string> ui_to_backend_mapping_;

    // Function declarations
    std::optional<game_config_t> get_game_config(const std::string& game);
    // Lookup by wire id (game_config.id, e.g. "boiii"), as used by the IPC protocol / join secrets.
    std::optional<game_config_t> get_game_config_by_id(const std::string& id);
    bool has_multiple_modes(const std::string& game);
    std::optional<std::string> get_mode_argument(const std::string& game, const std::string& mode);
    std::string get_launch_arguments(const std::string& game, const std::string& mode = "");
    std::string get_exe_for_mode(const std::string& game, const std::string& mode);
    bool validate_game_path(const std::string& game, const std::filesystem::path& path);
    // OS-level check: any of the game's executables is running. `game` is the wire id (game_config.id).
    bool is_game_process_running(const std::string& game);
    void reset_all_games();

    // Get the resolved base URL for a game config using the active CDN
    std::string get_resolved_base_url(const game_config_t& config);

    // Read the game's update manifest from local appdata. Throws std::runtime_error if missing/unreadable.
    std::string read_manifest(const game_config_t& config);

    // Returns the union of a game's required_redists with its base_game's list (if any), deduplicated.
    std::vector<std::string> resolve_required_redists(const std::string& game);
}
