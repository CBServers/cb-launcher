#include <std_include.hpp>

#include "client_store.hpp"

#include <utils/hash.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

namespace client_store
{
    namespace
    {
        std::filesystem::path stored_file_path(const std::string& client_id, const std::string& name)
        {
            return store_path(client_id) / utils::string::utf8_to_path(name);
        }

        // Compare-first: size, then a same-algorithm hash of both local files.
        bool files_match(const std::filesystem::path& live, const std::filesystem::path& stored)
        {
            if (!utils::io::file_exists(live))
            {
                return false;
            }

            if (utils::io::file_size(live) != utils::io::file_size(stored))
            {
                return false;
            }

            const auto live_hash = utils::hash::get_file_hash(live);
            return !live_hash.empty() && live_hash == utils::hash::get_file_hash(stored);
        }

        // Temp-then-rename, so a crash mid-copy never leaves a truncated file in place.
        bool copy_into_place(const std::filesystem::path& stored, const std::filesystem::path& live)
        {
            if (live.has_parent_path())
            {
                utils::io::create_directory(live.parent_path());
            }

            auto temp = live;
            temp += L".cbtmp";

            std::error_code code{};
            std::filesystem::copy_file(stored, temp, std::filesystem::copy_options::overwrite_existing, code);
            if (code)
            {
                utils::io::remove_file(temp);
                return false;
            }

            if (!utils::io::move_file_replace(temp, live))
            {
                utils::io::remove_file(temp);
                return false;
            }

            return true;
        }

        // Paths the game manifest ships (plus the base game's): overwrite-only, never deleted.
        std::unordered_set<std::wstring> collect_game_manifest_keys(const game_config::game_config_t& config,
            const std::filesystem::path& install_path)
        {
            std::unordered_set<std::wstring> keys{};

            const auto collect = [&keys, &install_path](const game_config::game_config_t& game)
            {
                std::string json{};
                try
                {
                    json = game_config::read_manifest(game);
                }
                catch (...)
                {
                    return;
                }

                rapidjson::Document doc{};
                doc.Parse(json.data(), json.size());
                if (doc.HasParseError() || !doc.IsObject() || !doc.HasMember("files") || !doc["files"].IsArray())
                {
                    return;
                }

                for (const auto& entry : doc["files"].GetArray())
                {
                    if (!entry.IsArray() || entry.GetArray().Size() < 1 || !entry.GetArray()[0].IsString())
                    {
                        continue;
                    }

                    const std::string name{entry.GetArray()[0].GetString(), entry.GetArray()[0].GetStringLength()};
                    keys.emplace(path_key(install_path / utils::string::utf8_to_path(name)));

                    // Steam installs remap these prefixes to the game root; guard both shapes.
                    for (const auto* prefix : {"zone/", "raw/video/"})
                    {
                        if (utils::string::starts_with(name, prefix))
                        {
                            const auto stripped = utils::string::replace(name, prefix, "");
                            keys.emplace(path_key(install_path / utils::string::utf8_to_path(stripped)));
                        }
                    }
                }
            };

            collect(config);

            if (!config.base_game.empty())
            {
                if (const auto base = game_config::get_game_config(config.base_game))
                {
                    collect(*base);
                }
            }

            return keys;
        }
    }

    client_paths::client_paths(std::filesystem::path install_path, const game_config::client_files_t& client)
        : install_path_(std::move(install_path)),
          client_default_path_(client.client_default_path.empty() ? install_path_ : client.client_default_path),
          install_path_files_(client.client_install_path_files)
    {
    }

    std::filesystem::path client_paths::resolve_file(const std::string& name, const updater::file_dest dest) const
    {
        return this->resolve_base(name, dest) / utils::string::utf8_to_path(name);
    }

    std::filesystem::path client_paths::resolve_base(const std::string& name, const updater::file_dest dest) const
    {
        if (dest == updater::file_dest::game)
        {
            return this->install_path_;
        }

        if (dest == updater::file_dest::appdata)
        {
            return this->client_default_path_;
        }

        if (this->install_path_files_.empty())
        {
            return this->client_default_path_;
        }

        if (this->install_path_files_.contains(name))
        {
            return this->install_path_;
        }

        for (const auto& entry : this->install_path_files_)
        {
            const auto star = entry.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = entry.substr(0, star);
            if (utils::string::starts_with(name, prefix))
            {
                return this->install_path_;
            }
        }

        return this->client_default_path_;
    }

    std::filesystem::path client_paths::resolve_data_dir(const game_config::data_folder_t& entry) const
    {
        const auto& folder = entry.folder;

        if (entry.dest == updater::file_dest::game)
        {
            return this->install_path_ / folder;
        }

        if (entry.dest == updater::file_dest::appdata)
        {
            return this->client_default_path_ / folder;
        }

        if (this->install_path_files_.empty())
        {
            return this->client_default_path_ / folder;
        }

        if (this->install_path_files_.contains(folder))
        {
            return this->install_path_ / folder;
        }

        for (const auto& file : this->install_path_files_)
        {
            const auto star = file.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = file.substr(0, star);
            const auto folder_slash = folder + "/";
            if (utils::string::starts_with(folder_slash, prefix) ||
                utils::string::starts_with(prefix, folder_slash))
            {
                return this->install_path_ / folder;
            }
        }

        return this->client_default_path_ / folder;
    }

    updater::file_dest parse_file_dest(const std::string& token)
    {
        if (token == "game") return updater::file_dest::game;
        if (token == "appdata") return updater::file_dest::appdata;
        return updater::file_dest::automatic;
    }

    updater::file_dest parse_file_dest(const rapidjson::Value& element)
    {
        if (element.IsString())
        {
            return parse_file_dest(std::string{element.GetString(), element.GetStringLength()});
        }

        if (element.IsObject())
        {
            const auto dest = element.FindMember("dest");
            if (dest != element.MemberEnd() && dest->value.IsString())
            {
                return parse_file_dest(std::string{dest->value.GetString(), dest->value.GetStringLength()});
            }
        }

        return updater::file_dest::automatic;
    }

    // Beside the store subdir (clients/<id>/), not inside it, so the sweep never sees it.
    std::filesystem::path manifest_cache_path(const std::string& client_id)
    {
        return utils::properties::get_appdata_path() / "clients" / (client_id + ".json");
    }

    std::vector<cached_file> read_manifest_cache(const std::string& client_id)
    {
        std::string data{};
        if (!utils::io::read_file(manifest_cache_path(client_id), &data) || data.empty())
        {
            return {};
        }

        rapidjson::Document doc{};
        doc.Parse(data.data(), data.size());
        if (doc.HasParseError() || !doc.IsArray())
        {
            return {};
        }

        std::vector<cached_file> files{};
        files.reserve(doc.GetArray().Size());

        for (const auto& element : doc.GetArray())
        {
            // Bare string = dest automatic; ["name", "game"] carries an explicit dest.
            if (element.IsString())
            {
                files.emplace_back(cached_file{
                    std::string{element.GetString(), element.GetStringLength()}, updater::file_dest::automatic});
                continue;
            }

            if (!element.IsArray())
            {
                continue;
            }

            const auto array = element.GetArray();
            if (array.Size() < 1 || !array[0].IsString())
            {
                continue;
            }

            files.emplace_back(cached_file{
                std::string{array[0].GetString(), array[0].GetStringLength()},
                array.Size() > 1 ? parse_file_dest(array[1]) : updater::file_dest::automatic});
        }

        return files;
    }

    std::wstring path_key(const std::filesystem::path& path)
    {
        std::error_code code{};
        const auto resolved = std::filesystem::absolute(path, code);
        auto text = (code ? path : resolved).lexically_normal().wstring();

        while (!text.empty() && (text.back() == L'\\' || text.back() == L'/'))
        {
            text.pop_back();
        }

        if (!text.empty())
        {
            ::CharLowerBuffW(text.data(), static_cast<DWORD>(text.size()));
        }

        return text;
    }

    bool is_inside_folder(const std::filesystem::path& file, const std::filesystem::path& folder)
    {
        std::error_code code{};
        const auto relative = std::filesystem::relative(file, folder, code);
        if (code)
        {
            return false;
        }

        const auto start = relative.begin();
        return start != relative.end() && start->native() != L"..";
    }

    void prune_empty_directories(const std::set<std::filesystem::path>& directories)
    {
        std::vector<std::filesystem::path> sorted_dirs(directories.begin(), directories.end());
        std::sort(sorted_dirs.begin(), sorted_dirs.end(), [](const auto& a, const auto& b) {
            return std::distance(a.begin(), a.end()) > std::distance(b.begin(), b.end());
        });

        for (const auto& dir : sorted_dirs)
        {
            std::error_code ec;
            if (std::filesystem::exists(dir, ec) && std::filesystem::is_empty(dir, ec))
            {
                std::filesystem::remove(dir, ec);
                if (!ec)
                {
                    printf("Removed empty directory: %s\n", dir.filename().string().data());
                }
            }
        }
    }

    std::filesystem::path store_path(const std::string& client_id)
    {
        return utils::properties::get_appdata_path() / "clients" / client_id;
    }

    void sweep_store(const std::string& client_id, const std::vector<updater::file_info>& manifest_files)
    {
        // An empty manifest is a failed fetch, not "this client ships nothing".
        if (manifest_files.empty())
        {
            return;
        }

        const auto root = store_path(client_id);
        if (!utils::io::directory_exists(root))
        {
            return;
        }

        std::unordered_set<std::wstring> expected{};
        expected.reserve(manifest_files.size());
        for (const auto& file : manifest_files)
        {
            expected.emplace(path_key(root / utils::string::utf8_to_path(file.name)));
        }

        std::set<std::filesystem::path> directories{};

        for (const auto& path : utils::io::list_files(root, true))
        {
            std::error_code code{};
            if (std::filesystem::is_directory(path, code))
            {
                directories.insert(path);
                continue;
            }

            if (expected.contains(path_key(path)))
            {
                continue;
            }

            if (utils::io::remove_file(path))
            {
                utils::logger::write("Swept store file {}", utils::string::path_to_utf8(path));
            }
        }

        prune_empty_directories(directories);
    }

    void delete_store(const std::string& client_id)
    {
        std::error_code code{};
        std::filesystem::remove_all(store_path(client_id), code);
    }

    void reconcile(const game_config::game_config_t& config, const std::string& mode)
    {
        if (!game_config::is_store_routed(config))
        {
            return;
        }

        const auto install_path = config.get_install_path();
        if (!install_path || install_path->empty())
        {
            return;
        }

        const auto* selected = game_config::select_client_for_mode(config, mode);
        if (!selected)
        {
            return;
        }

        const auto selected_entries = read_manifest_cache(selected->client_id);
        if (selected_entries.empty())
        {
            // Never updated on this build: nothing to assert and nothing safe to delete.
            return;
        }

        utils::logger::write("Reconciling {} to client {} for mode {}", config.game_key, selected->client_id, mode);

        // Copy side, global: assert every file of the selected client, compare-first.
        const client_paths selected_paths(*install_path, *selected);
        std::unordered_set<std::wstring> selected_keys{};
        selected_keys.reserve(selected_entries.size());

        for (const auto& entry : selected_entries)
        {
            const auto live = selected_paths.resolve_file(entry.name, entry.dest);
            selected_keys.emplace(path_key(live));

            const auto stored = stored_file_path(selected->client_id, entry.name);
            if (!utils::io::file_exists(stored))
            {
                utils::logger::write("Store copy missing for {} of {}", entry.name, selected->client_id);
                continue;
            }

            if (files_match(live, stored))
            {
                continue;
            }

            if (copy_into_place(stored, live))
            {
                utils::logger::write("Reconciled {} into place", entry.name);
            }
            else
            {
                utils::logger::write("Failed to reconcile {} into place", entry.name);
            }
        }

        // Delete side, mode-scoped: only files exclusive to other same-mode clients.
        const auto game_owned = collect_game_manifest_keys(config, *install_path);
        std::set<std::filesystem::path> directories_to_check{};

        for (const auto* other : game_config::clients_for_mode(config, mode))
        {
            if (other == selected)
            {
                continue;
            }

            const client_paths other_paths(*install_path, *other);

            std::vector<std::filesystem::path> roots{};
            roots.reserve(other->client_data_folders.size());
            for (const auto& folder : other->client_data_folders)
            {
                roots.emplace_back(other_paths.resolve_data_dir(folder));
            }

            for (const auto& entry : read_manifest_cache(other->client_id))
            {
                const auto live = other_paths.resolve_file(entry.name, entry.dest);
                const auto key = path_key(live);

                if (selected_keys.contains(key) || game_owned.contains(key) || !utils::io::file_exists(live))
                {
                    continue;
                }

                if (!utils::io::remove_file(live))
                {
                    utils::logger::write("Failed to remove {} of inactive client {}", entry.name, other->client_id);
                    continue;
                }

                utils::logger::write("Removed {} of inactive client {}", entry.name, other->client_id);

                // Walk up to (but never including) a data folder root, as the diff does.
                for (auto parent = live.parent_path(); !parent.empty() && parent != parent.parent_path();
                     parent = parent.parent_path())
                {
                    const auto parent_key = path_key(parent);
                    const auto inside_root = std::any_of(roots.begin(), roots.end(),
                        [&parent, &parent_key](const std::filesystem::path& root)
                    {
                        return parent_key != path_key(root) && is_inside_folder(parent, root);
                    });

                    if (!inside_root)
                    {
                        break;
                    }

                    directories_to_check.insert(parent);
                }
            }
        }

        prune_empty_directories(directories_to_check);
    }

    void reconcile_all(const game_config::game_config_t& config)
    {
        if (!game_config::is_store_routed(config))
        {
            return;
        }

        std::vector<std::string> modes{};
        modes.reserve(config.mode_arguments.size());
        for (const auto& [mode, argument] : config.mode_arguments)
        {
            modes.push_back(mode);
        }

        if (modes.empty())
        {
            modes.emplace_back("");
        }

        // Contested modes last, so the user's selection there owns any contested paths.
        std::sort(modes.begin(), modes.end());
        std::stable_sort(modes.begin(), modes.end(), [&config](const std::string& a, const std::string& b)
        {
            return game_config::clients_for_mode(config, a).size() < game_config::clients_for_mode(config, b).size();
        });

        for (const auto& mode : modes)
        {
            reconcile(config, mode);
        }
    }
}
