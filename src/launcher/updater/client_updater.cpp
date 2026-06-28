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

                updater::file_info info{};
                info.name.assign(array[0].GetString(), array[0].GetStringLength());
                info.size = array[1].GetInt64();
                info.hash.assign(array[2].GetString(), array[2].GetStringLength());

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
            const auto relative = std::filesystem::relative(file, folder);
            const auto start = relative.begin();
            return start != relative.end() && start->string() != "..";
        }
    }

    client_updater::client_updater(const game_config::game_config_t& config, const std::vector<std::string>& skip_files, updater::ui_progress_listener* listener)
        : skip_files_(skip_files), progress_listener_(listener)
    {
        const auto install_path_prop = config.get_install_path();
        if (!install_path_prop || install_path_prop->empty())
        {
            throw std::runtime_error("Game install path not set for: " + config.id);
        }

        if (install_path_prop.has_value())
        {
            this->install_path = *install_path_prop;
        }

        this->update_manifest_url_ = config.update_manifest_url;
        this->update_folder_url_ = config.update_folder_url;

        if (this->update_manifest_url_.empty() || this->update_folder_url_.empty())
        {
            return;
        }

        this->client_default_path_ = config.client_default_path.empty() ? this->install_path : config.client_default_path;
        this->client_install_path_files_ = config.client_install_path_files;
        this->client_data_folders_ = config.client_data_folders;

        // Fetch manifest and compute valid files
        const auto manifest_files = get_file_infos(this->update_manifest_url_);
        this->manifest_files_ = manifest_files;
        this->valid_files_ = config.required_updater_files.empty() ? manifest_files : find_file_infos(config.required_updater_files, manifest_files);

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

        this->cleanup_data_directories();

        // Initialize progress tracking for verification phase
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(this->valid_files_, updater::progress_mode::verifying);
        }

        const auto outdated_files = this->get_outdated_files(this->valid_files_);
        if (outdated_files.empty())
        {
            return;
        }

        // Reset progress tracking for download phase with only outdated files
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(outdated_files, updater::progress_mode::downloading);
        }

        this->update_files(outdated_files);

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
        return this->resolve_drive_path(file.name);
    }

    std::filesystem::path client_updater::resolve_drive_path(const std::string& name) const
    {
        if (this->client_install_path_files_.empty())
        {
            return this->client_default_path_ / name;
        }

        if (this->client_install_path_files_.contains(name))
        {
            return this->install_path / name;
        }

        for (const auto& entry : this->client_install_path_files_)
        {
            const auto star = entry.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = entry.substr(0, star);
            if (utils::string::starts_with(name, prefix))
            {
                return this->install_path / name;
            }
        }

        return this->client_default_path_ / name;
    }

    std::filesystem::path client_updater::resolve_data_dir(const std::string& folder) const
    {
        if (this->client_install_path_files_.empty())
        {
            return this->client_default_path_ / folder;
        }

        if (this->client_install_path_files_.contains(folder))
        {
            return this->install_path / folder;
        }

        for (const auto& entry : this->client_install_path_files_)
        {
            const auto star = entry.find('*');
            if (star == std::string::npos) continue;
            const auto prefix = entry.substr(0, star);
            const auto folder_slash = folder + "/";
            if (utils::string::starts_with(folder_slash, prefix) ||
                utils::string::starts_with(prefix, folder_slash))
            {
                return this->install_path / folder;
            }
        }

        return this->client_default_path_ / folder;
    }

    void client_updater::cleanup_data_directories() const
    {
        if (this->client_data_folders_.empty() || this->manifest_files_.empty())
        {
            return;
        }

        std::vector<std::filesystem::path> legal_files{};
        legal_files.reserve(this->manifest_files_.size());
        for (const auto& file : this->manifest_files_)
        {
            legal_files.emplace_back(std::filesystem::absolute(this->get_drive_filename(file)));
        }

        for (const auto& folder : this->client_data_folders_)
        {
            const auto data_dir = this->resolve_data_dir(folder);
            if (!utils::io::directory_exists(data_dir))
            {
                continue;
            }

            const auto existing_files = utils::io::list_files(data_dir, true);
            for (auto& entry : existing_files)
            {
                const auto is_file = std::filesystem::is_regular_file(entry);
                const auto is_folder = std::filesystem::is_directory(entry);

                if (is_file || is_folder)
                {
                    bool is_legal = false;

                    for (const auto& legal_file : legal_files)
                    {
                        if ((is_folder && is_inside_folder(legal_file, entry)) ||
                            (is_file && legal_file == entry))
                        {
                            is_legal = true;
                            break;
                        }
                    }

                    if (is_legal)
                    {
                        continue;
                    }
                }

                std::error_code code{};
                std::filesystem::remove_all(entry, code);
            }
        }
    }

    void client_updater::delete_client() const
    {
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
            const auto& base = (this->client_install_path_files_.contains(file.name))
                ? this->install_path : this->client_default_path_;

            while (parent != base && is_inside_folder(parent, base))
            {
                directories_to_check.insert(parent);
                parent = parent.parent_path();
            }
        }

        std::vector<std::filesystem::path> sorted_dirs(directories_to_check.begin(), directories_to_check.end());
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

    bool client_updater::is_update_cancelled() const
    {
        return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
    }
}
