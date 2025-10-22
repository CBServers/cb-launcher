#include <std_include.hpp>

#include "updater.hpp"
#include "game_updater.hpp"

#include <utils/cryptography.hpp>
#include <utils/flags.hpp>
#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/concurrency.hpp>
#include <utils/hash.hpp>
#include <utils/string.hpp>
#include <utils/properties.hpp>

namespace game_updater
{
	namespace
	{
		bool error_occurred = false;

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

					manifest.files.push_back(info);
				}
			}
			else
			{
				return {};
			}

			return manifest;
		}

		std::string get_cache_buster()
		{
			return "?" + std::to_string(
				std::chrono::duration_cast<std::chrono::nanoseconds>(
					std::chrono::system_clock::now().time_since_epoch()).count());
		}

		std::string get_hash(const std::string& data)
		{
			return utils::cryptography::sha1::compute(data, true);
		}

		update_manifest get_manifest(const std::string& manifest_url)
		{
			const auto data = utils::http::get_data(manifest_url + get_cache_buster());
			if (!data || !data.has_value())
			{
				return {};
			}

			const auto& result = data.value();
			if (result.code != CURLE_OK)
			{
				return {};
			}

			return parse_manifest(result.buffer);
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

	game_updater::game_updater(const game_config::game_config_t& config, bool force_update, updater::ui_progress_listener* listener)
		: progress_listener_(listener)
	{
		const auto install_path_prop = utils::properties::load(config.install_property);
		const auto is_steam_install_prop = utils::properties::load(config.steam_install_property);

		// install_path and has_zone_folder may not be set yet (e.g., when calling get_game_size before installation)
		if (install_path_prop.has_value())
		{
			this->install_path = std::filesystem::path(install_path_prop->data());
		}

		if (is_steam_install_prop.has_value())
		{
			this->is_steam_install = (std::string(is_steam_install_prop->data()) == "true") ? true : false;
		}
		else
		{
			this->is_steam_install = false; // Default to false if not set
		}

		this->base_url = config.base_url;
		this->is_installed_property = config.is_installed_property;
		this->force_update = force_update;
	}

	void game_updater::run(bool& update_needed) const
	{
		if (this->install_path.empty())
		{
			return;
		}

		// Reset cancellation state from any previous update
		if (this->progress_listener_)
		{
			this->progress_listener_->reset();
		}

		printf("Checking for updates...\n");

		const auto manifest = get_manifest(this->base_url + "/manifest.json");
		if (manifest.empty())
		{
			update_needed = false;
			throw std::runtime_error("Failed to download manifest");
		}

		if (!this->force_update)
		{
			if (!this->needs_to_update(manifest.hash))
			{
				update_needed = false;
				throw std::runtime_error("Game is up to date!");
			}

			update_needed = true;
			printf("Update required!\n");
		}

		check_cancelled();

		// Initialize progress tracking for verification phase with all files
		if (this->progress_listener_)
		{
			this->progress_listener_->update_files(manifest.files, updater::progress_mode::verifying);
		}

		const auto outdated_files = this->get_outdated_files(manifest.files);

		check_cancelled();

		if (outdated_files.empty())
		{
			// Verification complete, all files up to date
			if (this->progress_listener_)
			{
				this->progress_listener_->done_update();
			}

			utils::io::write_file(this->get_manifest_file_path(), manifest.hash);

			// Mark game as fully installed
			if (!this->is_installed_property.empty())
			{
				utils::properties::store(this->is_installed_property, "true");
			}

			update_needed = false;
			printf("All files are up to date!\n");
			return;
		}

		check_cancelled();

		const auto update_size = this->get_update_size(outdated_files);
		const auto drive_space = this->get_available_drive_space();
		if (drive_space < update_size)
		{
			update_needed = true;
			double gigabytes = static_cast<double>(update_size) / (1024 * 1024 * 1024);
			throw std::runtime_error(utils::string::va("Not enough space for update! %.2f GB required.", gigabytes));
		}

		check_cancelled();

		// Reset progress tracking for download phase with only outdated files
		if (this->progress_listener_)
		{
			this->progress_listener_->update_files(outdated_files, updater::progress_mode::downloading);
		}

		this->update_files(outdated_files);

		check_cancelled();

		// Notify completion
		if (this->progress_listener_)
		{
			this->progress_listener_->done_update();
		}

		if (error_occurred)
		{
			throw std::runtime_error("An error occurred during the update process.");
		}

		if (!error_occurred && !this->is_update_cancelled())
		{
			utils::io::write_file(this->get_manifest_file_path(), manifest.hash);

			// Mark game as fully installed
			if (!this->is_installed_property.empty())
			{
				utils::properties::store(this->is_installed_property, "true");
			}
		}

		update_needed = false;
		printf("Update complete!\n");
	}

	size_t game_updater::get_game_size() const
	{
		const auto manifest = get_manifest(this->base_url + "/manifest.json");
		if (manifest.empty())
		{
			throw std::runtime_error("Failed to download manifest");
			return 0;
		}

		return this->get_update_size(manifest.files);
	}

	void game_updater::update_file(const updater::file_info& file) const
	{
		check_cancelled();

		const auto url = this->base_url + "/" + file.name + "?" + file.hash;
		const auto out_file = this->get_drive_filename(file);

		std::string empty{};
		if (!utils::io::write_file(out_file, empty, false))
		{
			throw std::runtime_error("Failed to write file: " + out_file);
			return;
		}

		std::ofstream ofs(out_file, std::ios::binary);
		if (!ofs)
		{
			throw std::runtime_error("Failed to open file: " + out_file);
			return;
		}

		int currentPercent = 0;
		const auto data = utils::http::get_data_stream(url, {}, {}, [&](size_t progress, size_t total_size, [[maybe_unused]] size_t speed) -> bool
		{
			auto progressRatio = (total_size > 0 && progress >= 0) ? static_cast<double>(progress) / total_size : 0.0;
			auto progressPercent = int(progressRatio * 100.0);
			if (progressPercent == currentPercent)
				return !is_update_cancelled(); // Continue unless cancelled

			currentPercent = progressPercent;
			printf("Updating: %s (%d%%)\n", get_filename(file.name).data(), progressPercent);
			return !is_update_cancelled(); // Continue unless cancelled
		},
		[&](const char* chunk, size_t size) -> bool
		{
			if (chunk && size > 0)
			{
				ofs.write(chunk, size);
			}

			// We pass size of chunk to file_progress to progress that amount in bytes
			if (this->progress_listener_)
			{
				this->progress_listener_->file_progress(file, size);
			}

			return !is_update_cancelled(); // Continue unless cancelled
		});

		ofs.close();

		check_cancelled();

		if (!data || !data.has_value())
		{
			throw std::runtime_error("Failed to download: " + url + " - Data has no value");
			return;
		}

		try
		{
			const auto& result = data.value();
			if (result.code == CURLE_ABORTED_BY_CALLBACK && this->is_update_cancelled())
			{
				// Download was cancelled, return silently
				return;
			}

			if (result.code != CURLE_OK)
			{
				throw std::runtime_error("Failed to download: " + url + " - Invalid curl code");
			}

			if (utils::io::file_size(out_file) != file.size)
			{
				throw std::runtime_error("Downloaded file size mismatch: " + out_file);
			}

			if (utils::hash::get_file_hash(out_file) != file.hash)
			{
				throw std::runtime_error("Downloaded file hash mismatch: " + out_file);
			}
		}
		catch (const std::exception& e)
		{
			throw std::runtime_error("Failed to download: " + url + " - " + e.what());
		}
		catch (...)
		{
			throw std::runtime_error("Unknown error occurred while updating: " + url);
		}
	}

	std::vector<updater::file_info> game_updater::get_outdated_files(const std::vector<updater::file_info>& files) const
	{
		printf("Verifying files, please wait...\n");

		std::vector<updater::file_info> outdated_files{};
		for (const auto& info : files)
		{
			check_cancelled();

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
		const auto manifest_path = this->get_manifest_file_path();
		if (utils::io::file_exists(manifest_path))
		{
			auto manifest_hash = utils::io::read_file(manifest_path);

			if (manifest_hash.empty())
			{
				return true;
			}

			if (manifest_hash == hash)
			{
				return false;
			}
		}

		return true;
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

	void game_updater::update_files(const std::vector<updater::file_info>& outdated_files) const
	{
		printf("Found outdated files! Downloading/updating files...\n");

		const auto thread_count = get_optimal_concurrent_download_count(outdated_files.size());

		std::vector<std::thread> threads{};
		std::atomic<size_t> current_index{ 0 };
		std::atomic<size_t> completed_files{ 0 };

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
							check_cancelled();

							const auto& file = outdated_files[index];

							// Notify progress listener that file download is beginning
							if (this->progress_listener_)
							{
								this->progress_listener_->begin_file(file);
							}

							this->update_file(file);

							// Notify progress listener that file is complete
							if (this->progress_listener_)
							{
								this->progress_listener_->end_file(file);
							}

							++completed_files;
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

		printf("Finished downloading/updating files\n");
	}

	bool game_updater::is_outdated_file(const updater::file_info& file) const
	{
		printf("Verifying: %s\n", get_filename(file.name).data());
		const auto drive_name = this->get_drive_filename(file);
		if (!utils::io::file_exists(drive_name))
		{
			return true;
		}

		if (utils::io::file_size(drive_name) != file.size)
		{
			return true;
		}

		const auto hash = utils::hash::get_file_hash(drive_name);
		return hash != file.hash;
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

	std::string game_updater::get_manifest_file_path() const
	{
		return (this->install_path / "latest.manifest").string();
	}

	bool game_updater::is_update_cancelled() const
	{
		return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
	}

	void game_updater::check_cancelled() const
	{
		if (is_update_cancelled())
		{
			throw updater::update_cancelled();
		}
	}
}