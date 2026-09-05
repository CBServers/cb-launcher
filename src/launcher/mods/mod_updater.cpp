#include "std_include.hpp"
#include "mod_updater.hpp"
#include "updater/client_store.hpp"

#include <utils/cdn.hpp>
#include <utils/flags.hpp>
#include <utils/hash.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/string.hpp>

namespace mod_updater
{
    namespace
    {
        constexpr auto CACHE_OK_TTL = std::chrono::minutes(5);
        constexpr auto CACHE_FAIL_TTL = std::chrono::seconds(60);

        struct cache_entry
        {
            std::chrono::steady_clock::time_point fetched_at{};
            bool ok{};
            std::vector<override_entry> overrides;
        };

        std::mutex cache_mutex_;
        std::unordered_map<std::string, cache_entry> cache_;

        struct manifest_file
        {
            std::string name;
            uint64_t size{};
            std::string hash;
        };

        std::string game_base_url(const game_config::game_config_t& config)
        {
            return utils::cdn::cdn_manager::instance().get_active_cdn_url() + "mods/" + config.game_key + "/";
        }

        // Manifest names become paths under the mod folder, so only plain relative ones pass.
        bool is_safe_manifest_name(const std::string& name)
        {
            if (name.empty() || name.front() == '/' || name.front() == '\\' || name.find(':') != std::string::npos)
            {
                return false;
            }

            for (const auto& part : utils::string::split(utils::string::replace(name, "\\", "/"), '/'))
            {
                if (part.empty() || part == "." || part == "..")
                {
                    return false;
                }
            }

            return true;
        }

        std::string normalize_name(const std::string& name)
        {
            return utils::string::to_lower(utils::string::replace(name, "\\", "/"));
        }

        std::optional<std::filesystem::path> resolve_target(const std::filesystem::path& root, const std::string& name)
        {
            if (!is_safe_manifest_name(name))
            {
                return std::nullopt;
            }

            auto path = (root / utils::string::utf8_to_path(name)).lexically_normal();
            return client_store::is_inside_folder(path, root) ? std::optional{std::move(path)} : std::nullopt;
        }

        std::vector<manifest_file> parse_manifest(const std::string& json)
        {
            rapidjson::Document doc{};
            doc.Parse(json.data(), json.size());
            if (doc.HasParseError() || !doc.IsObject() || !doc.HasMember("files") || !doc["files"].IsArray())
            {
                return {};
            }

            std::vector<manifest_file> files{};
            for (const auto& element : doc["files"].GetArray())
            {
                if (!element.IsArray() || element.Size() < 3
                    || !element[0].IsString() || !element[1].IsUint64() || !element[2].IsString())
                {
                    return {};
                }

                files.push_back({element[0].GetString(), element[1].GetUint64(), element[2].GetString()});
            }

            return files;
        }

        std::vector<override_entry> parse_overrides(const std::string& json)
        {
            rapidjson::Document doc{};
            doc.Parse(json.data(), json.size());
            if (doc.HasParseError() || !doc.IsObject())
            {
                return {};
            }

            std::vector<override_entry> result{};
            for (auto it = doc.MemberBegin(); it != doc.MemberEnd(); ++it)
            {
                if (!it->value.IsObject())
                {
                    continue;
                }

                override_entry entry{};
                entry.id.assign(it->name.GetString(), it->name.GetStringLength());
                entry.version = mods::json_string(it->value, "version");
                entry.kind = mods::json_string(it->value, "kind");
                if (it->value.HasMember("size") && it->value["size"].IsUint64())
                {
                    entry.size = it->value["size"].GetUint64();
                }

                if (it->value.HasMember("children") && it->value["children"].IsArray())
                {
                    for (const auto& child : it->value["children"].GetArray())
                    {
                        const auto child_id = mods::json_string(child, "id");
                        const auto child_size = child.IsObject() && child.HasMember("size") && child["size"].IsUint64()
                            ? child["size"].GetUint64() : 0;
                        if (!child_id.empty())
                        {
                            entry.children.push_back({child_id, child_size});
                        }
                    }
                }

                // Keys are workshop ids and become directory names, so digits only.
                const auto id_valid = !entry.id.empty() && std::all_of(entry.id.begin(), entry.id.end(),
                    [](const unsigned char c) { return std::isdigit(c); });
                if (id_valid && !entry.version.empty())
                {
                    result.push_back(std::move(entry));
                }
            }

            return result;
        }

        std::string download_file(const std::string& item_url, const manifest_file& file,
            const std::filesystem::path& target, const std::function<bool(uint64_t)>& on_progress)
        {
            if (target.has_parent_path())
            {
                utils::io::create_directory(target.parent_path());
            }

            if (file.size == 0)
            {
                return utils::io::write_file(target, std::string{}) ? std::string{} : "Failed to write " + file.name;
            }

            auto part = target;
            part += "." + file.hash + ".part";

            // The .part's size on disk is the resume offset, mirroring the game updater.
            std::size_t offset = utils::io::file_size(part);
            if (offset > file.size)
            {
                utils::io::remove_file(part);
                offset = 0;
            }

            std::ofstream ofs(part, std::ios::binary | (offset > 0 ? std::ios::app : std::ios::trunc));
            if (!ofs)
            {
                return "Failed to open " + utils::string::path_to_utf8(part);
            }

            // Only a download starting at byte 0 can be hashed as it streams.
            std::optional<utils::hash::stream_hasher> hasher{};
            if (offset == 0)
            {
                hasher.emplace();
            }

            auto cancelled = false;
            auto write_failed = false;
            uint64_t received = offset;

            if (offset < file.size)
            {
                const auto url = item_url + utils::string::url_encode_path(file.name) + "?" + file.hash;
                const auto data = utils::http::get_data_stream(url, {}, {}, {},
                    [&](const char* chunk, const size_t size) -> bool
                    {
                        if (chunk && size > 0)
                        {
                            ofs.write(chunk, static_cast<std::streamsize>(size));
                            if (!ofs)
                            {
                                write_failed = true;
                                return false;
                            }

                            if (hasher)
                            {
                                hasher->update(chunk, size);
                            }

                            received += size;
                        }

                        if (!on_progress(received))
                        {
                            cancelled = true;
                            return false;
                        }

                        return true;
                    },
                    [&]() -> bool { return !write_failed && !cancelled; },
                    0, 5, offset);

                ofs.flush();
                const auto flush_failed = !ofs;
                ofs.close();

                if (cancelled)
                {
                    return "cancelled"; // the part stays behind as the resume point
                }

                if (write_failed || flush_failed)
                {
                    utils::io::remove_file(part);
                    return "Failed to write " + utils::string::path_to_utf8(part) + ", the disk may be full or write-protected";
                }

                if (!data)
                {
                    return "Failed to download " + file.name;
                }

                if (data->range_ignored || data->response_code == 416)
                {
                    // What we hold can't be extended; drop it so the retry refetches whole.
                    utils::io::remove_file(part);
                    return "Resume rejected for " + file.name;
                }

                if (data->code != CURLE_OK)
                {
                    return utils::string::va("Failed to download %s, CURL error %d", file.name.data(), data->code);
                }
            }
            else
            {
                ofs.close();
            }

            if (utils::io::file_size(part) != file.size)
            {
                utils::io::remove_file(part);
                return "Size mismatch for " + file.name;
            }

            const auto hash = hasher ? hasher->digest() : utils::hash::get_file_hash(part);
            if (hash != file.hash)
            {
                utils::io::remove_file(part);
                return "Hash mismatch for " + file.name;
            }

            if (!utils::io::move_file_replace(part, target))
            {
                return "Failed to move " + file.name + " into place";
            }

            return {};
        }

        // The mod folder is wholly owned by the manifest: leftovers from another
        // version would ship files this release never had (and break downgrades).
        void remove_unmanifested(const std::filesystem::path& target, const std::vector<manifest_file>& files)
        {
            std::unordered_set<std::string> keep{};
            for (const auto& file : files)
            {
                keep.insert(normalize_name(file.name));
            }

            std::vector<std::filesystem::path> extras{};
            std::vector<std::filesystem::path> directories{};
            std::error_code code{};
            for (std::filesystem::recursive_directory_iterator it(target, code), end; !code && it != end; it.increment(code))
            {
                std::error_code entry_code{};
                if (it->is_directory(entry_code))
                {
                    directories.push_back(it->path());
                    continue;
                }

                const auto relative = std::filesystem::relative(it->path(), target, entry_code);
                if (entry_code || keep.contains(normalize_name(utils::string::path_to_utf8(relative))))
                {
                    continue;
                }

                extras.push_back(it->path());
            }

            for (const auto& extra : extras)
            {
                utils::io::remove_file(extra);
            }

            // Deepest first, so a directory whose children just vanished reads as empty.
            std::sort(directories.begin(), directories.end(), [](const auto& a, const auto& b)
            {
                return std::distance(a.begin(), a.end()) > std::distance(b.begin(), b.end());
            });

            for (const auto& directory : directories)
            {
                std::error_code remove_code{};
                if (std::filesystem::exists(directory, remove_code) && std::filesystem::is_empty(directory, remove_code))
                {
                    std::filesystem::remove(directory, remove_code);
                }
            }
        }
    }

    std::vector<override_entry> get_overrides(const game_config::game_config_t& config)
    {
        if (utils::flags::has_flag("offline"))
        {
            return {};
        }

        {
            std::lock_guard lock(cache_mutex_);
            const auto it = cache_.find(config.game_key);
            if (it != cache_.end())
            {
                const auto ttl = it->second.ok ? std::chrono::steady_clock::duration(CACHE_OK_TTL) : std::chrono::steady_clock::duration(CACHE_FAIL_TTL);
                if (std::chrono::steady_clock::now() - it->second.fetched_at < ttl)
                {
                    return it->second.overrides;
                }
            }
        }

        const auto data = utils::http::get_data(game_base_url(config) + "overrides.json", {}, {}, {}, 20, 2);

        // A 404 is authoritative: this game simply has no overrides published.
        const auto ok = data && data->code == CURLE_OK && (data->response_code == 200 || data->response_code == 404);
        auto overrides = ok && data->response_code == 200 ? parse_overrides(data->buffer) : std::vector<override_entry>{};
        if (!ok)
        {
            utils::logger::write("[cbl-mods] failed to fetch mod overrides for {}", config.game_key);
        }

        std::lock_guard lock(cache_mutex_);
        auto& entry = cache_[config.game_key];
        entry.fetched_at = std::chrono::steady_clock::now();
        entry.ok = ok;
        entry.overrides = overrides;
        return overrides;
    }

    std::optional<override_entry> find_override(const game_config::game_config_t& config, const std::string& workshop_id)
    {
        for (auto& entry : get_overrides(config))
        {
            if (entry.id == workshop_id)
            {
                return std::move(entry);
            }
        }

        return std::nullopt;
    }

    std::string sync_item(const game_config::game_config_t& config, const override_entry& entry,
                          const std::filesystem::path& target, const mods::progress_callback& progress)
    {
        const auto item_url = game_base_url(config) + entry.id + "/";
        const auto report = [&progress, &entry](const std::string& phase, const int percent)
        {
            return !progress || progress(phase, entry.id, percent);
        };

        if (!report("preparing", 0))
        {
            return "cancelled";
        }

        const auto manifest_data = utils::http::get_data(item_url + "manifest.json", {}, {}, {}, 30, 3);
        if (!manifest_data || manifest_data->code != CURLE_OK || manifest_data->response_code != 200)
        {
            return "Failed to download the mod manifest.";
        }

        const auto files = parse_manifest(manifest_data->buffer);
        if (files.empty())
        {
            return "The mod manifest is invalid.";
        }

        utils::io::create_directory(target);

        // Verify pass: only files whose size or hash differs are fetched.
        std::vector<manifest_file> outdated{};
        uint64_t outdated_bytes = 0;
        for (const auto& file : files)
        {
            if (!report("preparing", 0))
            {
                return "cancelled";
            }

            const auto path = resolve_target(target, file.name);
            if (!path)
            {
                return "The mod manifest contains an unsafe path: " + file.name;
            }

            if (utils::io::file_exists(*path) && utils::io::file_size(*path) == file.size
                && (file.size == 0 || utils::hash::get_file_hash(*path) == file.hash))
            {
                continue;
            }

            outdated.push_back(file);
            outdated_bytes += file.size;
        }

        const auto total_bytes = std::max<uint64_t>(outdated_bytes, 1);
        uint64_t completed_bytes = 0;

        for (const auto& file : outdated)
        {
            const auto on_progress = [&](const uint64_t current)
            {
                const auto done = completed_bytes + std::min<uint64_t>(current, file.size);
                return report("downloading", static_cast<int>(std::min<uint64_t>(done * 100 / total_bytes, 99)));
            };

            std::string error{};
            // One retry: a hash mismatch drops the partial, so the second pass refetches whole.
            for (auto attempt = 0; attempt < 2; ++attempt)
            {
                error = download_file(item_url, file, *resolve_target(target, file.name), on_progress);
                if (error.empty() || error == "cancelled")
                {
                    break;
                }

                utils::logger::write("[cbl-mods] retrying {}: {}", file.name, error);
            }

            if (!error.empty())
            {
                return error;
            }

            completed_bytes += file.size;
        }

        remove_unmanifested(target, files);
        report("installing", 99);
        return {};
    }
}
