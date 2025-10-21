#include <std_include.hpp>

#include "updater.hpp"
#include "updater_ui.hpp"
#include "launcher_updater.hpp"

#include <utils/cryptography.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/logger.hpp>
#include <utils/compression.hpp>
#include <utils/string.hpp>

#include <rapidjson/writer.h>

#define UPDATE_SERVER "https://github.com/CBServers/updater/raw/main/updater/"

#define UPDATE_FILE_MAIN UPDATE_SERVER "cb-launcher.json"
#define UPDATE_FOLDER_MAIN UPDATE_SERVER "cb-launcher/"
#define UPDATE_HOST_BINARY "cb-launcher.exe"

namespace launcher_updater
{
	namespace
	{
		std::string get_update_file()
		{
			return UPDATE_FILE_MAIN;
		}

		std::string get_update_folder()
		{
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

		std::string get_cache_buster()
		{
			return "?" + std::to_string(
				std::chrono::duration_cast<std::chrono::nanoseconds>(
					std::chrono::system_clock::now().time_since_epoch()).count());
		}

		std::vector<updater::file_info> get_file_infos()
		{
			const auto json = utils::http::get_data(get_update_file() + get_cache_buster());
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

		bool is_inside_folder(const std::filesystem::path& file, const std::filesystem::path& folder)
		{
			const auto relative = std::filesystem::relative(file, folder);
			const auto start = relative.begin();
			return start != relative.end() && start->string() != "..";
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
		const auto files = get_file_infos();
		if (!files.empty())
		{
			this->cleanup_directories(files);
		}

		const auto outdated_files = this->get_outdated_files(files);
		if (outdated_files.empty())
		{
			return;
		}

		this->update_host_binary(outdated_files);
		this->update_files(outdated_files);

		std::this_thread::sleep_for(1s);
	}

	void launcher_updater::update_file(const updater::file_info& file) const
	{
		auto url = get_update_folder() + file.name + "?" + file.hash;
		utils::logger::write("Updating file {}", url);

		const auto data = utils::http::get_data(url, {}, {}, [&](size_t progress, [[maybe_unused]] size_t total, [[maybe_unused]] size_t speed) -> bool
		{
			this->listener_.file_progress(file, progress);
			return true;
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

			if (result.code != CURLE_OK || result.buffer.size() != file.size || get_hash(result.buffer) != file.hash)
			{
				throw std::runtime_error(utils::string::va("Failed to download: %s - Invalid curl code", url.data()));
			}

			const auto out_file = this->get_drive_filename(file);
			if (!utils::io::write_file(out_file.string(), result.buffer, false))
			{
				utils::logger::write("Failed to write {}. Error code: ", file.name,
					std::system_category().message(static_cast<int>(::GetLastError())));
				throw std::runtime_error(utils::string::va("Failed to write: %s", out_file.string().data()));
			}

			utils::logger::write("Done updating file {}", file.name);
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

	void launcher_updater::update_host_binary(const std::vector<updater::file_info>& outdated_files) const
	{
		const auto* host_file = find_host_file_info(outdated_files);
		if (!host_file)
		{
			return;
		}

		try
		{
			this->move_current_process_file();
			this->update_files({*host_file});
		}
		catch (...)
		{
			this->restore_current_process_file();
			throw;
		}

		utils::nt::relaunch_self();
		throw updater::update_cancelled();
	}

	void launcher_updater::update_files(const std::vector<updater::file_info>& outdated_files) const
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
						this->update_file(file);
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
#if !defined(NDEBUG)
		if (file.name == UPDATE_HOST_BINARY)
		{
			return false;
		}
#endif

		std::string data{};
		const auto drive_name = this->get_drive_filename(file);
		if (!utils::io::read_file(drive_name.string(), &data))
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

		return this->base_ / "data" / file.name;
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
			if (!utils::io::file_exists(this->dead_process_file_.string()))
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
		const auto existing_files = utils::io::list_files(this->base_);
		for (const auto& file : existing_files)
		{
			const auto entry = std::filesystem::relative(file, this->base_);
			if ((entry.string() == "user" || entry.string() == "data") && utils::io::directory_exists(file) || file.ends_with(".key"))
			{
				continue;
			}

			std::error_code code{};
			std::filesystem::remove_all(file, code);
		}
	}

	void launcher_updater::cleanup_data_directory(const std::vector<updater::file_info>& files) const
	{
		const auto base = std::filesystem::path(this->base_) / "data";
		if (!utils::io::directory_exists(base.string()))
		{
			return;
		}

		std::vector<std::filesystem::path> legal_files{};
		legal_files.reserve(files.size());
		for (const auto& file : files)
		{
			if (file.name != UPDATE_HOST_BINARY)
			{
				legal_files.emplace_back(std::filesystem::absolute(base / file.name));
			}
		}

		const auto existing_files = utils::io::list_files(base.string(), true);
		for (auto& file : existing_files)
		{
			const auto is_file = std::filesystem::is_regular_file(file);
			const auto is_folder = std::filesystem::is_directory(file);

			if (is_file || is_folder)
			{
				bool is_legal = false;

				for (const auto& legal_file : legal_files)
				{
					if ((is_folder && is_inside_folder(legal_file, file)) ||
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
