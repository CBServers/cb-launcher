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
			const auto json = utils::http::get_data(manifest_url + get_cache_buster());
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

	client_updater::client_updater(const game_config::game_config_t& config, updater::ui_progress_listener* listener, const std::vector<std::string>& skip_files)
		: skip_files_(skip_files), progress_listener_(listener)
	{
		const auto install_path_prop = config.get_install_path();
		if (!install_path_prop || install_path_prop->empty())
		{
			throw std::runtime_error("Game install path not set for: " + config.id);
		}

		if (install_path_prop.has_value())
		{
			this->install_path = std::filesystem::path(install_path_prop->data());
		}

		this->update_manifest_url = config.update_manifest_url;
		this->update_folder_url = config.update_folder_url;

		// Filter out files that should be skipped
		std::unordered_set<std::string> skip_set(skip_files.begin(), skip_files.end());
		for (const auto& file : config.required_updater_files)
		{
			if (skip_set.find(file) == skip_set.end())
			{
				this->files_to_update.push_back(file);
			}
		}
	}

	void client_updater::run() const
	{
		const auto files = get_file_infos(this->update_manifest_url);
		if (files.empty())
		{
			return;
		}

		const auto valid_files = find_file_infos(this->files_to_update, files);
		if (valid_files.empty())
		{
			return;
		}

		// Initialize progress tracking for verification phase
		if (this->progress_listener_)
		{
			this->progress_listener_->update_files(valid_files, updater::progress_mode::verifying);
		}

		const auto outdated_files = this->get_outdated_files(valid_files);
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
		auto url = this->update_folder_url + file.name + "?" + file.hash;
		utils::logger::write("Updating file {}", url);

		// Notify progress listener that file download is beginning
		if (this->progress_listener_)
		{
			this->progress_listener_->begin_file(file);
		}

		const auto data = utils::http::get_data(url, {}, {}, [&](size_t progress, [[maybe_unused]] size_t total, [[maybe_unused]] size_t speed) -> bool
		{
			// Notify progress listener of download progress
			if (this->progress_listener_)
			{
				this->progress_listener_->file_progress(file, progress);
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

	std::filesystem::path client_updater::get_drive_filename(const updater::file_info& file) const
	{
		return this->install_path / file.name;
	}

	bool client_updater::is_update_cancelled() const
	{
		return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
	}
}
