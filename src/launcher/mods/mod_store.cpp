#include "std_include.hpp"
#include "mod_store.hpp"
#include "steamcmd.hpp"
#include "updater/client_store.hpp"

#include <utils/finally.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

#include <chrono>
#include <ctime>
#include <random>
#include <miniz.h>

namespace mods
{
    namespace
    {
        constexpr auto FOLDER_USERMAPS = "usermaps";
        constexpr auto FOLDER_MODS = "mods";
        constexpr auto FOLDER_STEAM = "steam-workshop";
        constexpr auto SOURCE_STEAM = "steam";
        constexpr auto KIND_MAP = "map";
        constexpr auto KIND_MOD = "mod";

        struct game_layout
        {
            bool plutonium;
            std::vector<std::string> folders;
            uint32_t steam_appid;
        };

        const std::unordered_map<std::string, game_layout> layouts_ = {
            {"bo3", {false, {FOLDER_USERMAPS, FOLDER_MODS}, 311210}},
            {"t4",  {true,  {FOLDER_MODS, FOLDER_USERMAPS}, 0}},
            {"t5",  {true,  {FOLDER_MODS}, 0}},
            {"t6",  {true,  {FOLDER_MODS, FOLDER_USERMAPS}, 0}},
        };

        const game_layout* layout_for(const game_config::game_config_t& config)
        {
            const auto it = layouts_.find(config.game_key);
            return it == layouts_.end() ? nullptr : &it->second;
        }

        bool has_folder(const game_layout& layout, const std::string& folder)
        {
            return std::find(layout.folders.begin(), layout.folders.end(), folder) != layout.folders.end();
        }

        std::filesystem::path index_path(const game_config::game_config_t& config)
        {
            return utils::properties::get_appdata_path() / "mods" / (config.game_key + ".json");
        }

        std::filesystem::path staging_root()
        {
            return utils::properties::get_appdata_path() / "mods" / "staging";
        }

        std::string format_iso8601(const std::time_t value)
        {
            std::tm utc{};
            gmtime_s(&utc, &value);
            char buffer[32]{};
            std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
            return buffer;
        }

        std::string now_iso8601()
        {
            return format_iso8601(std::time(nullptr));
        }

        std::string iso8601_from(const std::filesystem::file_time_type& time)
        {
            if (time == std::filesystem::file_time_type{})
            {
                return {};
            }

            const auto system = std::chrono::clock_cast<std::chrono::system_clock>(time);
            return format_iso8601(std::chrono::system_clock::to_time_t(system));
        }

        std::string make_id(const std::string& folder, const std::string& dirname)
        {
            return folder + ":" + dirname;
        }

        // Directory names become part of a path and of the mod id, so only allow plain names.
        bool is_safe_dirname(const std::string& name)
        {
            if (name.empty() || name == "." || name == ".." || name.size() > 128)
            {
                return false;
            }

            return std::all_of(name.begin(), name.end(), [](const unsigned char c)
            {
                return std::isalnum(c) || c == '_' || c == '-' || c == '.' || c == ' ';
            });
        }

        std::vector<installed_mod> read_index(const game_config::game_config_t& config)
        {
            std::string data{};
            if (!utils::io::read_file(index_path(config), &data) || data.empty())
            {
                return {};
            }

            rapidjson::Document doc{};
            doc.Parse(data.data(), data.size());
            if (doc.HasParseError() || !doc.IsArray())
            {
                return {};
            }

            std::vector<installed_mod> mods{};
            for (const auto& element : doc.GetArray())
            {
                installed_mod mod{};
                mod.id = json_string(element, "id");
                mod.name = json_string(element, "name");
                mod.kind = json_string(element, "kind");
                mod.folder = json_string(element, "folder");
                mod.source = json_string(element, "source");
                mod.version = json_string(element, "version");
                mod.workshop_id = json_string(element, "workshopId");
                mod.installed_at = json_string(element, "installedAt");

                if (!mod.id.empty())
                {
                    mods.push_back(std::move(mod));
                }
            }

            return mods;
        }

        bool write_index(const game_config::game_config_t& config, const std::vector<installed_mod>& mods)
        {
            rapidjson::Document doc{rapidjson::kArrayType};
            auto& allocator = doc.GetAllocator();
            for (const auto& mod : mods)
            {
                doc.PushBack(to_json(mod, allocator), allocator);
            }

            rapidjson::StringBuffer buffer{};
            rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(buffer);
            doc.Accept(writer);

            const auto path = index_path(config);
            const auto temp = path.string() + ".tmp";
            if (!utils::io::write_file(temp, std::string{buffer.GetString(), buffer.GetSize()}))
            {
                return false;
            }

            if (!utils::io::move_file_replace(temp, path))
            {
                utils::io::remove_file(temp);
                return false;
            }

            return true;
        }

        void upsert_index(const game_config::game_config_t& config, const installed_mod& mod)
        {
            auto mods = read_index(config);
            std::erase_if(mods, [&mod](const installed_mod& entry) { return entry.id == mod.id; });
            mods.push_back(mod);
            write_index(config, mods);
        }

        void erase_index(const game_config::game_config_t& config, const std::string& id)
        {
            auto mods = read_index(config);
            const auto before = mods.size();
            std::erase_if(mods, [&id](const installed_mod& entry) { return entry.id == id; });
            if (mods.size() != before)
            {
                write_index(config, mods);
            }
        }

        struct directory_stats
        {
            uint64_t size{};
            std::filesystem::file_time_type newest{};
        };

        directory_stats scan_directory(const std::filesystem::path& directory)
        {
            directory_stats stats{};
            std::error_code code{};
            for (std::filesystem::recursive_directory_iterator it(directory, code), end; !code && it != end; it.increment(code))
            {
                if (!it->is_regular_file(code))
                {
                    continue;
                }

                stats.size += it->file_size(code);

                std::error_code time_code{};
                if (const auto written = it->last_write_time(time_code); !time_code && written > stats.newest)
                {
                    stats.newest = written;
                }
            }

            return stats;
        }

        uint64_t directory_size(const std::filesystem::path& directory)
        {
            return scan_directory(directory).size;
        }

        std::vector<std::filesystem::path> subdirectories(const std::filesystem::path& directory)
        {
            std::vector<std::filesystem::path> result{};
            if (!utils::io::directory_exists(directory))
            {
                return result;
            }

            for (const auto& entry : utils::io::list_files(directory))
            {
                if (utils::io::directory_exists(entry))
                {
                    result.push_back(entry);
                }
            }

            return result;
        }

        // Steam keeps subscribed items outside the game folder, in a sibling of
        // steamapps/common: <library>/steamapps/workshop/content/<appid>.
        std::optional<std::filesystem::path> steam_workshop_root(const game_layout& layout, const game_config::game_config_t& config)
        {
            const auto install = config.get_install_path();
            if (!layout.steam_appid || !install || install->empty())
            {
                return std::nullopt;
            }

            for (auto directory = install->lexically_normal();;)
            {
                if (utils::string::to_lower(utils::string::path_to_utf8(directory.filename())) == "steamapps")
                {
                    const auto root = directory / "workshop" / "content" / std::to_string(layout.steam_appid);
                    return utils::io::directory_exists(root) ? std::optional{root} : std::nullopt;
                }

                auto parent = directory.parent_path();
                if (parent.empty() || parent == directory)
                {
                    return std::nullopt;
                }

                directory = std::move(parent);
            }
        }

        struct workshop_info
        {
            std::string title;
            std::string type;
            std::string publisher_id;
            std::string folder_name;
        };

        std::optional<workshop_info> read_workshop_json(const std::filesystem::path& directory);

        void apply_workshop_info(installed_mod& mod, const std::filesystem::path& directory)
        {
            if (const auto info = read_workshop_json(directory); info && !info->title.empty())
            {
                mod.name = info->title;
                mod.workshop_id = info->publisher_id;
            }
        }

        // Workshop items are staged either flat or with everything under zone/.
        bool read_workshop_json_file(const std::filesystem::path& directory, std::string& data)
        {
            return (utils::io::read_file(directory / "workshop.json", &data) && !data.empty()) ||
                   (utils::io::read_file(directory / "zone" / "workshop.json", &data) && !data.empty());
        }

        std::optional<workshop_info> read_workshop_json(const std::filesystem::path& directory)
        {
            std::string data{};
            if (!read_workshop_json_file(directory, data))
            {
                return std::nullopt;
            }

            rapidjson::Document doc{};
            doc.Parse(data.data(), data.size());
            if (doc.HasParseError() || !doc.IsObject())
            {
                return std::nullopt;
            }

            return workshop_info{
                json_string(doc, "Title"),
                utils::string::to_lower(json_string(doc, "Type")),
                json_string(doc, "PublisherID"),
                json_string(doc, "FolderName"),
            };
        }

        bool has_file_with_suffix(const std::filesystem::path& directory, const std::string& suffix)
        {
            for (const auto& entry : utils::io::list_files(directory))
            {
                if (utils::string::ends_with(utils::string::to_lower(utils::string::path_to_utf8(entry.filename())), suffix))
                {
                    return true;
                }
            }

            return false;
        }

        // Fastfiles sit either at the root or under zone/, depending on how the item was packed.
        std::vector<std::filesystem::path> content_directories(const std::filesystem::path& directory)
        {
            std::vector<std::filesystem::path> result{directory};
            if (utils::io::directory_exists(directory / "zone"))
            {
                result.push_back(directory / "zone");
            }

            return result;
        }

        std::string detect_kind(const game_layout& layout, const std::filesystem::path& directory)
        {
            if (!layout.plutonium)
            {
                const auto info = read_workshop_json(directory);
                if (info && (info->type == KIND_MAP || info->type == KIND_MOD))
                {
                    return info->type;
                }

                return {};
            }

            const auto contents = content_directories(directory);
            for (const auto& content : contents)
            {
                if (utils::io::file_exists(content / "mod.ff"))
                {
                    return KIND_MOD;
                }
            }

            const auto dirname = utils::string::to_lower(utils::string::path_to_utf8(directory.filename()));
            for (const auto& content : contents)
            {
                if (utils::io::file_exists(content / (dirname + ".ff")) || has_file_with_suffix(content, "_load.ff"))
                {
                    return KIND_MAP;
                }
            }

            return {};
        }

        // An item is renamed to its workshop FolderName on install, so a copy that was
        // installed under a different name (its numeric id, say) would linger on disk and
        // keep claiming the same update.
        void remove_stale_copies(const game_config::game_config_t& config, const game_layout& layout,
            const std::filesystem::path& root, const std::string& workshop_id,
            const std::string& keep_folder, const std::string& keep_dirname)
        {
            if (workshop_id.empty())
            {
                return;
            }

            const auto keep = utils::string::to_lower(keep_dirname);
            for (const auto& folder : layout.folders)
            {
                for (const auto& directory : subdirectories(root / folder))
                {
                    const auto dirname = utils::string::path_to_utf8(directory.filename());
                    if (folder == keep_folder && utils::string::to_lower(dirname) == keep)
                    {
                        continue;
                    }

                    const auto info = read_workshop_json(directory);
                    if (!info || info->publisher_id != workshop_id)
                    {
                        continue;
                    }

                    std::error_code code{};
                    std::filesystem::remove_all(directory, code);
                    if (code)
                    {
                        utils::logger::write("[cbl-mods] failed to remove stale copy {}: {}", utils::string::path_to_utf8(directory), code.message());
                        continue;
                    }

                    erase_index(config, make_id(folder, dirname));
                    utils::logger::write("[cbl-mods] removed stale copy {} of workshop item {}", utils::string::path_to_utf8(directory), workshop_id);
                }
            }
        }

        import_result fail(std::string error)
        {
            return {false, std::move(error), std::nullopt};
        }

        bool is_safe_archive_entry(const std::string& name)
        {
            if (name.empty() || name.front() == '/' || name.front() == '\\' || name.find(':') != std::string::npos)
            {
                return false;
            }

            for (const auto& part : utils::string::split(utils::string::replace(name, "\\", "/"), '/'))
            {
                if (part == "..")
                {
                    return false;
                }
            }

            return true;
        }

        std::string extract_archive_impl(const std::filesystem::path& archive, const std::filesystem::path& into)
        {
            FILE* file = nullptr;
            if (_wfopen_s(&file, archive.c_str(), L"rb") != 0 || !file)
            {
                return "The selected file could not be opened.";
            }

            const auto close_file = utils::finally([file] { fclose(file); });

            mz_zip_archive zip{};
            if (!mz_zip_reader_init_cfile(&zip, file, utils::io::file_size(archive), 0))
            {
                return "The file is not a valid zip archive.";
            }

            const auto close_zip = utils::finally([&zip] { mz_zip_reader_end(&zip); });

            const auto count = mz_zip_reader_get_num_files(&zip);
            for (mz_uint i = 0; i < count; ++i)
            {
                mz_zip_archive_file_stat stat{};
                if (!mz_zip_reader_file_stat(&zip, i, &stat))
                {
                    return "Failed to read the zip archive.";
                }

                const std::string name = stat.m_filename;
                if (!is_safe_archive_entry(name))
                {
                    return "The zip archive contains an unsafe path: " + name;
                }

                const auto target = (into / utils::string::utf8_to_path(name)).lexically_normal();
                if (!client_store::is_inside_folder(target, into))
                {
                    return "The zip archive contains an unsafe path: " + name;
                }

                if (mz_zip_reader_is_file_a_directory(&zip, i))
                {
                    utils::io::create_directory(target);
                    continue;
                }

                utils::io::create_directory(target.parent_path());
                FILE* out = nullptr;
                if (_wfopen_s(&out, target.c_str(), L"wb") != 0 || !out)
                {
                    return "Failed to write " + name;
                }

                const auto extracted = mz_zip_reader_extract_to_cfile(&zip, i, out, 0);
                fclose(out);
                if (!extracted)
                {
                    return "Failed to extract " + name;
                }
            }

            return {};
        }

        std::filesystem::path make_staging_dir()
        {
            std::random_device device{};
            return staging_root() / std::format("{:08x}", device());
        }
    }

    std::string json_string(const rapidjson::Value& object, const char* key)
    {
        if (!object.IsObject() || !object.HasMember(key) || !object[key].IsString())
        {
            return {};
        }

        return {object[key].GetString(), object[key].GetStringLength()};
    }

    rapidjson::Value to_json(const installed_mod& mod, rapidjson::Document::AllocatorType& allocator)
    {
        const auto str = [&allocator](const std::string& value)
        {
            rapidjson::Value v{};
            v.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
            return v;
        };

        rapidjson::Value entry(rapidjson::kObjectType);
        entry.AddMember("id", str(mod.id), allocator);
        entry.AddMember("name", str(mod.name), allocator);
        entry.AddMember("kind", str(mod.kind), allocator);
        entry.AddMember("folder", str(mod.folder), allocator);
        entry.AddMember("source", str(mod.source), allocator);
        entry.AddMember("version", str(mod.version), allocator);
        entry.AddMember("workshopId", str(mod.workshop_id), allocator);
        entry.AddMember("installedAt", str(mod.installed_at), allocator);
        entry.AddMember("size", mod.size, allocator);
        return entry;
    }

    bool supports(const game_config::game_config_t& config)
    {
        return layout_for(config) != nullptr;
    }

    std::string extract_zip(const std::filesystem::path& archive, const std::filesystem::path& into)
    {
        return extract_archive_impl(archive, into);
    }

    uint64_t folder_size(const std::filesystem::path& directory)
    {
        return directory_size(directory);
    }

    std::optional<std::filesystem::path> content_root(const game_config::game_config_t& config)
    {
        const auto layout = layout_for(config);
        if (!layout)
        {
            return std::nullopt;
        }

        if (layout->plutonium)
        {
            return utils::properties::get_appdata_folder_path("Plutonium") / "storage" / config.game_key;
        }

        const auto install = config.get_install_path();
        if (!install || install->empty())
        {
            return std::nullopt;
        }

        return *install;
    }

    std::vector<content_folder> content_folders(const game_config::game_config_t& config)
    {
        std::vector<content_folder> folders{};
        const auto layout = layout_for(config);
        const auto root = content_root(config);
        if (!layout || !root)
        {
            return folders;
        }

        for (const auto& name : layout->folders)
        {
            folders.push_back({name, *root / name});
        }

        return folders;
    }

    std::optional<std::filesystem::path> ensure_content_folder(const game_config::game_config_t& config, const std::string& folder)
    {
        for (const auto& entry : content_folders(config))
        {
            if (entry.name == folder)
            {
                utils::io::create_directory(entry.path);
                return entry.path;
            }
        }

        return std::nullopt;
    }

    namespace
    {
        // Steam-subscribed items are not split into usermaps/mods on disk, so the
        // workshop.json Type decides what each one is.
        void append_steam_workshop(const game_layout& layout, const game_config::game_config_t& config, std::vector<installed_mod>& result)
        {
            const auto root = steam_workshop_root(layout, config);
            if (!root)
            {
                return;
            }

            for (const auto& directory : subdirectories(*root))
            {
                const auto dirname = utils::string::path_to_utf8(directory.filename());
                const auto info = read_workshop_json(directory);
                if (!info || (info->type != KIND_MAP && info->type != KIND_MOD) || !is_safe_dirname(dirname))
                {
                    continue;
                }

                const auto workshop_id = info->publisher_id.empty() ? dirname : info->publisher_id;
                const auto duplicate = std::any_of(result.begin(), result.end(), [&workshop_id](const installed_mod& mod)
                {
                    return !mod.workshop_id.empty() && mod.workshop_id == workshop_id;
                });
                if (duplicate)
                {
                    continue;
                }

                installed_mod mod{};
                mod.id = make_id(FOLDER_STEAM, dirname);
                mod.name = !info->title.empty() ? info->title : (!info->folder_name.empty() ? info->folder_name : dirname);
                mod.kind = info->type;
                mod.folder = FOLDER_STEAM;
                mod.source = SOURCE_STEAM;
                mod.workshop_id = workshop_id;
                mod.size = directory_size(directory);
                result.push_back(std::move(mod));
            }
        }
    }

    std::vector<installed_mod> list_installed(const game_config::game_config_t& config)
    {
        std::vector<installed_mod> result{};
        const auto layout = layout_for(config);
        if (!layout)
        {
            return result;
        }

        auto index = read_index(config);

        for (const auto& folder : content_folders(config))
        {
            for (const auto& directory : subdirectories(folder.path))
            {
                const auto dirname = utils::string::path_to_utf8(directory.filename());
                const auto id = make_id(folder.name, dirname);
                const auto stats = scan_directory(directory);

                installed_mod mod{};
                const auto known = std::find_if(index.begin(), index.end(), [&id](const installed_mod& entry) { return entry.id == id; });
                if (known != index.end())
                {
                    mod = *known;
                }
                else
                {
                    mod.id = id;
                    mod.name = dirname;
                    mod.source = "import";
                    // Never installed through the launcher, so stand in the newest file on
                    // disk: without it an update check has nothing to compare against.
                    mod.installed_at = iso8601_from(stats.newest);
                    apply_workshop_info(mod, directory);
                }

                mod.kind = folder.name == FOLDER_USERMAPS ? KIND_MAP : KIND_MOD;
                mod.folder = folder.name;
                mod.size = stats.size;
                result.push_back(std::move(mod));
            }
        }

        append_steam_workshop(*layout, config, result);

        // Forget index entries whose folder was removed outside the launcher.
        const auto before = index.size();
        std::erase_if(index, [&result](const installed_mod& entry)
        {
            return std::none_of(result.begin(), result.end(), [&entry](const installed_mod& mod) { return mod.id == entry.id; });
        });
        if (index.size() != before)
        {
            write_index(config, index);
        }

        return result;
    }

    import_result import_folder(const game_config::game_config_t& config, const std::filesystem::path& source, const progress_callback& progress, const std::string& origin)
    {
        const auto layout = layout_for(config);
        const auto root = content_root(config);
        if (!layout || !root)
        {
            return fail("This game does not support mods or is not installed.");
        }

        if (!utils::io::directory_exists(source))
        {
            return fail("The selected folder does not exist.");
        }

        // Prefer the workshop.json folder name: steamcmd item dirs are named by
        // numeric id, but the game expects the map's own folder name.
        auto dirname = utils::string::path_to_utf8(source.filename());
        if (const auto info = read_workshop_json(source); info && is_safe_dirname(info->folder_name))
        {
            dirname = info->folder_name;
        }

        if (!is_safe_dirname(dirname))
        {
            return fail("The folder name contains characters the game cannot load.");
        }

        const auto kind = detect_kind(*layout, source);
        if (kind.empty())
        {
            return fail("The selected folder is not a recognised map or mod.");
        }

        const std::string folder = kind == KIND_MAP ? FOLDER_USERMAPS : FOLDER_MODS;
        if (!has_folder(*layout, folder))
        {
            return fail("This game does not support custom " + std::string(kind == KIND_MAP ? "maps." : "mods."));
        }

        const auto target = *root / folder / dirname;
        if (progress)
        {
            progress("copying", dirname, 0);
        }

        try
        {
            std::error_code code{};
            std::filesystem::remove_all(target, code);
            utils::io::create_directory(*root / folder);
            utils::io::copy_folder(source, target);
        }
        catch (const std::exception& e)
        {
            utils::logger::write("[cbl-mods] failed to copy {} to {}: {}", utils::string::path_to_utf8(source), utils::string::path_to_utf8(target), e.what());
            return fail("Failed to copy the mod files: " + std::string(e.what()));
        }

        installed_mod mod{};
        mod.id = make_id(folder, dirname);
        mod.name = dirname;
        mod.kind = kind;
        mod.folder = folder;
        mod.source = origin;
        mod.installed_at = now_iso8601();
        apply_workshop_info(mod, target);
        remove_stale_copies(config, *layout, *root, mod.workshop_id, folder, dirname);
        mod.size = directory_size(target);
        upsert_index(config, mod);

        utils::logger::write("[cbl-mods] imported {} into {}", mod.id, utils::string::path_to_utf8(target));
        return {true, {}, mod};
    }

    import_result import_zip(const game_config::game_config_t& config, const std::filesystem::path& archive, const progress_callback& progress)
    {
        if (!supports(config) || !content_root(config))
        {
            return fail("This game does not support mods or is not installed.");
        }

        if (!utils::io::file_exists(archive))
        {
            return fail("The selected file does not exist.");
        }

        const auto stem = utils::string::path_to_utf8(archive.stem());
        const auto staging = make_staging_dir();
        const auto extracted = staging / utils::string::utf8_to_path(stem);
        const auto _ = utils::finally([&staging]
        {
            std::error_code code{};
            std::filesystem::remove_all(staging, code);
        });

        if (progress)
        {
            progress("extracting", stem, 0);
        }

        utils::io::create_directory(extracted);
        if (const auto error = extract_zip(archive, extracted); !error.empty())
        {
            utils::logger::write("[cbl-mods] zip import of {} failed: {}", utils::string::path_to_utf8(archive), error);
            return fail(error);
        }

        // A zip that wraps everything in one top-level folder is the folder; otherwise the zip itself is.
        const auto top_level = subdirectories(extracted);
        const auto loose_files = utils::io::list_files(extracted).size() - top_level.size();
        const auto source = (top_level.size() == 1 && loose_files == 0) ? top_level.front() : extracted;

        return import_folder(config, source, progress, "import");
    }

    import_result install_workshop_item(const game_config::game_config_t& config, const std::string& workshop_id, const uint64_t expected_size, const progress_callback& progress)
    {
        const auto layout = layout_for(config);
        const auto root = content_root(config);
        if (!layout || !root || !layout->steam_appid)
        {
            return fail("This game does not support Workshop downloads or is not installed.");
        }

        if (workshop_id.empty() || !std::all_of(workshop_id.begin(), workshop_id.end(), [](const unsigned char c) { return std::isdigit(c); }))
        {
            return fail("Invalid Workshop item id.");
        }

        std::error_code code{};
        const auto steamcmd_space = std::filesystem::space(utils::properties::get_appdata_path(), code);
        const auto target_space = std::filesystem::space(*root, code);
        if (!code && expected_size && (steamcmd_space.available < expected_size || target_space.available < expected_size))
        {
            return fail("Not enough free disk space for this item.");
        }

        std::string error{};
        if (!steamcmd::ensure_installed(progress, error))
        {
            return fail(error);
        }

        const auto item = steamcmd::download_item(layout->steam_appid, workshop_id, expected_size, progress, error);
        if (!item)
        {
            return fail(error);
        }

        if (progress)
        {
            progress("installing", workshop_id, 0);
        }

        auto result = import_folder(config, *item, {}, "workshop");
        steamcmd::cleanup_downloads(layout->steam_appid, workshop_id);
        return result;
    }

    std::optional<std::filesystem::path> mod_path(const game_config::game_config_t& config, const std::string& id)
    {
        const auto separator = id.find(':');
        if (separator == std::string::npos)
        {
            return std::nullopt;
        }

        const auto folder = id.substr(0, separator);
        const auto dirname = id.substr(separator + 1);
        const auto layout = layout_for(config);
        if (!layout || !is_safe_dirname(dirname))
        {
            return std::nullopt;
        }

        // Steam-subscribed items live outside the content folders, in their own library path.
        std::optional<std::filesystem::path> parent{};
        if (folder == FOLDER_STEAM)
        {
            parent = steam_workshop_root(*layout, config);
        }
        else if (const auto root = content_root(config); root && has_folder(*layout, folder))
        {
            parent = *root / folder;
        }

        if (!parent)
        {
            return std::nullopt;
        }

        const auto target = (*parent / dirname).lexically_normal();
        return client_store::is_inside_folder(target, *parent) ? std::optional{target} : std::nullopt;
    }

    bool uninstall(const game_config::game_config_t& config, const std::string& id, std::string& error)
    {
        const auto path = mod_path(config, id);
        if (!path)
        {
            error = "Invalid mod id.";
            return false;
        }

        const auto& target = *path;
        if (!utils::io::directory_exists(target))
        {
            error = "The mod folder no longer exists.";
            return false;
        }

        std::error_code code{};
        std::filesystem::remove_all(target, code);
        if (code)
        {
            error = "Failed to delete the mod folder: " + code.message();
            utils::logger::write("[cbl-mods] failed to delete {}: {}", utils::string::path_to_utf8(target), code.message());
            return false;
        }

        erase_index(config, id);
        utils::logger::write("[cbl-mods] uninstalled {}", id);
        return true;
    }
}
