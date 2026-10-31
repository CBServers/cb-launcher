#include "std_include.hpp"
#include "catalog_installer.hpp"
#include "mod_download.hpp"
#include "workshop_catalog.hpp"
#include "updater/client_store.hpp"

#include <utils/finally.hpp>
#include <utils/flags.hpp>
#include <utils/hash.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/string.hpp>

namespace catalog_installer
{
    namespace
    {
        constexpr size_t MAX_PATH_LENGTH = 200;
        constexpr std::string_view INVALID_PATH_CHARS = "<>:\"|?*\\";

        const std::unordered_set<std::string> RESERVED_NAMES = {
            "con", "prn", "aux", "nul",
            "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
            "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
        };

        struct hash_cancelled
        {
        };

        mods::import_result fail(std::string error)
        {
            return {false, std::move(error), std::nullopt};
        }

        bool is_entry_id(const std::string& id)
        {
            const auto lower_alnum = [](const unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); };
            return !id.empty() && id.size() <= 64 && lower_alnum(id.front())
                && std::all_of(id.begin(), id.end(), [&](const unsigned char c) { return lower_alnum(c) || c == '_' || c == '-'; });
        }

        bool is_hash(const std::string& hash)
        {
            return hash.size() == 16 && std::all_of(hash.begin(), hash.end(), [](const unsigned char c)
            {
                return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F');
            });
        }

        // The index CI's rules (scripts/index_lib.py path_error), checked again since the catalog is remote data.
        bool is_safe_path(const std::string& path)
        {
            if (path.empty() || path.size() > MAX_PATH_LENGTH || path.front() == '/')
            {
                return false;
            }

            for (size_t start = 0;;)
            {
                const auto end = path.find('/', start);
                const auto segment = path.substr(start, end == std::string::npos ? std::string::npos : end - start);
                if (segment.empty() || segment == "." || segment == ".." || segment.back() == ' ' || segment.back() == '.')
                {
                    return false;
                }

                const auto bad_char = std::any_of(segment.begin(), segment.end(), [](const unsigned char c)
                {
                    return c < 32 || INVALID_PATH_CHARS.find(static_cast<char>(c)) != std::string_view::npos;
                });
                if (bad_char || RESERVED_NAMES.contains(utils::string::to_lower(segment.substr(0, segment.find('.')))))
                {
                    return false;
                }

                if (end == std::string::npos)
                {
                    return true;
                }

                start = end + 1;
            }
        }

        // https:// as published, or cdn:mods/<game>/<id>/<path> (an unencoded path, resolved per mirror).
        bool is_safe_link(const std::string& link, const game_config::game_config_t& config, const std::string& entry_id)
        {
            if (utils::string::starts_with(link, "https://"))
            {
                return link.size() > 8 && std::none_of(link.begin(), link.end(), [](const unsigned char c) { return c <= ' ' || c == 0x7f; });
            }

            const auto prefix = "cdn:mods/" + config.game_key + "/" + entry_id + "/";
            return utils::string::starts_with(link, prefix) && link.size() > prefix.size() && is_safe_path(link.substr(4));
        }

        std::string file_key(const mods::catalog_file& file)
        {
            return file.root + ":" + utils::string::to_lower(file.path);
        }

        mods::catalog_file without_urls(mods::catalog_file file)
        {
            file.urls.clear();
            return file;
        }

        std::optional<std::filesystem::path> resolve_target(const game_config::game_config_t& config, const mods::catalog_file& file)
        {
            const auto root = mods::catalog_root_path(config, file.root);
            if (!root || !is_safe_path(file.path))
            {
                return std::nullopt;
            }

            auto target = (*root / utils::string::utf8_to_path(file.path)).lexically_normal();
            if (client_store::path_key(target) == client_store::path_key(*root) || !utils::io::is_inside_folder(target, *root))
            {
                return std::nullopt;
            }

            return target;
        }

        // What a mod file must never touch: the game's and its clients' manifest files (a verify would put them
        // back) and the folders a client sweeps (it deletes anything there it didn't ship).
        struct guards
        {
            std::unordered_set<std::wstring> owned_files;
            std::vector<std::filesystem::path> swept_folders;
        };

        guards load_guards(const game_config::game_config_t& config)
        {
            guards result{};
            const auto install = config.get_install_path();
            if (!install || install->empty())
            {
                return result;
            }

            result.owned_files = client_store::game_manifest_keys(config, *install);
            for (const auto& client : config.clients)
            {
                const client_store::client_paths paths(*install, client);
                for (const auto& file : client_store::read_manifest_cache(client.client_id))
                {
                    result.owned_files.insert(client_store::path_key(paths.resolve_file(file.name, file.dest)));
                }

                if (!client.sweep_client_data_folders)
                {
                    continue;
                }

                for (const auto& folder : client.client_data_folders)
                {
                    result.swept_folders.push_back(paths.resolve_data_dir(folder));
                    result.swept_folders.push_back(*install / utils::string::utf8_to_path(folder.folder));
                }
            }

            return result;
        }

        bool is_guarded(const guards& guards, const std::filesystem::path& target)
        {
            return guards.owned_files.contains(client_store::path_key(target))
                || std::any_of(guards.swept_folders.begin(), guards.swept_folders.end(), [&target](const std::filesystem::path& folder)
                {
                    return utils::io::is_inside_folder(target, folder);
                });
        }

        // Files other catalog installs recorded, mapped to their names; two installs never share a path.
        std::unordered_map<std::wstring, std::string> files_of_others(const game_config::game_config_t& config,
            const std::vector<mods::installed_mod>& index, const std::string& record_id)
        {
            std::unordered_map<std::wstring, std::string> owners{};
            for (const auto& mod : index)
            {
                if (mod.source != mods::SOURCE_CATALOG || mod.id == record_id)
                {
                    continue;
                }

                for (const auto& file : mod.files)
                {
                    if (const auto target = resolve_target(config, file))
                    {
                        owners.emplace(client_store::path_key(*target), mod.name);
                    }
                }
            }

            return owners;
        }

        struct planned_file
        {
            mods::catalog_file file;
            std::filesystem::path root;
            std::filesystem::path target;
        };

        // Every file is checked before anything is written, so a bad entry never leaves half an install behind.
        std::string plan_files(const game_config::game_config_t& config, const mods::workshop_catalog::item& item,
            const guards& guards, const std::vector<mods::installed_mod>& index, std::vector<planned_file>& planned)
        {
            const auto roots = mods::catalog_roots(config);
            const auto owners = files_of_others(config, index, mods::catalog_record_id(item.id));
            std::unordered_set<std::wstring> seen{};

            for (auto file : item.files)
            {
                if (file.root.empty())
                {
                    file.root = roots.front();
                }

                if (std::find(roots.begin(), roots.end(), file.root) == roots.end())
                {
                    return "This mod has files for a folder this game does not use (" + file.root + ").";
                }

                const auto root = mods::catalog_root_path(config, file.root);
                if (!root)
                {
                    return "Set this game's install folder before installing this mod.";
                }

                const auto target = resolve_target(config, file);
                if (!target)
                {
                    return "This mod has an unsafe file path: " + file.path;
                }

                if (!is_hash(file.hash))
                {
                    return "This mod has a file without a valid hash: " + file.path;
                }

                if (file.urls.empty() || !std::all_of(file.urls.begin(), file.urls.end(),
                    [&](const std::string& link) { return is_safe_link(link, config, item.id); }))
                {
                    return "This mod has an unsupported download link for " + file.path;
                }

                if (is_guarded(guards, *target))
                {
                    return "This mod would overwrite a file the game or its client manages: " + file.path;
                }

                const auto key = client_store::path_key(*target);
                if (!seen.insert(key).second)
                {
                    return "This mod lists " + file.path + " twice.";
                }

                if (const auto owner = owners.find(key); owner != owners.end())
                {
                    return file.path + " already belongs to " + owner->second + ". Uninstall it first.";
                }

                planned.push_back({std::move(file), *root, *target});
            }

            return {};
        }

        bool file_matches(const planned_file& file, const std::function<bool()>& keep_going)
        {
            if (!utils::io::file_exists(file.target) || utils::io::file_size(file.target) != file.file.size)
            {
                return false;
            }

            if (file.file.size == 0)
            {
                return true;
            }

            return utils::hash::get_file_hash(file.target, [&keep_going]
            {
                if (!keep_going())
                {
                    throw hash_cancelled{};
                }
            }) == file.file.hash;
        }

        std::string check_disk_space(const std::vector<const planned_file*>& outdated)
        {
            std::unordered_map<std::wstring, std::pair<std::filesystem::path, uint64_t>> volumes{};
            for (const auto* file : outdated)
            {
                const auto held = std::min<uint64_t>(mod_download::partial_size(file->target, file->file.hash), file->file.size);
                auto& volume = volumes[client_store::path_key(file->root.root_path())];
                volume.first = file->root;
                volume.second += file->file.size - held;
            }

            for (const auto& [key, volume] : volumes)
            {
                std::error_code code{};
                const auto space = std::filesystem::space(volume.first, code);
                if (!code && volume.second && space.available < volume.second)
                {
                    return "Not enough free disk space for this mod.";
                }
            }

            return {};
        }

        // Deletes one recorded file unless the game now ships it or another install owns it.
        bool remove_recorded(const game_config::game_config_t& config, const mods::catalog_file& file, const guards& guards,
            const std::unordered_map<std::wstring, std::string>& owners, std::vector<std::pair<std::filesystem::path, std::filesystem::path>>& folders)
        {
            const auto target = resolve_target(config, file);
            if (!target)
            {
                return true;
            }

            mod_download::remove_partial(*target, file.hash);
            if (is_guarded(guards, *target) || owners.contains(client_store::path_key(*target)))
            {
                return true;
            }

            folders.emplace_back(*mods::catalog_root_path(config, file.root), target->parent_path());
            if (utils::io::file_exists(*target) && !utils::io::remove_file(*target))
            {
                utils::logger::write("[cbl-mods] failed to delete {}", utils::string::path_to_utf8(*target));
                return false;
            }

            return true;
        }

        // Empty folders left behind, stopping at the root and never removing a content folder like mods/ itself.
        void prune_folders(const game_config::game_config_t& config, const std::vector<std::pair<std::filesystem::path, std::filesystem::path>>& folders)
        {
            std::unordered_set<std::wstring> stops{};
            for (const auto& root : mods::catalog_roots(config))
            {
                if (const auto path = mods::catalog_root_path(config, root))
                {
                    stops.insert(client_store::path_key(*path));
                    for (const auto& folder : mods::content_folders(config))
                    {
                        stops.insert(client_store::path_key(*path / utils::string::utf8_to_path(folder.name)));
                    }
                }
            }

            std::set<std::filesystem::path> candidates{};
            for (const auto& [root, folder] : folders)
            {
                for (auto directory = folder; !stops.contains(client_store::path_key(directory)) && utils::io::is_inside_folder(directory, root);
                     directory = directory.parent_path())
                {
                    candidates.insert(directory);
                }
            }

            client_store::prune_empty_directories(candidates);
        }

        mods::import_result install_entry(const game_config::game_config_t& config, const mods::workshop_catalog::item& item,
            const guards& guards, const mods::progress_callback& progress)
        {
            const auto report = [&progress, &item](const std::string& phase, const int percent)
            {
                return !progress || progress(phase, item.id, percent);
            };

            if (!report("preparing", 0))
            {
                return fail("cancelled");
            }

            const auto index = mods::read_index(config);
            std::vector<planned_file> planned{};
            if (const auto error = plan_files(config, item, guards, index, planned); !error.empty())
            {
                utils::logger::write("[cbl-mods] refused catalog entry {}: {}", item.id, error);
                return fail(error);
            }

            const auto record_id = mods::catalog_record_id(item.id);
            const auto previous_it = std::find_if(index.begin(), index.end(), [&record_id](const mods::installed_mod& mod) { return mod.id == record_id; });
            const auto previous = previous_it != index.end() ? std::optional{*previous_it} : std::nullopt;

            mods::installed_mod record{};
            record.id = record_id;
            record.name = item.title.empty() ? item.id : item.title;
            record.kind = item.kind == "mod" ? "mod" : "map";
            record.folder = mods::SOURCE_CATALOG;
            record.source = mods::SOURCE_CATALOG;
            record.workshop_id = item.id;

            std::unordered_set<std::string> planned_keys{};
            for (const auto& file : planned)
            {
                planned_keys.insert(file_key(file.file));
                record.files.push_back(without_urls(file.file));
                record.size += file.file.size;
            }

            // Recorded before anything is written: an interrupted install stays listed, resumable and uninstallable.
            auto provisional = record;
            provisional.version = previous ? previous->version : std::string{};
            provisional.installed_at = previous ? previous->installed_at : mods::now_iso8601();
            if (previous)
            {
                for (const auto& file : previous->files)
                {
                    if (!planned_keys.contains(file_key(file)))
                    {
                        provisional.files.push_back(file);
                    }
                }
            }
            mods::upsert_index(config, provisional);

            // Files already on disk with the listed hash (a previous version, or the mod's own installer) are kept.
            std::vector<const planned_file*> outdated{};
            uint64_t outdated_bytes = 0;
            try
            {
                for (const auto& file : planned)
                {
                    if (!report("preparing", 0))
                    {
                        return fail("cancelled");
                    }

                    if (!file_matches(file, [&report] { return report("preparing", 0); }))
                    {
                        outdated.push_back(&file);
                        outdated_bytes += file.file.size;
                    }
                }
            }
            catch (const hash_cancelled&)
            {
                return fail("cancelled");
            }

            if (const auto error = check_disk_space(outdated); !error.empty())
            {
                return fail(error);
            }

            const auto total_bytes = std::max<uint64_t>(outdated_bytes, 1);
            uint64_t completed_bytes = 0;
            for (const auto* file : outdated)
            {
                const auto on_progress = [&](const uint64_t current)
                {
                    const auto done = completed_bytes + std::min<uint64_t>(current, file->file.size);
                    return report("downloading", static_cast<int>(std::min<uint64_t>(done * 100 / total_bytes, 99)));
                };

                const mod_download::request request{file->file.path, file->file.urls, file->file.size, file->file.hash};
                std::string error{};
                // One retry: a size or hash mismatch drops the partial, so the second pass refetches it.
                for (auto attempt = 0; attempt < 2; ++attempt)
                {
                    error = mod_download::download(request, file->target, on_progress);
                    if (error.empty() || error == "cancelled")
                    {
                        break;
                    }

                    utils::logger::write("[cbl-mods] retrying {}: {}", file->file.path, error);
                }

                if (!error.empty())
                {
                    return fail(error);
                }

                completed_bytes += file->file.size;
            }

            // Files the installed version had and this one doesn't (replaces a mod's own "retire" list).
            if (previous)
            {
                const auto owners = files_of_others(config, index, record_id);
                std::vector<std::pair<std::filesystem::path, std::filesystem::path>> folders{};
                for (const auto& file : previous->files)
                {
                    if (!planned_keys.contains(file_key(file)))
                    {
                        remove_recorded(config, file, guards, owners, folders);
                    }
                }

                prune_folders(config, folders);
            }

            report("installing", 99);
            record.version = item.version;
            record.installed_at = mods::now_iso8601();
            mods::upsert_index(config, record);

            utils::logger::write("[cbl-mods] installed catalog entry {} {} ({} files, {} downloaded)", item.id, item.version,
                planned.size(), outdated.size());
            return {true, {}, record};
        }
    }

    mods::import_result install(const game_config::game_config_t& config, const std::string& entry_id, const mods::progress_callback& progress)
    {
        if (!mods::uses_catalog(config))
        {
            return fail("This game does not support the mod catalog.");
        }

        if (!is_entry_id(entry_id))
        {
            return fail("Invalid mod id.");
        }

        if (utils::flags::has_flag("offline"))
        {
            return fail("Mods cannot be downloaded in offline mode.");
        }

        if (game_config::is_game_process_running(config.id))
        {
            return fail("Close " + config.display_name + " before installing mods.");
        }

        if (progress && !progress("preparing", entry_id, 0))
        {
            return fail("cancelled");
        }

        const auto parent = mods::workshop_catalog::fetch(config, entry_id);
        if (!parent)
        {
            return fail("Could not load this mod from the mod catalog. Try again later.");
        }

        if (parent->files.empty())
        {
            return fail("This mod is not available to download yet.");
        }

        // Required entries first, deepest first, each once; ones already installed are left as they are.
        const auto index = mods::read_index(config);
        const auto installed = [&index](const std::string& id)
        {
            const auto record_id = mods::catalog_record_id(id);
            return std::any_of(index.begin(), index.end(), [&record_id](const mods::installed_mod& mod) { return mod.id == record_id; });
        };

        std::vector<mods::workshop_catalog::item> items{};
        std::unordered_set<std::string> visited{entry_id};
        const std::function<void(const mods::workshop_catalog::item&)> collect = [&](const mods::workshop_catalog::item& item)
        {
            for (const auto& child : item.children)
            {
                if (items.size() >= mods::MAX_WORKSHOP_CHILDREN || !is_entry_id(child.id) || !visited.insert(child.id).second || installed(child.id))
                {
                    continue;
                }

                auto required = mods::workshop_catalog::fetch(config, child.id);
                if (!required || required->files.empty())
                {
                    utils::logger::write("[cbl-mods] skipping requirement {} of {}: not installable", child.id, item.id);
                    continue;
                }

                collect(*required);
                if (items.size() < mods::MAX_WORKSHOP_CHILDREN)
                {
                    items.push_back(std::move(*required));
                }
            }
        };
        collect(*parent);
        items.push_back(*parent);

        const auto guards = load_guards(config);

        // Combined progress weighted by size; the high-water mark keeps the bar monotonic across entries.
        uint64_t total_weight = 0;
        for (const auto& item : items)
        {
            total_weight += std::max<uint64_t>(item.size, 1);
        }

        uint64_t completed_weight = 0;
        auto high_water = 0;
        auto parent_result = fail("The install failed.");

        for (size_t i = 0; i < items.size(); ++i)
        {
            const auto& item = items[i];
            const auto is_parent = i + 1 == items.size();
            const auto weight = std::max<uint64_t>(item.size, 1);
            const auto scaled = [&](const std::string& phase, const std::string& name, const int percent)
            {
                const auto clamped = static_cast<uint64_t>(std::clamp(percent, 0, 100));
                const auto combined = static_cast<int>((completed_weight * 100 + weight * clamped) / total_weight);
                high_water = std::max(high_water, std::min(combined, 99));
                return !progress || progress(phase, name, high_water);
            };

            auto result = install_entry(config, item, guards, scaled);
            if (!result.success && (result.error == "cancelled" || is_parent))
            {
                return result;
            }

            if (is_parent)
            {
                parent_result = std::move(result);
            }
            else if (!result.success)
            {
                // A requirement that can't install must not block the entry itself, as with Workshop items.
                utils::logger::write("[cbl-mods] failed to install requirement {}: {}", item.id, result.error);
            }

            completed_weight += weight;
        }

        return parent_result;
    }

    bool uninstall(const game_config::game_config_t& config, const std::string& entry_id, std::string& error)
    {
        if (!is_entry_id(entry_id))
        {
            error = "Invalid mod id.";
            return false;
        }

        if (game_config::is_game_process_running(config.id))
        {
            error = "Close " + config.display_name + " before uninstalling mods.";
            return false;
        }

        if (!mods::try_claim_install(config))
        {
            error = "Wait for the current install to finish first.";
            return false;
        }

        const auto release = utils::finally([&config] { mods::release_install(config); });

        const auto record_id = mods::catalog_record_id(entry_id);
        const auto index = mods::read_index(config);
        const auto record = std::find_if(index.begin(), index.end(), [&record_id](const mods::installed_mod& mod) { return mod.id == record_id; });
        if (record == index.end())
        {
            error = "This mod is not installed.";
            return false;
        }

        const auto guards = load_guards(config);
        const auto owners = files_of_others(config, index, record_id);
        std::vector<std::pair<std::filesystem::path, std::filesystem::path>> folders{};
        size_t failed = 0;
        for (const auto& file : record->files)
        {
            if (!remove_recorded(config, file, guards, owners, folders))
            {
                ++failed;
            }
        }

        prune_folders(config, folders);

        // The record stays until every file is gone, so a retry can finish the job.
        if (failed)
        {
            error = std::to_string(failed) + (failed == 1 ? " file" : " files") + " could not be deleted. Close anything using them and try again.";
            return false;
        }

        mods::erase_index(config, record_id);
        utils::logger::write("[cbl-mods] uninstalled catalog entry {} ({} files)", entry_id, record->files.size());
        return true;
    }
}
