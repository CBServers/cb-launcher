#include "std_include.hpp"
#include "game_config.hpp"
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/io.hpp>
#include <utils/nt.hpp>
#include <utils/cdn.hpp>
#include <utils/string.hpp>
#include <unordered_set>

#define CLIENT_UPDATE_SERVER "https://github.com/CBServers/updater/raw/main/updater/"

namespace game_config
{
    // Property access method implementations
    std::string game_config_t::make_property_key(const std::string& suffix) const
    {
        // Check for property-specific override first
        auto override_it = this->property_overrides.find(suffix);
        if (override_it != this->property_overrides.end())
        {
            return override_it->second + "-" + suffix;
        }

        // Otherwise use base_properties_game if set, or game_key
        const std::string& base_key = this->base_properties_game.empty()
            ? this->game_key
            : this->base_properties_game;

        return base_key + "-" + suffix;
    }

    std::optional<std::string> game_config_t::get(const std::string& property_suffix) const
    {
        return utils::properties::load(this->make_property_key(property_suffix));
    }

    void game_config_t::set(const std::string& property_suffix, const std::string& value) const
    {
        utils::properties::store(this->make_property_key(property_suffix), value);
    }

    std::vector<std::string> game_config_t::get_list(const std::string& property_suffix) const
    {
        const auto value = this->get(property_suffix);
        if (!value || value->empty())
        {
            return {};
        }

        // Parse comma-separated list
        std::vector<std::string> result;
        const auto& str = value.value();
        std::string current;

        for (char c : str)
        {
            if (c == ',')
            {
                if (!current.empty())
                {
                    result.push_back(current);
                    current.clear();
                }
            }
            else
            {
                current += c;
            }
        }

        if (!current.empty())
        {
            result.push_back(current);
        }

        return result;
    }

    void game_config_t::set_list(const std::string& property_suffix, const std::vector<std::string>& values) const
    {
        if (values.empty())
        {
            this->set(property_suffix, "");
            return;
        }

        // Join with commas
        std::string joined;
        for (size_t i = 0; i < values.size(); ++i)
        {
            if (i > 0) joined += ",";
            joined += values[i];
        }

        this->set(property_suffix, joined);
    }

    // Helper function to update Plutonium config.json
    void set_plutonium_path(const std::string& key, const std::string& path)
    {
        const auto pluto_folder = utils::properties::get_appdata_folder_path("Plutonium");
        const auto config_path = pluto_folder / "config.json";

        if (!utils::io::directory_exists(pluto_folder))
        {
            utils::io::create_directory(pluto_folder);
        }

        rapidjson::Document doc;
        doc.SetObject();

        // Only build fresh when there's no config; defaulting after a failed read would blank the login token.
        if (utils::io::file_exists(config_path))
        {
            std::string data;
            if (!utils::io::read_file(config_path, &data))
            {
                printf("Plutonium config.json exists but could not be read, leaving it alone\n");
                return;
            }

            rapidjson::Document existing;
            if (existing.Parse(data).HasParseError() || !existing.IsObject())
            {
                printf("Plutonium config.json is malformed, leaving it alone\n");
                return;
            }

            doc = std::move(existing);
        }

        const char* required_fields[] = {"iw5Path", "t4Path", "t5Path", "t6Path", "token"};

        // Runs on every launch, so skip rewriting a file Plutonium may have open when nothing would change.
        if (doc.HasMember(key) && doc[key].IsString() && path == doc[key].GetString())
        {
            const auto missing = std::any_of(std::begin(required_fields), std::end(required_fields),
                [&doc](const char* field) { return !doc.HasMember(field); });
            if (!missing)
            {
                return;
            }
        }

        auto& allocator = doc.GetAllocator();

        // Ensure all required fields exist for valid Plutonium config
        for (const auto& field : required_fields)
        {
            if (!doc.HasMember(field))
            {
                rapidjson::Value field_key;
                field_key.SetString(field, allocator);
                doc.AddMember(field_key, "", allocator);
            }
        }

        // Update the specific path key
        if (doc.HasMember(key))
        {
            doc.RemoveMember(key);
        }

        rapidjson::Value json_key;
        json_key.SetString(key, allocator);

        rapidjson::Value json_value;
        json_value.SetString(path, allocator);

        doc.AddMember(json_key, json_value, allocator);

        // Write back via a temp file so Plutonium can never observe a half-written config.
        rapidjson::StringBuffer buffer;
        rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
        doc.Accept(writer);

        const auto temp_path = config_path.parent_path() / "config.json.tmp";
        if (!utils::io::write_file(temp_path, std::string(buffer.GetString(), buffer.GetLength())))
        {
            printf("Failed to write Plutonium config.json\n");
            return;
        }

        if (!utils::io::move_file_replace(temp_path, config_path))
        {
            printf("Failed to replace Plutonium config.json\n");
            utils::io::remove_file(temp_path);
        }
    }

    // Convenience methods
    std::optional<std::filesystem::path> game_config_t::get_install_path() const
    {
        const auto value = this->get(property_keys::INSTALL);
        if (!value)
        {
            return std::nullopt;
        }

        return utils::string::utf8_to_path(*value);
    }

    void game_config_t::set_install_path(const std::filesystem::path& path) const
    {
        const auto utf8 = utils::string::path_to_utf8(path);
        this->set(property_keys::INSTALL, utf8);

        if (!this->pluto_path_key.empty())
        {
            set_plutonium_path(this->pluto_path_key, utf8);
        }
    }

    bool game_config_t::is_installed() const
    {
        auto value = this->get(property_keys::IS_INSTALLED);
        return value && value.value() == "true";
    }

    void game_config_t::set_installed(bool installed) const
    {
        this->set(property_keys::IS_INSTALLED, installed ? "true" : "false");
    }

    bool game_config_t::is_steam_install() const
    {
        auto value = this->get(property_keys::IS_STEAM_INSTALL);
        return value && value.value() == "true";
    }

    void game_config_t::set_steam_install(bool is_steam) const
    {
        this->set(property_keys::IS_STEAM_INSTALL, is_steam ? "true" : "false");
    }

    std::optional<std::string> game_config_t::get_launch_options() const
    {
        return this->get(property_keys::LAUNCH_OPTIONS);
    }

    bool game_config_t::launch_elevated() const
    {
        const auto value = this->get(property_keys::LAUNCH_ADMIN);
        if (value && !value->empty())
        {
            return *value == "true";
        }
        return this->requires_elevation;
    }

    std::vector<std::string> game_config_t::collect_exes() const
    {
        std::vector<std::string> exes{ this->exe_name };
        for (const auto& [mode, exe] : this->mode_executables)
        {
            exes.push_back(exe);
        }
        for (const auto& exe : this->check_running_exes)
        {
            exes.push_back(exe);
        }
        return exes;
    }

    void game_config_t::reset() const
    {
        // Clear all properties for this game
        this->set(property_keys::INSTALL, "");
        this->set(property_keys::IS_INSTALLED, "");
        this->set(property_keys::IS_STEAM_INSTALL, "");
        this->set_list(property_keys::DETECTED_COMPONENTS, {});
        this->set_list(property_keys::SELECTED_COMPONENTS, {});
        this->set(property_keys::LAUNCH_OPTIONS, "");
        this->set(property_keys::GAME_MODE, "");
        this->set(property_keys::PLAYER_NAME_OVERRIDE, "");
        this->set(property_keys::LAUNCH_ADMIN, "");

        // Game-specific settings — only clear on the games that own them
        if (this->game_key == "bo3")
        {
            this->set(property_keys::SKIP_INTRO_CINEMATIC, "");
        }
        if (this->game_key == "hmw")
        {
            this->set(property_keys::DISABLE_CB_EXTENSION, "");
        }
        if (this->game_key == "cod1" || this->game_key == "coduo" || this->game_key == "cod2x")
        {
            this->set(property_keys::CUSTOM_RESOLUTION_ENABLED, "");
            this->set(property_keys::CUSTOM_RESOLUTION_WIDTH, "");
            this->set(property_keys::CUSTOM_RESOLUTION_HEIGHT, "");
        }
    }

    void game_config_t::ensure_plutonium_path() const
    {
        if (this->pluto_path_key.empty())
        {
            return;
        }

        const auto path = this->get(property_keys::INSTALL);

        if (path && path.value() != "")
        {
            set_plutonium_path(this->pluto_path_key, path.value());
        }
    }

    // Game configurations
    const std::unordered_map<std::string, game_config_t> game_configs_ = {
        {
            "cod1",
            {
                .game_key = "cod1",
                .display_name = "Call of Duty",
                .id = "cod1",
                .exe_name = "CoDMP.exe",
                .update_manifest_url = "",
                .update_folder_url = "",
                .manifest_path = "manifest/cod1.json",
                .required_updater_files = {},
                .valid_game_files = {"CoDSP.exe", "CoDMP.exe"},
                .check_running_exes = {"CoDSP.exe", "CoDMP.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "CoDSP.exe"},
                    {"mp", "CoDMP.exe"}
                },
                .default_args = "+set com_hunkmegs 512 +set r_lodbias -1000",
                .name_argument = "+set name",
                .base_folder = "cod1_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .required_redists = {"vcr2005", "dx_jun2010"}
            },
        },
        {
            "coduo",
            {
                .game_key = "coduo",
                .display_name = "United Offensive",
                .id = "coduo",
                .exe_name = "CoDUOMP.exe",
                .update_manifest_url = "",
                .update_folder_url = "",
                .manifest_path = "manifest/coduo.json",
                .required_updater_files = {},
                .valid_game_files = {"CoDUOSP.exe", "CoDUOMP.exe"},
                .check_running_exes = {"CoDUOSP.exe", "CoDUOMP.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "CoDUOSP.exe"},
                    {"mp", "CoDUOMP.exe"}
                },
                .default_args = "+set com_hunkmegs 512 +set r_lodbias -1000",
                .name_argument = "+set name",
                .base_folder = "coduo_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .required_redists = {"vcr2005", "dx_jun2010"}
            },
        },
        {
            "cod2x",
            {
                .game_key = "cod2x",
                .display_name = "Call of Duty 2",
                .id = "cod2x",
                .exe_name = "CoD2MP_s.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "cod2x.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "cod2x/",
                .manifest_path = "manifest/cod2.json",
                .required_updater_files = {},
                .valid_game_files = {"CoD2SP_s.exe", "CoD2MP_s.exe"},
                .check_running_exes = {"CoD2SP_s.exe", "CoD2MP_s.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "CoD2SP_s.exe"},
                    {"mp", "CoD2MP_s.exe"}
                },
                .name_argument = "+set name",
                .base_folder = "cod2_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .required_redists = {"vcr2005", "dx_jun2010"},
                .requires_elevation = true
            },
        },
        {
            "cod4x",
            {
                .game_key = "cod4x",
                .display_name = "Modern Warfare",
                .id = "cod4x",
                .exe_name = "iw3mp.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "cod4x.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "cod4x/",
                .manifest_path = "manifest/cod4.json",
                .required_updater_files = {},
                .valid_game_files = {"binkw32.dll", "iw3mp.exe", "iw3sp.exe"},
                .check_running_exes = {"iw3sp_mod.exe", "iw3mp.exe", "iw3sp.exe"},
                .mode_arguments = {
                    {"sp", "+set iw3sp_auto_update 0"},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "iw3sp_mod.exe"},
                    {"mp", "iw3mp.exe"}
                },
                .name_argument = "+set name",
                .base_folder = "cod4_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_default_path = utils::properties::get_appdata_folder_path("CallofDuty4MW"),
                .client_install_path_files = {"miles32.dll", "mss32.dll", "iw3mp.exe", "iw3sp_mod.exe", "game.dll", "iw3sp_data/*"},
                .client_data_folders = {"bin", "main", "zone", "iw3sp_data/assets", "iw3sp_data/miles", "iw3sp_data/zone"},
                .required_redists = {"vcr2005", "vcr2008", "dx_jun2010"}
            }
        },
        {
            "t4",
            {
                .game_key = "t4",
                .display_name = "World at War",
                .id = "t4",
                .exe_name = "plutonium.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "alt-launchers.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "alt-launchers/",
                .manifest_path = "manifest/waw.json",
                .required_updater_files = {"plutonium.exe"},
                .valid_game_files = {"binkw32.dll", "CoDWaW.exe", "CoDWaWmp.exe"},
                .check_running_exes = {"plutonium-launcher-win32.exe", "plutonium-bootstrapper-win32.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""},
                    {"zm", ""}
                },
                // WaW zombies lives in the sp client, so sp and zm share a target.
                .plutonium_game_names = {
                    {"sp", "t4sp"},
                    {"mp", "t4mp"},
                    {"zm", "t4sp"}
                },
                .name_argument = "",
                .pluto_path_key = "t4Path",
                .base_folder = "waw_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {},
                .required_redists = {"vcr2005", "vcr2008", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "t5",
            {
                .game_key = "t5",
                .display_name = "Black Ops",
                .id = "t5",
                .exe_name = "plutonium.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "alt-launchers.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "alt-launchers/",
                .manifest_path = "manifest/bo1.json",
                .required_updater_files = {"plutonium.exe"},
                .valid_game_files = {"binkw32.dll", "BlackOps.exe", "BlackOpsMP.exe"},
                .check_running_exes = {"plutonium-launcher-win32.exe", "plutonium-bootstrapper-win32.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""},
                    {"zm", ""}
                },
                // BO1 zombies lives in the sp client, so sp and zm share a target.
                .plutonium_game_names = {
                    {"sp", "t5sp"},
                    {"mp", "t5mp"},
                    {"zm", "t5sp"}
                },
                .name_argument = "",
                .pluto_path_key = "t5Path",
                .base_folder = "bo1_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "iw4x",
            {
                .game_key = "iw4x",
                .display_name = "Modern Warfare 2",
                .id = "iw4x",
                .exe_name = "iw4x.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "iw4x.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "iw4x/",
                .manifest_path = "manifest/mw2.json",
                .required_updater_files = {},
                .valid_game_files = {"binkw32.dll", "iw4mp.exe", "iw4sp.exe"},
                .check_running_exes = {"alterware-launcher.exe", "iw4x.exe", "iw4x-sp.exe"},
                .mode_arguments = {
                    {"sp", "iw4x-sp --skip-launcher-update"},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "alterware-launcher.exe"},
                    {"mp", "iw4x.exe"}
                },
                .mode_pass_arguments = {
                    {"sp", ""}
                },
                .name_argument = "+set name",
                .base_folder = "mw2_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {"zone/patch", "zone/zonebuilder"},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "t6",
            {
                .game_key = "t6",
                .display_name = "Black Ops 2",
                .id = "t6",
                .exe_name = "plutonium.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "t6.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "t6/",
                .manifest_path = "manifest/bo2.json",
                .required_updater_files = {},
                .valid_game_files = {"binkw32.dll", "t6mp.exe", "t6zm.exe", "t6sp.exe"},
                .check_running_exes = {"plutonium-launcher-win32.exe", "plutonium-bootstrapper-win32.exe", "T6SP-Mod.exe"},
                .mode_arguments = {
                    {"sp", ""},
                    {"mp", ""},
                    {"zm", ""}
                },
                .mode_executables = {
                    {"sp", "T6SP-Mod.exe"},
                    {"mp", "plutonium.exe"},
                    {"zm", "plutonium.exe"}
                },
                // sp is omitted deliberately: it runs T6SP-Mod.exe, not Plutonium.
                .plutonium_game_names = {
                    {"mp", "t6mp"},
                    {"zm", "t6zm"}
                },
                .name_argument = "",
                .pluto_path_key = "t6Path",
                .base_folder = "bo2_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {},
                .required_redists = {"vcr2010", "vcr2012", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "iw5",
            {
                .game_key = "iw5",
                .display_name = "Modern Warfare 3",
                .id = "iw5",
                .exe_name = "plutonium.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "alt-launchers.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "alt-launchers/",
                .manifest_path = "manifest/mw3.json",
                .required_updater_files = {"plutonium.exe", "alterware-launcher.exe"},
                .valid_game_files = {"binkw32.dll", "iw5mp.exe", "iw5sp.exe"},
                .check_running_exes = {"plutonium-launcher-win32.exe", "plutonium-bootstrapper-win32.exe", "alterware-launcher.exe", "iw5-mod.exe"},
                .mode_arguments = {
                    {"sp", "iw5-mod --skip-launcher-update"},
                    {"mp", ""}
                },
                .mode_executables = {
                    {"sp", "alterware-launcher.exe"},
                    {"mp", "plutonium.exe"}
                },
                .mode_pass_arguments = {
                    {"sp", "-singleplayer"}
                },
                // sp is omitted deliberately: it runs through the AlterWare launcher. Plutonium has no iw5sp.
                .plutonium_game_names = {
                    {"mp", "iw5mp"}
                },
                .name_argument = "+set name",
                .pluto_path_key = "iw5Path",
                .base_folder = "mw3_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "bo3",
            {
                .game_key = "bo3",
                .display_name = "Black Ops 3",
                .id = "boiii",
                .exe_name = "boiii.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "boiii.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "boiii/",
                .manifest_path = "manifest/bo3.json",
                .required_updater_files = {},
                .valid_game_files = {"BlackOps3.exe"},
                .mode_arguments = {},
                .default_args = "-launch -noupdate",
                .name_argument = "-name",
                .base_folder = "bo3_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_default_path = utils::properties::get_appdata_folder_path("boiii"),
                .client_install_path_files = {"boiii.exe", "BlackOps3.exe"},
                .client_data_folders = {"data"},
                .required_redists = {"vcr2012", "vcr2013", "vcr2022", "dx_jun2010"}
            }
        },
        {
            "ghosts",
            {
                .game_key = "ghosts",
                .display_name = "Ghosts",
                .id = "iw6x",
                .exe_name = "iw6x.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "iw6x.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "iw6x/",
                .manifest_path = "manifest/ghosts.json",
                .required_updater_files = {},
                .valid_game_files = {"iw6mp64_ship.exe", "iw6mp64_ship.exe"},
                .mode_arguments = {
                    {"sp", "-singleplayer"},
                    {"mp", "-multiplayer"}
                },
                .default_args = "-noupdate",
                .name_argument = "+set name",
                .base_folder = "ghosts_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {"data"},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"},
                .supports_steam_install = true
            }
        },
        {
            "aw",
            {
                .game_key = "aw",
                .display_name = "Advanced Warfare",
                .id = "s1x",
                .exe_name = "s1x.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "s1x.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "s1x/",
                .manifest_path = "manifest/aw.json",
                .required_updater_files = {},
                .valid_game_files = {"s1_sp64_ship.exe", "s1_mp64_ship.exe"},
                .mode_arguments = {
                    {"sp", "-singleplayer"},
                    {"mp", "-multiplayer"},
                    {"zm", "-zombies"},
                    {"sv", "-survival"}
                },
                .default_args = "-noupdate",
                .name_argument = "+set name",
                .base_folder = "aw_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {"data"},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"},
                .supports_steam_install = true
            }
        },
        {
            "mwr",
            {
                .game_key = "mwr",
                .display_name = "Modern Warfare Remastered",
                .id = "h1-mod",
                .exe_name = "h1-mod.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "h1-mod/files.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "h1-mod/data/",
                .manifest_path = "manifest/mwr.json",
                .required_updater_files = {},
                .valid_game_files = {"h1_sp64_ship.exe", "h1_mp64_ship.exe"},
                .mode_arguments = {
                    {"sp", "-singleplayer"},
                    {"mp", "-multiplayer"}
                },
                .default_args = "-noupdate",
                .name_argument = "+set name",
                .base_folder = "mwr_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_default_path = utils::properties::get_appdata_folder_path("h1-mod"),
                .client_install_path_files = {"h1-mod.exe"},
                .client_data_folders = {"cdata"},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"},
                .supports_steam_install = true
            }
        },
        {
            "iw",
            {
                .game_key = "iw",
                .display_name = "Infinite Warfare",
                .id = "iw7-mod",
                .exe_name = "iw7-mod.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "iw7-mod/files.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "iw7-mod/data/",
                .manifest_path = "manifest/iw.json",
                .required_updater_files = {},
                .valid_game_files = {"iw7_ship.exe"},
                .mode_arguments = {},
                .default_args = "-noupdate",
                .name_argument = "+set name",
                .base_folder = "iw_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_default_path = utils::properties::get_appdata_folder_path("auroramod/iw7-mod"),
                .client_install_path_files = {"iw7-mod.exe"},
                .client_data_folders = {"cdata"},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"},
                .supports_steam_install = true
            }
        },
        {
            "mw2r",
            {
                .game_key = "mw2r",
                .display_name = "Modern Warfare 2 Campaign Remastered",
                .id = "mw2r",
                .exe_name = "h2-mod.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "h2-mod.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "h2-mod/",
                .manifest_path = "manifest/mw2r.json",
                .required_updater_files = {},
                .valid_game_files = {"MW2CR.exe", "MW2 Campaign Remastered Launcher.exe"},
                .default_args = "-singleplayer +set cg_auto_update 0",
                .name_argument = "",
                .base_folder = "mw2r_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_default_path = utils::properties::get_appdata_folder_path("h2-mod"),
                .client_install_path_files = {"h2-mod.exe"},
                .client_data_folders = {"cdata"},
                .required_redists = {"vcr2022", "dx_jun2010"}
            }
        },
        {
            "bo4",
            {
                .game_key = "bo4",
                .display_name = "Black Ops 4",
                .id = "bo4",
                .exe_name = "Launch Project BO4.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "project-bo4.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "project-bo4/",
                .manifest_path = "manifest/bo4.json",
                .required_updater_files = {},
                .valid_game_files = {"BlackOps4.exe", "BlackOps4_boot.exe", "Black Ops 4 Launcher.exe"},
                .check_running_exes = {"BlackOps4.exe"},
                .mode_arguments = {
                    {"on", "-online"},
                    {"off", "-offline"}
                },
                .name_argument = "-name",
                .base_folder = "bo4_game_files",
                .base_properties_game = "",
                .property_overrides = {},
                .client_data_folders = {"project-bo4/launcher"},
                .required_redists = {"vcr2022", "dx_jun2010"}
            }
        },
        {
            "hmw",
            {
                .game_key = "hmw",
                .display_name = "HorizonMW",
                .id = "hmw-mod",
                .exe_name = "hmw-mod.exe",
                .update_manifest_url = CLIENT_UPDATE_SERVER "h2m.json",
                .update_folder_url = CLIENT_UPDATE_SERVER "h2m/",
                .manifest_path = "manifest/hmw.json",
                .required_updater_files = {"d3d11.dll"},
                .valid_game_files = {"h1_mp64_ship.exe"},
                .mode_arguments = {},
                .name_argument = "+set name",
                .base_folder = "h2m",
                .base_game = "mwr",
                .check_for_game_updates = true,
                .base_properties_game = "mwr",
                .property_overrides = {
                    {property_keys::IS_INSTALLED, "hmw"},
                    {property_keys::DETECTED_COMPONENTS, "hmw"},
                    {property_keys::SELECTED_COMPONENTS, "hmw"},
                    {property_keys::LAUNCH_OPTIONS, "hmw"},
                    {property_keys::DISABLE_CB_EXTENSION, "hmw"}
                },
                .client_data_folders = {},
                .required_redists = {"vcr2010", "vcr2022", "dx_jun2010"},
                .supports_steam_install = true
            }
        }
    };

    const std::unordered_map<std::string, std::string> ui_to_backend_mapping_ = {
        {"cod1", "cod1"},
        {"coduo", "coduo"},
        {"cod2x", "cod2x"},
        {"cod4x", "cod4x"},
        {"t4", "t4"},
        {"t5", "t5"},
        {"iw4x", "iw4x"},
        {"iw5", "iw5"},
        {"t6", "t6"},
        {"boiii", "bo3"},
        {"iw6x", "ghosts"},
        {"s1x", "aw"},
        {"h1-mod", "mwr"},
        {"iw7-mod", "iw"},
        {"bo4", "bo4"},
        {"mw2r", "mw2r"},
        {"hmw-mod", "hmw"}
    };

    std::optional<game_config_t> get_game_config(const std::string& game)
    {
        const auto it = game_configs_.find(game);
        if (it != game_configs_.end())
        {
            return it->second;
        }
        return std::nullopt;
    }

    // Lookup by wire id (game_config.id, e.g. "boiii"), as used by the IPC protocol / join secrets.
    std::optional<game_config_t> get_game_config_by_id(const std::string& id)
    {
        for (const auto& [game_key, config] : game_configs_)
        {
            if (config.id == id)
            {
                return config;
            }
        }
        return std::nullopt;
    }

    bool has_multiple_modes(const std::string& game)
    {
        const auto config = get_game_config(game);
        const auto has_mode_args = config ? config->mode_arguments.size() > 0 : false;
        const auto has_mode_exes = config ? config->mode_executables.size() > 0 : false;
        return has_mode_args || has_mode_exes;
    }

    std::optional<std::string> get_mode_argument(const std::string& game, const std::string& mode)
    {
        const auto config = get_game_config(game);
        if (!config)
        {
            return std::nullopt;
        }

        const auto it = config->mode_arguments.find(mode);
        if (it != config->mode_arguments.end())
        {
            return it->second;
        }

        return std::nullopt;
    }

    std::string get_launch_arguments(const std::string& game, const std::string& mode)
    {
        const auto config = get_game_config(game);
        if (!config)
        {
            return "";
        }

        std::string args = config->default_args;

        // Append mode-specific arguments if applicable
        if (config->mode_arguments.size() > 0)
        {
            if (mode.empty())
            {
                return ""; // Mode required but not provided
            }

            const auto mode_arg = get_mode_argument(game, mode);
            if (mode_arg.has_value() && !mode_arg->empty())
            {
                if (!args.empty()) args += " ";
                args += mode_arg.value();
            }
        }

        // BO3-specific: append -nointro if user has enabled skip intro cinematic
        if (game == "bo3")
        {
            const auto cinematic_setting = utils::properties::load(property_keys::BO3_SKIP_INTRO_CINEMATIC);
            if (cinematic_setting && cinematic_setting->data() == std::string("true"))
            {
                if (!args.empty()) args += " ";
                args += "-nointro";
            }
        }

        return args;
    }

    std::string get_exe_for_mode(const std::string& game, const std::string& mode)
    {
        const auto config = get_game_config(game);
        if (!config)
        {
            return "";
        }

        // Check mode-specific executable first
        if (!mode.empty())
        {
            const auto it = config->mode_executables.find(mode);
            if (it != config->mode_executables.end())
            {
                return it->second;
            }
        }

        // Fall back to default exe_name
        return config->exe_name;
    }

    bool validate_game_path(const std::string& game, const std::filesystem::path& path)
    {
        const auto config = get_game_config(game);
        if (!config)
        {
            return false;
        }

        // Check if any of the valid game executables exist
        for (const auto& exe : config->valid_game_files)
        {
            const auto exe_path = path / exe;
            if (utils::io::file_exists(exe_path))
            {
                return true;
            }
        }

        return false;
    }

    bool is_game_process_running(const std::string& game)
    {
        const auto config = get_game_config_by_id(game);
        if (!config)
        {
            return false;
        }

        for (const auto& exe : config->collect_exes())
        {
            if (!exe.empty() && utils::nt::is_process_running(exe))
            {
                return true;
            }
        }
        return false;
    }

    void reset_all_games()
    {
        // Reset properties for all games
        for (const auto& [game_key, config] : game_configs_)
        {
            config.reset();
        }
    }

    std::string get_resolved_base_url(const game_config_t& config)
    {
        const auto active_cdn = utils::cdn::cdn_manager::instance().get_active_cdn_url();
        return active_cdn + config.base_folder;
    }

    std::string read_manifest(const game_config_t& config)
    {
        if (config.manifest_path.empty())
        {
            throw std::runtime_error("No manifest_path configured for " + config.display_name);
        }

        const auto full_path = utils::properties::get_appdata_path() / config.manifest_path;

        if (!utils::io::file_exists(full_path))
        {
            throw std::runtime_error("Failed to read manifest for " + config.display_name +
                ": file not found at " + full_path.string());
        }

        std::string data;
        if (!utils::io::read_file(full_path, &data))
        {
            throw std::runtime_error("Failed to read manifest for " + config.display_name +
                ": unable to read " + full_path.string());
        }

        return data;
    }

    std::vector<std::string> resolve_required_redists(const std::string& game)
    {
        const auto config = get_game_config(game);
        if (!config) return {};

        std::vector<std::string> result;
        std::unordered_set<std::string> seen;

        const auto add_all = [&](const std::vector<std::string>& ids)
        {
            for (const auto& id : ids)
            {
                if (seen.insert(id).second) result.push_back(id);
            }
        };

        if (!config->base_game.empty())
        {
            if (const auto base = get_game_config(config->base_game))
            {
                add_all(base->required_redists);
            }
        }
        add_all(config->required_redists);

        return result;
    }
}
