#pragma once

#include <updater/file_dest.hpp>

#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <optional>
#include <filesystem>

namespace game_config
{
    // A client_data_folders entry. Constructs implicitly from a bare string, which keeps
    // dest = automatic (today's client_install_path_files heuristic).
    struct data_folder_t
    {
        data_folder_t(std::string folder_, updater::file_dest dest_ = updater::file_dest::automatic)
            : folder(std::move(folder_)), dest(dest_)
        {
        }

        data_folder_t(const char* folder_)
            : folder(folder_)
        {
        }

        std::string folder;
        updater::file_dest dest = updater::file_dest::automatic;
    };

    // One updatable client of a game. A game can declare several (CoD4: CoD4x, IW3SP-Mod,
    // IW3x); they share the game's install path but update independently. The install path
    // itself stays on game_config_t, since it is the game's, not the client's.
    struct client_files_t
    {
        std::string client_id;
        std::string update_manifest_url;
        std::string update_folder_url;
        // Modes this client serves ("sp", "mp", ...). Empty = every mode of the game.
        std::vector<std::string> modes;
        // The `appdata` root: client's appdata dir. Empty = same as the game's install path.
        std::filesystem::path client_default_path;
        // Files that always go to install_path even when client_default_path is set.
        // Superseded per-file by an explicit `dest` in the manifest.
        std::unordered_set<std::string> client_install_path_files;
        // Relative folder path(s) under the client data root that bound client-file deletions.
        std::vector<data_folder_t> client_data_folders;
        std::vector<std::string> required_updater_files;
    };

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
        // Mode -> manifest component the mode needs; no entry means "base"
        std::unordered_map<std::string, std::string> mode_components;
        std::unordered_map<std::string, std::string> mode_executables;  // mode -> exe name
        std::unordered_map<std::string, std::string> mode_pass_arguments; // Per-mode args forwarded inside --pass "..." (e.g. AlterWare launcher).
        // Mode -> Plutonium URI name (e.g. "mp" -> "t6mp"); an entry launches via plutonium://, no entry uses the normal exe path.
        std::unordered_map<std::string, std::string> plutonium_game_names;
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

        // Single-client authoring surface. get_game_config() synthesizes a one-element
        // `clients` from these when `clients` is left empty; a game that declares `clients`
        // explicitly owns these values there instead, and the fields below are unused.
        // Default directory for client files. Empty = use install_path (current behavior).
        std::filesystem::path client_default_path;
        // Files that always go to install_path even when client_default_path is set
        std::unordered_set<std::string> client_install_path_files;
        // Relative folder path(s) under the client data root that bound client-file deletions.
        std::vector<data_folder_t> client_data_folders;

        // Every client of this game. Populated by get_game_config(); never read from the
        // static table directly.
        std::vector<client_files_t> clients;

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

    // Clients serving `mode`, in declared order. A client with no modes serves every mode.
    std::vector<const client_files_t*> clients_for_mode(const game_config_t& config, const std::string& mode);
    // Persisted selection if valid, else first declared client serving the mode; null if none.
    const client_files_t* select_client_for_mode(const game_config_t& config, const std::string& mode);
    // True once any mode has more than one client; such games route through the private store.
    bool is_store_routed(const game_config_t& config);
    // One-shot at startup: existing CoD4 installs keep CoD4x for MP; fresh setups get the default.
    void seed_legacy_client_selections();

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
    // max_age_ms lets a polling caller reuse a recent process snapshot; 0 always takes a fresh one,
    // which is what anything acting on the answer (such as the join flow) must use.
    bool is_game_process_running(const std::string& game, unsigned int max_age_ms = 0);
    void reset_all_games();

    // Get the resolved base URL for a game config using the active CDN
    std::string get_resolved_base_url(const game_config_t& config);

    // Read the game's update manifest from local appdata. Throws std::runtime_error if missing/unreadable.
    std::string read_manifest(const game_config_t& config);

    // Returns the union of a game's required_redists with its base_game's list (if any), deduplicated.
    std::vector<std::string> resolve_required_redists(const std::string& game);
}
