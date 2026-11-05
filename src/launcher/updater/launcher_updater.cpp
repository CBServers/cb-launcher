#include <std_include.hpp>

#include "updater.hpp"
#include "updater_ui.hpp"
#include "launcher_updater.hpp"

#include <utils/cryptography.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/compression.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>
#include <version.hpp>

#include <rapidjson/writer.h>

#define UPDATE_FILE_MAIN "cb-launcher.json"
#define UPDATE_FOLDER_MAIN "cb-launcher/"
#define UPDATE_FILE_DEV "cb-launcher-dev.json"
#define UPDATE_FOLDER_DEV "cb-launcher-dev/"
#define UPDATE_HOST_BINARY "cb-launcher.exe"

namespace launcher_updater
{
    namespace
    {
        std::string get_update_file()
        {
            if (GIT_BRANCH == "develop"s)
            {
                return UPDATE_FILE_DEV;
            }
            return UPDATE_FILE_MAIN;
        }

        std::string get_update_folder()
        {
            if (GIT_BRANCH == "develop"s)
            {
                return UPDATE_FOLDER_DEV;
            }
            return UPDATE_FOLDER_MAIN;
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

        std::vector<updater::file_info> get_file_infos(update_mirrors::route& source)
        {
            const auto manifest = update_mirrors::fetch_manifest(update_mirrors::routes(), get_update_file(),
                [](const std::string& json) { return !parse_file_infos(json).empty(); });

            source = manifest.source;
            return parse_file_infos(manifest.body);
        }

        std::string get_hash(const std::string& data)
        {
            return utils::cryptography::sha1::compute(data, true);
        }

        const updater::file_info* find_host_file_info(const std::vector<updater::file_info>& outdated_files)
        {
            for (const auto& file : outdated_files)
            {
                if (file.name == UPDATE_HOST_BINARY)
                {
                    return &file;
                }
            }

            return nullptr;
        }

        size_t get_optimal_concurrent_download_count(const size_t file_count)
        {
            size_t cores = std::thread::hardware_concurrency();
            cores = (cores * 2) / 3;
            return std::max(1ull, std::min(cores, file_count));
        }
    }

    launcher_updater::launcher_updater(updater::progress_listener& listener, std::filesystem::path base,
                               std::filesystem::path process_file)
        : listener_(listener)
          , base_(std::move(base))
          , process_file_(std::move(process_file))
          , dead_process_file_(process_file_)
    {
        this->dead_process_file_.replace_extension(".exe.old");
        this->delete_old_process_file();
    }

    void launcher_updater::run() const
    {
        update_mirrors::route source{};
        const auto files = get_file_infos(source);
        if (!files.empty())
        {
            this->cleanup_directories(files);
        }

        const auto outdated_files = this->get_outdated_files(files);
        if (outdated_files.empty())
        {
            return;
        }

        this->update_host_binary(outdated_files, source);
        this->update_files(outdated_files, source);

        std::this_thread::sleep_for(1s);
    }

    void launcher_updater::update_file(const updater::file_info& file, const update_mirrors::route& source) const
    {
        std::string data{};
        const auto status = update_mirrors::fetch_file(source, get_update_folder(), file, [&](const size_t progress)
        {
            this->listener_.file_progress(file, progress);
            return true;
        }, data);

        if (status == update_mirrors::fetch_status::cancelled)
        {
            return;
        }

        const auto out_file = this->get_drive_filename(file);
        if (!utils::io::write_file(out_file, data, false))
        {
            utils::logger::write("Failed to write {}. Error code: {}", file.name,
                std::system_category().message(static_cast<int>(::GetLastError())));
            throw std::runtime_error(utils::string::va("Failed to write: %s", utils::string::path_to_utf8(out_file).data()));
        }

        utils::logger::write("Done updating file {}", file.name);
    }

    std::vector<updater::file_info> launcher_updater::get_outdated_files(const std::vector<updater::file_info>& files) const
    {
        std::vector<updater::file_info> outdated_files{};

        for (const auto& info : files)
        {
            if (this->is_outdated_file(info))
            {
                outdated_files.emplace_back(info);
            }
        }

        return outdated_files;
    }

    void launcher_updater::update_host_binary(const std::vector<updater::file_info>& outdated_files, const update_mirrors::route& source) const
    {
        const auto* host_file = find_host_file_info(outdated_files);
        if (!host_file)
        {
            return;
        }

        try
        {
            this->move_current_process_file();
            this->update_files({*host_file}, source);
        }
        catch (...)
        {
            this->restore_current_process_file();
            throw;
        }

        utils::nt::relaunch_self();
        utils::nt::terminate();
    }

    void launcher_updater::update_files(const std::vector<updater::file_info>& outdated_files, const update_mirrors::route& source) const
    {
        this->listener_.update_files(outdated_files);

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
                    const auto index = current_index++;
                    if (index >= outdated_files.size())
                    {
                        break;
                    }

                    try
                    {
                        const auto& file = outdated_files[index];
                        this->listener_.begin_file(file);
                        this->update_file(file, source);
                        this->listener_.end_file(file);
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

        this->listener_.done_update();
    }

    bool launcher_updater::is_outdated_file(const updater::file_info& file) const
    {
#if defined(DEBUG)
        if (file.name == UPDATE_HOST_BINARY)
        {
            return false;
        }
#endif

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

    std::filesystem::path launcher_updater::get_drive_filename(const updater::file_info& file) const
    {
        if (file.name == UPDATE_HOST_BINARY)
        {
            return this->process_file_;
        }

        return this->base_ / file.name;
    }

    void launcher_updater::move_current_process_file() const
    {
        utils::io::move_file(this->process_file_, this->dead_process_file_);
    }

    void launcher_updater::restore_current_process_file() const
    {
        utils::io::move_file(this->dead_process_file_, this->process_file_);
    }

    void launcher_updater::delete_old_process_file() const
    {
        // Wait for other process to die
        for (auto i = 0; i < 4; ++i)
        {
            utils::io::remove_file(this->dead_process_file_);
            if (!utils::io::file_exists(this->dead_process_file_))
            {
                break;
            }

            std::this_thread::sleep_for(2s);
        }
    }

    void launcher_updater::cleanup_directories(const std::vector<updater::file_info>& files) const
    {
        if (!utils::io::directory_exists(this->base_))
        {
            return;
        }

        this->cleanup_root_directory();
        this->cleanup_data_directory(files);
    }

    void launcher_updater::cleanup_root_directory() const
    {
        static const std::vector<std::filesystem::path> kept_folders = {"user", "data", "manifest", "mods", "clients"};
        const auto portable_marker = utils::properties::get_portable_marker().filename();

        const auto existing_files = utils::io::list_files(this->base_);
        for (const auto& file : existing_files)
        {
            const auto name = file.filename();
            const bool kept_folder = std::find(kept_folders.begin(), kept_folders.end(), name) != kept_folders.end() &&
                                     utils::io::directory_exists(file);
            if (kept_folder || file.extension() == ".key" || name == portable_marker)
            {
                continue;
            }

            std::error_code code{};
            std::filesystem::remove_all(file, code);
        }
    }

    void launcher_updater::cleanup_data_directory(const std::vector<updater::file_info>& files) const
    {
        const auto base = std::filesystem::path(this->base_);
        if (!utils::io::directory_exists(base))
        {
            return;
        }

        std::vector<std::filesystem::path> legal_files{};
        legal_files.reserve(files.size());
        for (const auto& file : files)
        {
            if (file.name.starts_with("data"))
            {
                legal_files.emplace_back(std::filesystem::absolute(base / file.name));
            }
        }

        const auto existing_files = utils::io::list_files(base / "data", true);
        for (auto& file : existing_files)
        {
            const auto is_file = std::filesystem::is_regular_file(file);
            const auto is_folder = std::filesystem::is_directory(file);

            if (is_file || is_folder)
            {
                bool is_legal = false;

                for (const auto& legal_file : legal_files)
                {
                    if ((is_folder && utils::io::is_inside_folder(legal_file, file)) ||
                        (is_file && legal_file == file))
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
            std::filesystem::remove_all(file, code);
        }
    }
}
