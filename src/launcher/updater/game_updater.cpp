#include <std_include.hpp>

#include "updater.hpp"
#include "game_updater.hpp"

#include <utils/flags.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/concurrency.hpp>
#include <utils/hash.hpp>
#include <utils/string.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

//#define MULTITHREAD_DOWNLOAD

namespace game_updater
{
    namespace
    {
        std::string get_filename(const std::filesystem::path path)
        {
            return path.filename().string();
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

                updater::file_info info{};
                info.name.assign(array[0].GetString(), array[0].GetStringLength());
                info.size = array[1].GetInt64();
                info.hash.assign(array[2].GetString(), array[2].GetStringLength());

                files.emplace_back(std::move(info));
            }

            return files;
        }

        update_manifest parse_manifest(const std::string& json)
        {
            update_manifest manifest;

            rapidjson::Document doc{};
            doc.Parse(json.data(), json.size());

            if (doc.HasParseError() || !doc.IsObject())
            {
                return {};
            }

            if (doc.HasMember("ManifestHash") && doc["ManifestHash"].IsString())
            {
                manifest.hash = doc["ManifestHash"].GetString();
            }
            else
            {
                return {};
            }

            if (doc.HasMember("files") && doc["files"].IsArray())
            {
                const rapidjson::Value& filesArray = doc["files"];
                for (rapidjson::SizeType i = 0; i < filesArray.Size(); ++i)
                {
                    const rapidjson::Value& fileEntry = filesArray[i];
                    updater::file_info info;
                    info.name = fileEntry[0].GetString();
                    info.size = fileEntry[1].GetUint64();
                    info.hash = fileEntry[2].GetString();

                    // Component field is optional (4th element) - defaults to "base" for backward compatibility
                    if (fileEntry.Size() >= 4 && fileEntry[3].IsString())
                    {
                        info.component = fileEntry[3].GetString();
                    }
                    else
                    {
                        info.component = "base";
                    }

                    manifest.files.push_back(info);
                }
            }
            else
            {
                return {};
            }

            // Parse components metadata (optional)
            if (doc.HasMember("components") && doc["components"].IsObject())
            {
                const rapidjson::Value& componentsObj = doc["components"];
                for (auto it = componentsObj.MemberBegin(); it != componentsObj.MemberEnd(); ++it)
                {
                    component_info comp;
                    comp.id = it->name.GetString();

                    const auto& compData = it->value;
                    if (compData.IsObject())
                    {
                        if (compData.HasMember("displayName") && compData["displayName"].IsString())
                        {
                            comp.display_name = compData["displayName"].GetString();
                        }
                        if (compData.HasMember("required") && compData["required"].IsBool())
                        {
                            comp.required = compData["required"].GetBool();
                        }
                        if (compData.HasMember("defaultEnabled") && compData["defaultEnabled"].IsBool())
                        {
                            comp.default_enabled = compData["defaultEnabled"].GetBool();
                        }
                        if (compData.HasMember("show") && compData["show"].IsBool())
                        {
                            comp.show = compData["show"].GetBool();
                        }
                        else
                        {
                            comp.show = true; // Default to showing component if not specified
                        }
                        if (compData.HasMember("totalSize") && compData["totalSize"].IsUint64())
                        {
                            comp.total_size = compData["totalSize"].GetUint64();
                        }
                        else
                        {
                            comp.total_size = 0; // Default to 0 if not specified
                        }

                        manifest.components[comp.id] = comp;
                    }
                }
            }

            return manifest;
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

    game_updater::game_updater(const game_config::game_config_t& config, bool skip_hash, bool delete_deselected, updater::ui_progress_listener* listener)
        : config_(config), skip_hash_check_(skip_hash), delete_deselected_(delete_deselected), progress_listener_(listener)
    {
        const auto install_path_prop = config.get_install_path();
        if (install_path_prop.has_value())
        {
            this->install_path = std::filesystem::path(install_path_prop->data());
        }

        this->is_steam_install = config.is_steam_install();
        this->base_url = game_config::get_resolved_base_url(config);

        const auto manifest_json = game_config::read_manifest(config);
        this->manifest_ = parse_manifest(manifest_json);
        if (this->manifest_.empty())
        {
            throw std::runtime_error("Failed to parse manifest for " + config.display_name + ".");
        }
    }

    void game_updater::run() const
    {
        if (this->install_path.empty())
        {
            return;
        }

        printf("Checking for updates...\n");

        check_cancelled();

        // Load selected components from properties (e.g., "bo3-selected-components" = "base,mp_dlc,zm_dlc")
        std::vector<std::string> selected_components = config_.get_list(property_keys::SELECTED_COMPONENTS);

        // Remove virtual base game component IDs (they're handled separately in verify-game command)
        selected_components.erase(
            std::remove_if(selected_components.begin(), selected_components.end(),
                [](const std::string& comp_id) {
                    return comp_id.starts_with("base_game_");
                }),
            selected_components.end()
        );

        if (!selected_components.empty())
        {
            // Only delete files from deselected components if explicitly requested
            if (this->delete_deselected_)
            {
                const auto files_to_delete = this->get_files_to_delete(selected_components);
                if (!files_to_delete.empty())
                {
                    this->delete_files(files_to_delete);
                }
            }
        }
        else
        {
            // No component selection stored - only include required files
            std::unordered_set<std::string> required_components;
            for (const auto& component : this->manifest_.components)
            {
                if (component.second.required || component.second.default_enabled)
                {
                    required_components.insert(component.first);
                }
            }
            selected_components.assign(required_components.begin(), required_components.end());
            printf("No component selection found, including required components\n");
        }

        // Filter manifest files by selected components
        const auto filtered_files = this->filter_files_by_components(this->manifest_.files, selected_components);

        // Initialize progress tracking for verification phase with filtered files
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(filtered_files, updater::progress_mode::verifying);
        }

        const auto outdated_files = this->get_outdated_files(filtered_files);

        check_cancelled();

        if (outdated_files.empty())
        {
            printf("All files are up to date!\n");

            // Detect and cache installed components
            if (this->progress_listener_)
            {
                this->progress_listener_->update_files(this->manifest_.files, updater::progress_mode::verifying);
            }

            printf("Detecting installed components...\n");
            const auto detected = this->detect_installed_components();
            config_.set_list(property_keys::DETECTED_COMPONENTS, detected);
            if (config_.get_list(property_keys::SELECTED_COMPONENTS).empty())
            {
                config_.set_list(property_keys::SELECTED_COMPONENTS, detected);
            }

            // Mark game as fully installed
            this->write_installed_hash(this->manifest_.hash);
            config_.set_installed(true);
            return;
        }

        const auto update_size = this->get_update_size(outdated_files);
        const auto drive_space = this->get_available_drive_space();
        if (drive_space < update_size)
        {
            double gigabytes = static_cast<double>(update_size) / (1024 * 1024 * 1024);
            throw std::runtime_error(utils::string::va("Not enough space for update! %.2f GB required.", gigabytes));
        }

        check_cancelled();

        this->update_and_verify_with_retry(outdated_files);

        check_cancelled();

        if (!this->is_update_cancelled())
        {
            // Detect and cache installed components
            if (this->progress_listener_)
            {
                this->progress_listener_->update_files(this->manifest_.files, updater::progress_mode::verifying);
            }

            printf("Detecting installed components...\n");
            const auto detected = this->detect_installed_components();
            config_.set_list(property_keys::DETECTED_COMPONENTS, detected);
            if (config_.get_list(property_keys::SELECTED_COMPONENTS).empty())
            {
                config_.set_list(property_keys::SELECTED_COMPONENTS, detected);
            }

            // Mark game as fully installed
            this->write_installed_hash(this->manifest_.hash);
            config_.set_installed(true);
        }

        printf("Update complete!\n");
    }

    size_t game_updater::get_game_size() const
    {
        return this->get_update_size(this->manifest_.files);
    }

    bool game_updater::is_update_needed() const
    {
        return this->needs_to_update(this->manifest_.hash);
    }

    void game_updater::update_file(const updater::file_info& file) const
    {
        check_cancelled();

        const auto url = this->base_url + "/" + utils::string::url_encode_path(file.name) + "?" + file.hash;
        const auto out_file = this->get_drive_filename(file);

        std::string empty{};
        if (!utils::io::write_file(out_file, empty))
        {
            throw std::runtime_error("Failed to write file: " + out_file);
        }

        std::ofstream ofs(out_file, std::ios::binary);
        if (!ofs)
        {
            throw std::runtime_error("Failed to open file: " + out_file);
        }

        const auto keep_going = [this]()  -> bool { return !is_update_cancelled() && !is_update_paused(); };
        const auto on_abort = [this]() -> bool { wait_if_paused_or_cancelled(); return true; };

        int currentPercent = 0;
        const auto data = utils::http::get_data_stream(url, {}, {}, [&](size_t progress, size_t total_size, [[maybe_unused]] size_t speed) -> bool
        {
            if (!keep_going()) return false;

            auto progressRatio = (total_size > 0 && progress >= 0) ? static_cast<double>(progress) / total_size : 0.0;
            auto progressPercent = int(progressRatio * 100.0);
            if (progressPercent == currentPercent)
                return true;

            currentPercent = progressPercent;
            printf("Updating file: %s (%.2f/%.2f MB) %d%%\n",
            get_filename(file.name).data(),
            progress / (1024.0 * 1024.0),
            total_size / (1024.0 * 1024.0),
            progressPercent);
            return true;
        },
        [&](const char* chunk, size_t size) -> bool
        {
            // Check pause/cancel BEFORE consuming the chunk so bytes_written stays consistent with disk
            if (!keep_going()) return false;

            if (chunk && size > 0)
            {
                ofs.write(chunk, size);
            }

            if (this->progress_listener_)
            {
                this->progress_listener_->file_progress(file, size);
            }

            return true;
        },
        on_abort, 0, 5);

        ofs.close();

        check_cancelled();

        if (!data || !data.has_value())
        {
            throw std::runtime_error("Failed to download: " + url + " - Data has no value");
        }

        const auto& result = data.value();

        if (result.response_code == 416)
        {
            // Our resume offset is past the remote's view of the file; drop the partial so retry refetches from byte 0
            utils::io::remove_file(out_file);
            throw std::runtime_error(utils::string::va(
                "HTTP 416 for %s - partial deleted, will retry from byte 0", url.data()));
        }

        if (result.code != CURLE_OK)
        {
            throw std::runtime_error(utils::string::va("Failed to download: %s - CURL error (%d): %s",
                url.data(), result.code, curl_easy_strerror(result.code)));
        }
    }

    std::vector<updater::file_info> game_updater::get_outdated_files(const std::vector<updater::file_info>& files) const
    {
        printf("Verifying %zu files, please wait...\n", files.size());

        std::vector<updater::file_info> outdated_files{};
        for (const auto& info : files)
        {
            wait_if_paused_or_cancelled();

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

        printf("Finished verifying files\n");

        return outdated_files;
    }

    bool game_updater::needs_to_update(const std::string& hash) const
    {
        const auto installed_hash = this->read_installed_hash();
        return installed_hash.empty() || installed_hash != hash;
    }

    std::size_t game_updater::get_update_size(const std::vector<updater::file_info>& outdated_files) const
    {
        std::size_t total_size = 0;
        for (const auto& file : outdated_files)
        {
            total_size += file.size;
        }

        return total_size;
    }

    std::size_t game_updater::get_available_drive_space() const
    {
        std::filesystem::space_info spaceInfo = std::filesystem::space(this->install_path);
        return spaceInfo.available;
    }

    void game_updater::update_and_verify_with_retry(const std::vector<updater::file_info>& files_to_download) const
    {
        const int MAX_RETRIES = 5;
        std::vector<updater::file_info> pending_files = files_to_download;
        int attempt = 0;

        while (!pending_files.empty() && attempt < MAX_RETRIES)
        {
            wait_if_paused_or_cancelled();

            if (attempt > 0)
            {
                printf("Retry attempt %d for %zu files...\n", attempt, pending_files.size());
            }

            // Reset progress tracking for download phase
            if (this->progress_listener_)
            {
                this->progress_listener_->update_files(pending_files, updater::progress_mode::downloading);
            }

            // Phase 1: Download all pending files (no per-file verification)
            this->update_files_no_verify(pending_files);

            check_cancelled();

            // Phase 2: Verify downloaded files
            printf("Verifying downloaded files...\n");
            if (this->progress_listener_)
            {
                this->progress_listener_->update_files(pending_files, updater::progress_mode::verifying);
            }

            pending_files = this->get_outdated_files(pending_files);
            ++attempt;
        }

        if (!pending_files.empty())
        {
            throw std::runtime_error("Failed to download " + std::to_string(pending_files.size()) +
                " file(s) after " + std::to_string(MAX_RETRIES) + " retry attempts");
        }
    }

    void game_updater::update_files_no_verify(const std::vector<updater::file_info>& files) const
    {
        printf("Downloading %zu files...\n", files.size());

#ifdef MULTITHREAD_DOWNLOAD
        // Thread pool version - catches exceptions per-file instead of storing and rethrowing
        // Allows download to continue even if individual files fail
        const auto thread_count = get_optimal_concurrent_download_count(files.size());
        std::vector<std::thread> threads{};
        std::atomic<size_t> current_index{0};

        for (size_t i = 0; i < thread_count; ++i)
        {
            threads.emplace_back([&]()
            {
                while (true)
                {
                    // Block here while paused; wakes on resume or cancel.
                    if (this->progress_listener_)
                        this->progress_listener_->wait_if_paused();
                    if (is_update_cancelled()) break;

                    const auto index = current_index++;
                    if (index >= files.size()) break;

                    const auto& file = files[index];
                    try
                    {
                        if (this->progress_listener_)
                            this->progress_listener_->begin_file(file);

                        this->update_file(file);

                        if (this->progress_listener_)
                            this->progress_listener_->end_file(file);
                    }
                    catch (const updater::update_cancelled&)
                    {
                        break;  // Exit thread on cancellation
                    }
                    catch (const std::exception& e)
                    {
                        printf("Warning: Download failed for %s: %s (will retry)\n",
                            file.name.data(), e.what());
                        // Don't rethrow - file will be caught in verification phase
                    }
                }
            });
        }

        for (auto& thread : threads)
        {
            if (thread.joinable())
                thread.join();
        }

        check_cancelled();

#else
        // Single-threaded version
        for (const auto& file : files)
        {
            wait_if_paused_or_cancelled();

            if (this->progress_listener_)
                this->progress_listener_->begin_file(file);

            try
            {
                this->update_file(file);
            }
            catch (const updater::update_cancelled&)
            {
                throw;
            }
            catch (const std::exception& e)
            {
                printf("Warning: Download failed for %s: %s (will retry)\n",
                    file.name.data(), e.what());
                // Don't throw - file will be caught in verification phase
            }

            if (this->progress_listener_)
                this->progress_listener_->end_file(file);
        }
#endif

        printf("Finished downloading files\n");
    }

    bool game_updater::is_outdated_file(const updater::file_info& file) const
    {
        printf("Verifying file: %s\n", get_filename(file.name).data());
        const auto drive_name = this->get_drive_filename(file);
        if (!utils::io::file_exists(drive_name))
        {
            return true;
        }

        if (utils::io::file_size(drive_name) != file.size)
        {
            return true;
        }

        if (!this->skip_hash_check_)
        {
            const auto hash = utils::hash::get_file_hash(drive_name, [this]() { wait_if_paused_or_cancelled(); });
            return hash != file.hash;
        }

        return false;
    }

    std::string game_updater::get_drive_filename(const updater::file_info& file) const
    {
        if(this->is_steam_install)
        {
            if (utils::string::starts_with(file.name, "zone/"))
            {
                const auto filename = utils::string::replace(file.name, "zone/", "");
                return (this->install_path / filename).string();
            }
            else if (utils::string::starts_with(file.name, "raw/video/"))
            {
                const auto filename = utils::string::replace(file.name, "raw/video/", "");
                return (this->install_path / filename).string();
            }
        }

        return (this->install_path / file.name).string();
    }

    std::filesystem::path game_updater::get_manifest_file_path() const
    {
        return this->install_path / "manifest.json";
    }

    std::string game_updater::read_installed_hash() const
    {
        const auto manifest_path = this->get_manifest_file_path();
        if (!utils::io::file_exists(manifest_path))
        {
            return {};
        }

        const auto contents = utils::io::read_file(manifest_path);
        if (contents.empty())
        {
            return {};
        }

        rapidjson::Document doc;
        if (doc.Parse(contents.data()).HasParseError() || !doc.IsObject())
        {
            return {};
        }

        const auto it = doc.FindMember(this->config_.game_key.data());
        if (it == doc.MemberEnd() || !it->value.IsString())
        {
            return {};
        }

        return it->value.GetString();
    }

    void game_updater::write_installed_hash(const std::string& hash) const
    {
        const auto manifest_path = this->get_manifest_file_path();

        rapidjson::Document doc;
        bool valid = false;
        if (utils::io::file_exists(manifest_path))
        {
            const auto contents = utils::io::read_file(manifest_path);
            if (!contents.empty() && !doc.Parse(contents.data()).HasParseError() && doc.IsObject())
            {
                valid = true;
            }
        }

        if (!valid)
        {
            doc.SetObject();
        }

        auto& allocator = doc.GetAllocator();
        rapidjson::Value key(this->config_.game_key.data(), allocator);
        rapidjson::Value value(hash.data(), allocator);

        const auto it = doc.FindMember(this->config_.game_key.data());
        if (it != doc.MemberEnd())
        {
            it->value = value;
        }
        else
        {
            doc.AddMember(key, value, allocator);
        }

        rapidjson::StringBuffer buffer;
        rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(buffer);
        doc.Accept(writer);

        utils::io::write_file(manifest_path, buffer.GetString());
    }

    void game_updater::delete_installed_hash() const
    {
        const auto manifest_path = this->get_manifest_file_path();
        if (!utils::io::file_exists(manifest_path))
        {
            return;
        }

        const auto contents = utils::io::read_file(manifest_path);

        rapidjson::Document doc;
        if (contents.empty() || doc.Parse(contents.data()).HasParseError() || !doc.IsObject())
        {
            utils::io::remove_file(manifest_path);
            return;
        }

        doc.RemoveMember(this->config_.game_key.data());

        if (doc.MemberCount() == 0)
        {
            utils::io::remove_file(manifest_path);
            return;
        }

        rapidjson::StringBuffer buffer;
        rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(buffer);
        doc.Accept(writer);

        utils::io::write_file(manifest_path, buffer.GetString());
    }

    bool game_updater::is_update_cancelled() const
    {
        return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
    }

    bool game_updater::is_update_paused() const
    {
        return (this->progress_listener_ && this->progress_listener_->is_update_paused());
    }

    void game_updater::check_cancelled() const
    {
        if (is_update_cancelled())
        {
            throw updater::update_cancelled();
        }
    }

    void game_updater::wait_if_paused_or_cancelled() const
    {
        if (this->progress_listener_)
        {
            this->progress_listener_->wait_if_paused();
        }
        check_cancelled();
    }

    std::vector<component_info> game_updater::get_available_components() const
    {
        std::vector<component_info> components;
        for (const auto& [id, info] : this->manifest_.components)
        {
            // Only include components that should be shown in the UI
            if (info.show)
            {
                components.push_back(info);
            }
        }

        return components;
    }

    std::vector<std::string> game_updater::detect_installed_components() const
    {
        if (this->install_path.empty())
        {
            return {};
        }

        // Build list of all file paths to check
        std::vector<std::filesystem::path> paths_to_check;
        paths_to_check.reserve(this->manifest_.files.size());

        for (const auto& file : this->manifest_.files)
        {
            paths_to_check.push_back(this->get_drive_filename(file));
        }

        // Batch stat all files (single open per file - NEW OPTIMIZATION)
        const auto file_stats = utils::io::batch_stat_files(paths_to_check);

        // Count files per component: {component_id -> {found, total}}
        std::unordered_map<std::string, std::pair<int, int>> component_stats;

        // Initialize counters for all components
        for (const auto& [comp_id, comp_info] : this->manifest_.components)
        {
            component_stats[comp_id] = {0, 0};
        }

        // Also track any components found in files that aren't in the manifest metadata
        for (const auto& file : this->manifest_.files)
        {
            if (component_stats.find(file.component) == component_stats.end())
            {
                component_stats[file.component] = {0, 0};
            }
        }

        // Check each file with progress tracking
        for (const auto& file : this->manifest_.files)
        {
            // Progress tracking - show current file being checked
            if (this->progress_listener_)
            {
                this->progress_listener_->begin_file(file);
            }

            // Check for cancellation
            check_cancelled();

            const auto& component = file.component;
            component_stats[component].second++; // Increment total

            const auto drive_name = this->get_drive_filename(file);
            auto it = file_stats.find(drive_name);

            if (it != file_stats.end() && it->second.exists && it->second.size == file.size)
            {
                component_stats[component].first++; // Increment found
            }

            // Mark file as complete
            if (this->progress_listener_)
            {
                this->progress_listener_->end_file(file);
            }
        }

        // Determine which components are "installed" (>= 90% of files present)
        std::vector<std::string> installed_components;
        for (const auto& [comp_id, stats] : component_stats)
        {
            const auto [found, total] = stats;
            if (total > 0)
            {
                const auto percentage = (found * 100) / total;
                if (percentage >= 90)
                {
                    installed_components.push_back(comp_id);
                }
            }
        }

        return installed_components;
    }

    std::vector<updater::file_info> game_updater::filter_files_by_components(
        const std::vector<updater::file_info>& all_files,
        const std::vector<std::string>& selected_components) const
    {
        std::vector<updater::file_info> filtered_files;

        // Create a set for faster lookup
        std::unordered_set<std::string> component_set(selected_components.begin(), selected_components.end());

        for (const auto& file : all_files)
        {
            // Include file if its component is in the selected set
            if (component_set.find(file.component) != component_set.end())
            {
                filtered_files.push_back(file);
            }
        }

        return filtered_files;
    }

    size_t game_updater::calculate_component_size(const std::vector<std::string>& components) const
    {
        size_t total_size = 0;

        // Use totalSize from component metadata if available
        for (const auto& comp_id : components)
        {
            auto it = this->manifest_.components.find(comp_id);
            if (it != this->manifest_.components.end())
            {
                total_size += it->second.total_size;
            }
        }

        return total_size;
    }

    std::vector<updater::file_info> game_updater::get_files_to_delete(
        const std::vector<std::string>& selected_components) const
    {
        if (this->install_path.empty())
        {
            return {};
        }

        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(this->manifest_.files, updater::progress_mode::verifying);
        }

        // Detect which components are currently installed
        const auto installed_components = this->detect_installed_components();

        // Create a set of selected components for fast lookup
        std::unordered_set<std::string> selected_set(selected_components.begin(), selected_components.end());

        // Find deselected components (installed but not selected)
        std::unordered_set<std::string> deselected_components;
        for (const auto& installed_comp : installed_components)
        {
            if (selected_set.find(installed_comp) == selected_set.end())
            {
                deselected_components.insert(installed_comp);
            }
        }

        // If no components are deselected, return empty list
        if (deselected_components.empty())
        {
            return {};
        }

        // Collect all files from deselected components that exist on disk
        std::vector<updater::file_info> files_to_delete;
        for (const auto& file : this->manifest_.files)
        {
            // Check if this file belongs to a deselected component
            if (deselected_components.find(file.component) != deselected_components.end())
            {
                // Check if the file actually exists on disk
                const auto drive_name = this->get_drive_filename(file);
                if (utils::io::file_exists(drive_name))
                {
                    files_to_delete.push_back(file);
                }
            }
        }

        return files_to_delete;
    }

    void game_updater::delete_game() const
    {
        if (this->install_path.empty())
        {
            throw std::runtime_error("Install path not set");
        }

        check_cancelled();

        std::vector<updater::file_info> files_to_delete;

        // Add all manifest files that exist
        for (const auto& file : this->manifest_.files)
        {
            const auto drive_name = this->get_drive_filename(file);
            if (utils::io::file_exists(drive_name))
            {
                files_to_delete.push_back(file);
            }
        }

        if (!files_to_delete.empty())
        {
            this->delete_files(files_to_delete);
        }

        // Remove this game's entry from manifest.json (deletes the file if empty).
        this->delete_installed_hash();

        // Clean up empty directories (deepest first)
        // Collect all unique parent directories from deleted files
        std::set<std::filesystem::path> directories_to_check;
        for (const auto& file : files_to_delete)
        {
            auto file_path = this->install_path / file.name;
            auto parent = file_path.parent_path();

            // Add all parent directories up to (but not including) install_path
            while (parent != this->install_path && is_inside_folder(parent, this->install_path))
            {
                directories_to_check.insert(parent);
                parent = parent.parent_path();
            }
        }

        // Sort directories by depth (deepest first) and remove empty ones
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

        printf("Game deletion complete\n");
    }

    void game_updater::delete_files(const std::vector<updater::file_info>& files) const
    {
        if (files.empty())
        {
            return;
        }

        printf("Deleting files from deselected components...\n");

        // Initialize progress tracking for deletion phase
        if (this->progress_listener_)
        {
            this->progress_listener_->update_files(files, updater::progress_mode::deleting);
        }

        for (const auto& file : files)
        {
            check_cancelled();

            // Report that we're starting to delete this file
            if (this->progress_listener_)
            {
                this->progress_listener_->begin_file(file);
            }

            const auto drive_name = this->get_drive_filename(file);
            printf("Deleting: %s\n", get_filename(file.name).data());

            // Delete the file
            if (utils::io::file_exists(drive_name))
            {
                if (!utils::io::remove_file(drive_name))
                {
                    printf("Warning: Failed to delete file: %s\n", drive_name.data());
                }
            }

            // Mark file as processed by adding its size to progress
            if (this->progress_listener_)
            {
                this->progress_listener_->file_progress(file, file.size);
            }

            // Report that we've finished deleting this file
            if (this->progress_listener_)
            {
                this->progress_listener_->end_file(file);
            }
        }

        printf("Finished deleting files from deselected components\n");
    }
}
