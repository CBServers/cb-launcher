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
                info.dest = array.Size() > 3 ? client_store::parse_file_dest(array[3]) : updater::file_dest::automatic;

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

        const char* file_dest_token(const updater::file_dest dest)
        {
            switch (dest)
            {
            case updater::file_dest::game: return "game";
            case updater::file_dest::appdata: return "appdata";
            default: return "";
            }
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

        // The install path is the game's, not the client's: a game's clients share one folder.
        std::filesystem::path resolve_install_path(const game_config::game_config_t& config)
        {
            const auto install_path_prop = config.get_install_path();
            if (!install_path_prop || install_path_prop->empty())
            {
                throw std::runtime_error("Game install path not set for: " + config.id);
            }

            return *install_path_prop;
        }
    }

    client_updater::client_updater(const game_config::game_config_t& config, const game_config::client_files_t& client,
        const std::vector<std::string>& skip_files, updater::ui_progress_listener* listener)
        : install_path(resolve_install_path(config)), paths_(install_path, client),
          client_id_(client.client_id), store_routed_(game_config::is_store_routed(config)),
          skip_files_(skip_files), progress_listener_(listener)
    {
        this->update_manifest_url_ = client.update_manifest_url;
        this->update_folder_url_ = client.update_folder_url;

        // Keyed on the client, so two clients of one game can't overwrite each other's cache
        // and diff away each other's files. Client ids are unique across all games.
        this->manifest_cache_path_ = client_store::manifest_cache_path(client.client_id);

        if (this->update_manifest_url_.empty() || this->update_folder_url_.empty())
        {
            return;
        }

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

        if (this->store_routed_)
        {
            client_store::sweep_store(this->client_id_, this->manifest_files_);
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
        if (this->store_routed_)
        {
            return client_store::store_path(this->client_id_) / utils::string::utf8_to_path(file.name);
        }

        return this->paths_.resolve_file(file.name, file.dest);
    }

    // Delete only names this client shipped last run and no longer ships, so foreign files
    // are structurally unreachable. Always resolves live destinations, even store-routed:
    // a dropped name's live copy is deleted here, its store copy by the sweep.
    void client_updater::remove_stale_files() const
    {
        // A failed manifest fetch yields an empty manifest, which would diff as "this client
        // ships nothing" and delete everything it ever installed.
        if (this->manifest_files_.empty() || this->client_data_folders_.empty() || this->manifest_cache_path_.empty())
        {
            return;
        }

        const auto cached_files = client_store::read_manifest_cache(this->client_id_);
        if (cached_files.empty())
        {
            return;
        }

        // Cache resolved under pre-dest rules but the manifest now carries dests: re-seed instead of diffing.
        const auto cache_is_legacy = std::all_of(cached_files.begin(), cached_files.end(),
            [](const client_store::cached_file& file) { return file.dest == updater::file_dest::automatic; });
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
            roots.emplace_back(this->paths_.resolve_data_dir(entry));
        }

        std::set<std::filesystem::path> directories_to_check{};

        for (const auto& cached : cached_files)
        {
            if (current_names.contains(cached.name))
            {
                continue;
            }

            const auto path = this->paths_.resolve_file(cached.name, cached.dest);

            const auto is_scoped = std::any_of(roots.begin(), roots.end(), [&path](const std::filesystem::path& root)
            {
                return client_store::is_inside_folder(path, root);
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
                const auto parent_key = client_store::path_key(parent);
                const auto inside_root = std::any_of(roots.begin(), roots.end(),
                    [&parent, &parent_key](const std::filesystem::path& root)
                {
                    return parent_key != client_store::path_key(root) && client_store::is_inside_folder(parent, root);
                });

                if (!inside_root)
                {
                    break;
                }

                directories_to_check.insert(parent);
            }
        }

        client_store::prune_empty_directories(directories_to_check);
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
        // behind for the next install to diff against. Same for the store subdir.
        if (!this->manifest_cache_path_.empty())
        {
            utils::io::remove_file(this->manifest_cache_path_);
        }

        if (this->store_routed_)
        {
            client_store::delete_store(this->client_id_);
        }

        if (this->valid_files_.empty())
        {
            return;
        }

        // Live destinations, not the store: uninstall removes them regardless of routing.
        std::vector<updater::file_info> files_to_delete;
        for (const auto& file : this->valid_files_)
        {
            const auto drive_name = this->paths_.resolve_file(file.name, file.dest);
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

            const auto drive_name = this->paths_.resolve_file(file.name, file.dest);
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
            const auto file_path = this->paths_.resolve_file(file.name, file.dest);
            auto parent = file_path.parent_path();
            const auto base = this->paths_.resolve_base(file.name, file.dest);

            while (parent != base && client_store::is_inside_folder(parent, base))
            {
                directories_to_check.insert(parent);
                parent = parent.parent_path();
            }
        }

        client_store::prune_empty_directories(directories_to_check);
    }

    bool client_updater::is_update_cancelled() const
    {
        return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
    }
}
