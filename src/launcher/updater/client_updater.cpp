#include <std_include.hpp>

#include "client_updater.hpp"

#include <utils/cryptography.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/compression.hpp>
#include <utils/string.hpp>
#include <utils/concurrency.hpp>
#include <utils/properties.hpp>

#include <rapidjson/writer.h>

namespace client_updater
{
    namespace
    {
        // Unknown tokens fall back to automatic: manifests are served to launcher builds we
        // don't control, so an unrecognised dest must never be a hard failure.
        updater::file_dest parse_file_dest(const std::string& token)
        {
            if (token == "game") return updater::file_dest::game;
            if (token == "appdata") return updater::file_dest::appdata;
            return updater::file_dest::automatic;
        }

        // Optional 4th manifest element: a bare string, or {"dest": "..."} for future flags.
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

        std::vector<updater::file_info> parse_file_infos(const std::string& json)
        {
            rapidjson::Document doc{};
            doc.Parse(json.data(), json.size());

            if (!doc.IsArray())
            {
                return {};
            }

            std::vector<updater::file_info> files{};

            for (const auto& element : doc.GetArray())
            {
                if (!element.IsArray())
                {
                    continue;
                }

                auto array = element.GetArray();
                if (array.Size() < 3 || !array[0].IsString() || !array[1].IsInt64() || !array[2].IsString())
                {
                    continue;
                }

                updater::file_info info{};
                info.name.assign(array[0].GetString(), array[0].GetStringLength());
                info.size = array[1].GetInt64();
                info.hash.assign(array[2].GetString(), array[2].GetStringLength());
                info.dest = array.Size() > 3 ? parse_file_dest(array[3]) : updater::file_dest::automatic;

                files.emplace_back(std::move(info));
            }

            return files;
        }

        std::string get_cache_buster()
        {
            return "?" + std::to_string(
                std::chrono::duration_cast<std::chrono::nanoseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count());
        }

        std::vector<updater::file_info> get_file_infos(const std::string& manifest_url)
        {
            const auto json = utils::http::get_data(manifest_url + get_cache_buster(), {}, {}, {}, 10L, 2U);
            if (!json || !json.has_value())
            {
                return {};
            }

            try
            {
                const auto& result = json.value();
                if (result.code != CURLE_OK)
                {
                    return {};
                }

                return parse_file_infos(result.buffer);
            }
            catch (...)
            {
                return {};
            }
        }

        std::string get_hash(const std::string& data)
        {
            return utils::cryptography::sha1::compute(data, true);
        }

        std::vector<updater::file_info> find_file_infos(const std::vector<std::string>& file_names, const std::vector<updater::file_info>& files)
        {
            std::unordered_set<std::string> name_set(file_names.begin(), file_names.end());
            std::vector<updater::file_info> file_infos{};
            file_infos.reserve(file_names.size());

            for (const auto& file : files)
            {
                if (name_set.find(file.name) != name_set.end())
                {
                    file_infos.emplace_back(file);
                }
            }

            return file_infos;
        }

        size_t get_optimal_concurrent_download_count(const size_t file_count)
        {
            size_t cores = std::thread::hardware_concurrency();
            cores = (cores * 2) / 3;
            return std::max(1ull, std::min(cores, file_count));
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

        // Deepest-first, so a nested directory is gone before its parent is tested.
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

        // Comparable key for a path: absolute, normalized separators, case-folded like the filesystem itself
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

        // One entry of the applied-manifest cache: the manifest name plus the dest it was
        // resolved with, so a later config change can't silently repoint an old name.
        struct cached_file
        {
            std::string name;
            updater::file_dest dest;
        };

        const char* file_dest_token(const updater::file_dest dest)
        {
            switch (dest)
            {
            case updater::file_dest::game: return "game";
            case updater::file_dest::appdata: return "appdata";
            default: return "";
            }
        }

        std::vector<cached_file> read_manifest_cache(const std::filesystem::path& path)
        {
            std::string data{};
            if (!utils::io::read_file(path, &data) || data.empty())
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

        bool write_manifest_cache(const std::filesystem::path& path, const std::vector<updater::file_info>& files)
        {
            rapidjson::Document doc{rapidjson::kArrayType};
            auto& allocator = doc.GetAllocator();

            for (const auto& file : files)
            {
                rapidjson::Value name{};
                name.SetString(file.name.data(), static_cast<rapidjson::SizeType>(file.name.size()), allocator);

                if (file.dest == updater::file_dest::automatic)
                {
                    doc.PushBack(name, allocator);
                    continue;
                }

                rapidjson::Value entry{rapidjson::kArrayType};
                entry.PushBack(name, allocator);
                entry.PushBack(rapidjson::StringRef(file_dest_token(file.dest)), allocator);
                doc.PushBack(entry, allocator);
            }

            rapidjson::StringBuffer buffer{};
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            doc.Accept(writer);

            return utils::io::write_file(path, std::string{buffer.GetString(), buffer.GetSize()}, false);
        }
    }

    client_updater::client_updater(const game_config::game_config_t& config, const game_config::client_files_t& client,
        const std::vector<std::string>& skip_files, updater::ui_progress_listener* listener)
        : skip_files_(skip_files), progress_listener_(listener)
    {
        // The install path is the game's, not the client's: a game's clients all live in the
        // same folder (CoD4x/IW3SP-Mod/IW3x, and mwr/hmw today).
        const auto install_path_prop = config.get_install_path();
        if (!install_path_prop || install_path_prop->empty())
        {
            throw std::runtime_error("Game install path not set for: " + config.id);
        }

        if (install_path_prop.has_value())
        {
            this->install_path = *install_path_prop;
        }

        this->update_manifest_url_ = client.update_manifest_url;
        this->update_folder_url_ = client.update_folder_url;

        // Keyed on the client, so two clients of one game can't overwrite each other's cache
        // and diff away each other's files. Client ids are unique across all games.
        this->manifest_cache_path_ = utils::properties::get_appdata_path() / "client-manifest"
            / (client.client_id + ".json");

        if (this->update_manifest_url_.empty() || this->update_folder_url_.empty())
        {
            return;
        }

        this->client_default_path_ = client.client_default_path.empty() ? this->install_path : client.client_default_path;
        this->client_install_path_files_ = client.client_install_path_files;
        this->client_data_folders_ = client.client_data_folders;

        // Fetch manifest and compute valid files
        const auto manifest_files = get_file_infos(this->update_manifest_url_);
        this->manifest_fetch_failed_ = manifest_files.empty();
        this->manifest_files_ = manifest_files;
        this->valid_files_ = client.required_updater_files.empty() ? manifest_files : find_file_infos(client.required_updater_files, manifest_files);

        // Filter out files that should be skipped
        std::unordered_set<std::string> skip_set(skip_files.begin(), skip_files.end());
        if (!skip_set.empty())
        {
            std::erase_if(this->valid_files_, [&skip_set](const updater::file_info& file)
            {
                return skip_set.contains(file.name);
            });
        }
    }

    void client_updater::run() const
    {
        if (this->valid_files_.empty())
        {
            return;
        }

        this->remove_stale_files();

        // Initialize progress tracking for verification phase
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(this->valid_files_, updater::progress_mode::verifying);
        }

        const auto outdated_files = this->get_outdated_files(this->valid_files_);
        if (outdated_files.empty())
        {
            this->store_applied_manifest();
            return;
        }

        // Reset progress tracking for download phase with only outdated files
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(outdated_files, updater::progress_mode::downloading);
        }

        this->update_files(outdated_files);
        this->store_applied_manifest();

        std::this_thread::sleep_for(1s);
    }

    void client_updater::update_file(const updater::file_info& file) const
    {
        auto url = this->update_folder_url_ + utils::string::url_encode_path(file.name) + "?" + file.hash;
        utils::logger::write("Updating file {}", url);

        // Notify progress listener that file download is beginning
        if (this->progress_listener_)
        {
            this->progress_listener_->begin_file(file);
        }

        size_t last_progress = 0;
        const auto data = utils::http::get_data(url, {}, {}, [&](size_t progress, [[maybe_unused]] size_t total, [[maybe_unused]] size_t speed) -> bool
        {
            // Notify progress listener of download progress
            // Note: progress is cumulative bytes downloaded, so we calculate the delta
            if (this->progress_listener_)
            {
                const size_t delta = progress - last_progress;
                last_progress = progress;
                this->progress_listener_->file_progress(file, delta);
            }

            return !is_update_cancelled(); // Continue unless cancelled
        });

        if (!data || !data.has_value())
        {
            throw std::runtime_error(utils::string::va("Failed to download: %s - Data has no value", url.data()));
        }

        try
        {
            const auto& result = data.value();
            if (result.code == CURLE_ABORTED_BY_CALLBACK)
            {
                return;
            }

            if (result.code != CURLE_OK)
            {
                throw std::runtime_error(utils::string::va("Failed to download: %s - Invalid curl code (%u)", url.data(), result.code));
            }

            const auto result_size = result.buffer.size();
            if (result_size != file.size)
            {
                throw std::runtime_error(utils::string::va("Failed to download: %s - %zu != %zu", url.data(), result_size, file.size));
            }

            const auto result_hash = get_hash(result.buffer);
            if (result_hash != file.hash)
            {
                throw std::runtime_error(utils::string::va("Failed to download: %s - %s != %s", url.data(), result_hash.data(), file.hash.data()));
            }

            const auto out_file = this->get_drive_filename(file);
            if (!utils::io::write_file(out_file, result.buffer, false))
            {
                utils::logger::write("Failed to write {}. Error code: ", file.name,
                    std::system_category().message(static_cast<int>(::GetLastError())));
                throw std::runtime_error(utils::string::va("Failed to write: %s", out_file.string().data()));
            }

            utils::logger::write("Done updating file {}", file.name);

            // Notify progress listener that file is complete
            if (this->progress_listener_)
            {
                this->progress_listener_->end_file(file);
            }
        }
        catch (const std::exception& e)
        {
            throw std::runtime_error(utils::string::va("Failed to update host file: %s", e.what()));
        }
        catch (...)
        {
            throw std::runtime_error("Unknown error occurred while updating host file");
        }
    }

    std::vector<updater::file_info> client_updater::get_outdated_files(const std::vector<updater::file_info>& files) const
    {
        std::vector<updater::file_info> outdated_files{};

        for (const auto& info : files)
        {
            // Block here while paused; resume signals the cv. Cancellation is observed
            // separately via the existing libcurl-callback path or the next iteration.
            if (this->progress_listener_)
            {
                this->progress_listener_->wait_if_paused();
            }

            // Report that we're starting to verify this file
            if (this->progress_listener_)
            {
                this->progress_listener_->begin_file(info);
            }

            if (this->is_outdated_file(info))
            {
                outdated_files.emplace_back(info);
            }

            // Mark file as verified by adding its size to progress
            if (this->progress_listener_)
            {
                this->progress_listener_->file_progress(info, info.size);
            }

            // Report that we've finished verifying this file
            if (this->progress_listener_)
            {
                this->progress_listener_->end_file(info);
            }
        }

        return outdated_files;
    }

    void client_updater::update_files(const std::vector<updater::file_info>& outdated_files) const
    {
        const auto thread_count = get_optimal_concurrent_download_count(outdated_files.size());

        std::vector<std::thread> threads{};
        std::atomic<size_t> current_index{0};

        utils::concurrency::container<std::exception_ptr> exception{};

        for (size_t i = 0; i < thread_count; ++i)
        {
            threads.emplace_back([&]()
            {
                while (!exception.access<bool>([](const std::exception_ptr& ptr)
                {
                    return static_cast<bool>(ptr);
                }))
                {
                    // Block here while paused; resume signals the cv.
                    if (this->progress_listener_)
                        this->progress_listener_->wait_if_paused();
                    if (is_update_cancelled()) break;

                    const auto index = current_index++;
                    if (index >= outdated_files.size())
                    {
                        break;
                    }

                    try
                    {
                        const auto& file = outdated_files[index];
                        this->update_file(file);
                    }
                    catch (...)
                    {
                        exception.access([](std::exception_ptr& ptr)
                        {
                            ptr = std::current_exception();
                        });

                        return;
                    }
                }
            });
        }

        for (auto& thread : threads)
        {
            if (thread.joinable())
            {
                thread.join();
            }
        }

        exception.access([](const std::exception_ptr& ptr)
        {
            if (ptr)
            {
                std::rethrow_exception(ptr);
            }
        });
    }

    bool client_updater::is_outdated_file(const updater::file_info& file) const
    {
        std::string data{};
        const auto drive_name = this->get_drive_filename(file);
        if (!utils::io::read_file(drive_name, &data))
        {
            return true;
        }

        if (data.size() != file.size)
        {
            return true;
        }

        const auto hash = get_hash(data);
        return hash != file.hash;
    }

    std::filesystem::path client_updater::get_drive_filename(const updater::file_info& file) const
    {
        return this->resolve_drive_path(file.name, file.dest);
    }

    std::filesystem::path client_updater::resolve_drive_path(const std::string& name, const updater::file_dest dest) const
    {
        return this->resolve_base_path(name, dest) / name;
    }

    std::filesystem::path client_updater::resolve_base_path(const std::string& name, const updater::file_dest dest) const
    {
        if (dest == updater::file_dest::game)
        {
            return this->install_path;
        }

        if (dest == updater::file_dest::appdata)
        {
            return this->client_default_path_;
        }

        if (this->client_install_path_files_.empty())
        {
            return this->client_default_path_;
        }

        if (this->client_install_path_files_.contains(name))
        {
            return this->install_path;
        }

        for (const auto& entry : this->client_install_path_files_)
        {
            const auto star = entry.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = entry.substr(0, star);
            if (utils::string::starts_with(name, prefix))
            {
                return this->install_path;
            }
        }

        return this->client_default_path_;
    }

    std::filesystem::path client_updater::resolve_data_dir(const game_config::data_folder_t& entry) const
    {
        const auto& folder = entry.folder;

        if (entry.dest == updater::file_dest::game)
        {
            return this->install_path / folder;
        }

        if (entry.dest == updater::file_dest::appdata)
        {
            return this->client_default_path_ / folder;
        }

        if (this->client_install_path_files_.empty())
        {
            return this->client_default_path_ / folder;
        }

        if (this->client_install_path_files_.contains(folder))
        {
            return this->install_path / folder;
        }

        for (const auto& file : this->client_install_path_files_)
        {
            const auto star = file.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = file.substr(0, star);
            const auto folder_slash = folder + "/";
            if (utils::string::starts_with(folder_slash, prefix) ||
                utils::string::starts_with(prefix, folder_slash))
            {
                return this->install_path / folder;
            }
        }

        return this->client_default_path_ / folder;
    }

    // Delete only names this client shipped last run and no longer ships. A file the launcher
    // never wrote is never a delete candidate, so foreign files (fork self-updates, server
    // downloads, hand-dropped files) are structurally unreachable.
    void client_updater::remove_stale_files() const
    {
        // A failed manifest fetch yields an empty manifest, which would diff as "this client
        // ships nothing" and delete everything it ever installed.
        if (this->manifest_files_.empty() || this->client_data_folders_.empty() || this->manifest_cache_path_.empty())
        {
            return;
        }

        const auto cached_files = read_manifest_cache(this->manifest_cache_path_);
        if (cached_files.empty())
        {
            return;
        }

        // Cache resolved under pre-dest rules but the manifest now carries dests: re-seed instead of diffing.
        const auto cache_is_legacy = std::all_of(cached_files.begin(), cached_files.end(),
            [](const cached_file& file) { return file.dest == updater::file_dest::automatic; });
        const auto manifest_has_dest = std::any_of(this->manifest_files_.begin(), this->manifest_files_.end(),
            [](const updater::file_info& file) { return file.dest != updater::file_dest::automatic; });

        if (cache_is_legacy && manifest_has_dest)
        {
            return;
        }

        std::unordered_set<std::string> current_names{};
        current_names.reserve(this->manifest_files_.size());
        for (const auto& file : this->manifest_files_)
        {
            current_names.emplace(file.name);
        }

        // Same blast radius as the sweep this replaced: only inside a resolved data folder.
        std::vector<std::filesystem::path> roots{};
        roots.reserve(this->client_data_folders_.size());
        for (const auto& entry : this->client_data_folders_)
        {
            roots.emplace_back(this->resolve_data_dir(entry));
        }

        std::set<std::filesystem::path> directories_to_check{};

        for (const auto& cached : cached_files)
        {
            if (current_names.contains(cached.name))
            {
                continue;
            }

            const auto path = this->resolve_drive_path(cached.name, cached.dest);

            const auto is_scoped = std::any_of(roots.begin(), roots.end(), [&path](const std::filesystem::path& root)
            {
                return is_inside_folder(path, root);
            });

            if (!is_scoped || !utils::io::file_exists(path))
            {
                continue;
            }

            if (!utils::io::remove_file(path))
            {
                utils::logger::write("Failed to remove stale client file {}", cached.name);
                continue;
            }

            utils::logger::write("Removed stale client file {}", cached.name);

            // Walk up to (but never including) the data folder root, so the root survives an
            // empty client the same way it did under the sweep.
            for (auto parent = path.parent_path(); !parent.empty() && parent != parent.parent_path();
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

        prune_empty_directories(directories_to_check);
    }

    void client_updater::store_applied_manifest() const
    {
        // Cancellation doesn't throw (an aborted download returns quietly), so a partial run
        // reaches here looking successful. Leave the old cache so the diff is retried.
        if (this->manifest_files_.empty() || this->manifest_cache_path_.empty() || this->is_update_cancelled())
        {
            return;
        }

        if (!write_manifest_cache(this->manifest_cache_path_, this->manifest_files_))
        {
            utils::logger::write("Failed to write client manifest cache {}",
                utils::string::path_to_utf8(this->manifest_cache_path_));
        }
    }

    void client_updater::delete_client() const
    {
        // Before the empty-manifest bail: an uninstall done offline must not leave a cache
        // behind for the next install to diff against.
        if (!this->manifest_cache_path_.empty())
        {
            utils::io::remove_file(this->manifest_cache_path_);
        }

        if (this->valid_files_.empty())
        {
            return;
        }

        // Collect files that exist on disk
        std::vector<updater::file_info> files_to_delete;
        for (const auto& file : this->valid_files_)
        {
            const auto drive_name = this->get_drive_filename(file);
            if (utils::io::file_exists(drive_name))
            {
                files_to_delete.push_back(file);
            }
        }

        if (files_to_delete.empty())
        {
            return;
        }

        // Initialize progress tracking for deletion phase
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(files_to_delete, updater::progress_mode::deleting);
        }

        for (const auto& file : files_to_delete)
        {
            if (this->progress_listener_)
            {
                this->progress_listener_->begin_file(file);
            }

            const auto drive_name = this->get_drive_filename(file);
            if (!utils::io::remove_file(drive_name))
            {
                printf("Warning: Failed to delete client file: %s\n", drive_name.string().data());
            }

            if (this->progress_listener_)
            {
                this->progress_listener_->file_progress(file, file.size);
                this->progress_listener_->end_file(file);
            }
        }

        // Clean up empty directories (deepest first)
        std::set<std::filesystem::path> directories_to_check;
        for (const auto& file : files_to_delete)
        {
            const auto file_path = this->get_drive_filename(file);
            auto parent = file_path.parent_path();
            const auto base = this->resolve_base_path(file.name, file.dest);

            while (parent != base && is_inside_folder(parent, base))
            {
                directories_to_check.insert(parent);
                parent = parent.parent_path();
            }
        }

        prune_empty_directories(directories_to_check);
    }

    bool client_updater::is_update_cancelled() const
    {
        return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
    }
}
