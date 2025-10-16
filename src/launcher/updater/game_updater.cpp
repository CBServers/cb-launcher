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

		void throw_error(const std::string error, bool terminate = false)
		{
			std::string error_string = error + "\n";
			printf("%s", error_string.c_str()); // TODO: Replace with CEF GUI logging
			error_occurred = true;

			if (terminate)
			{
				throw std::runtime_error(error);
			}
		}

		std::vector<file_info> parse_file_infos(const std::string& json)
		{
			rapidjson::Document doc{};
			doc.Parse(json.data(), json.size());

			if (!doc.IsArray())
			{
				return {};
			}

			std::vector<file_info> files{};

			for (const auto& element : doc.GetArray())
			{
				if (!element.IsArray())
				{
					continue;
				}

				auto array = element.GetArray();

				file_info info{};
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
					file_info info;
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

	game_updater::game_updater(const game_config::game_config_t& config, bool force_update)
	{
		const auto install_path_prop = utils::properties::load(config.install_property);
		if (!install_path_prop || install_path_prop->empty())
		{
			throw std::runtime_error("Game install path not set for: " + config.id);
		}

		this->install_path = std::filesystem::path(install_path_prop->data());
		this->base_url = config.base_url;
		this->force_update = force_update;
	}

	void game_updater::run(bool& update_needed) const
	{
		printf("Checking for updates...\n"); // TODO: Replace with CEF GUI logging

		const auto manifest = get_manifest(this->base_url + "/manifest.json");
		if (manifest.empty())
		{
			update_needed = false;
			printf("Failed to download manifest\n"); // TODO: Replace with CEF GUI logging
			return;
		}

		if (!this->force_update && !utils::flags::has_flag("verify"))
		{
			if (!this->needs_to_update(manifest.hash))
			{
				update_needed = false;
				printf("Game is up to date!\n"); // TODO: Replace with CEF GUI logging
				return;
			}

			update_needed = true;
			printf("Update required!\n"); // TODO: Replace with CEF GUI logging
		}

		const auto outdated_files = this->get_outdated_files(manifest.files);
		if (outdated_files.empty())
		{
			utils::io::write_file(this->get_manifest_file_path(), manifest.hash);
			update_needed = false;
			printf("All files are up to date!\n"); // TODO: Replace with CEF GUI logging
			return;
		}

		const auto update_size = this->get_update_size(outdated_files);
		const auto drive_space = this->get_available_drive_space();
		if (drive_space < update_size)
		{
			update_needed = true;
			double gigabytes = static_cast<double>(update_size) / (1024 * 1024 * 1024);
			throw_error(utils::string::va("Not enough space for update! %.2f GB required.", gigabytes), true);
			return;
		}

		this->update_files(outdated_files);

		if (error_occurred)
		{
			throw std::runtime_error("An error occurred during the update process.");
		}

		if (!error_occurred)
		{
			utils::io::write_file(this->get_manifest_file_path(), manifest.hash);
		}

		update_needed = false;
		printf("Update complete!\n"); // TODO: Replace with CEF GUI logging
	}

	void game_updater::update_file(const file_info& file) const
	{
		const auto url = this->base_url + "/" + file.name + "?" + file.hash;
		const auto out_file = this->get_drive_filename(file);

		std::string empty{};
		if (!utils::io::write_file(out_file, empty, false))
		{
			throw_error("Failed to write file: " + out_file);
			return;
		}

		std::ofstream ofs(out_file, std::ios::binary);
		if (!ofs)
		{
			throw_error("Failed to open file: " + out_file);
			return;
		}

		int currentPercent = 0;
		const auto data = utils::http::get_data_stream(url, {}, {}, [&](size_t progress, size_t total_size, [[maybe_unused]] size_t speed)
		{
			auto progressRatio = (total_size > 0 && progress >= 0) ? static_cast<double>(progress) / total_size : 0.0;
			auto progressPercent = int(progressRatio * 100.0);
			if (progressPercent == currentPercent)
				return;

			currentPercent = progressPercent;
			printf("Updating: %s (%d%%)\n", get_filename(file.name).data(), progressPercent); // TODO: Replace with CEF GUI logging
		},
		[&](const char* chunk, size_t size)
		{
			if (chunk && size > 0)
			{
				ofs.write(chunk, size);
			}
		});

		ofs.close();

		if (!data || !data.has_value())
		{
			throw_error("Failed to download: " + url + " - Data has no value");
			return;
		}

		try
		{
			const auto& result = data.value();
			if (result.code != CURLE_OK)
			{
				throw_error("Failed to download: " + url + " - Invalid curl code");
				return;
			}

			if (utils::io::file_size(out_file) != file.size)
			{
				throw_error("Downloaded file size mismatch: " + out_file);
				return;
			}

			if (utils::hash::get_file_hash(out_file) != file.hash)
			{
				throw_error("Downloaded file hash mismatch: " + out_file);
				return;
			}
		}
		catch (const std::exception& e)
		{
			throw_error("Failed to download: " + url + " - " + e.what());
		}
		catch (...)
		{
			throw_error("Unknown error occurred while updating: " + url);
		}
	}


	std::vector<file_info> game_updater::get_outdated_files(const std::vector<file_info>& files) const
	{
		printf("Verifying files, please wait...\n"); // TODO: Replace with CEF GUI logging

		const auto thread_count = get_optimal_concurrent_download_count(files.size());
		std::vector<std::thread> threads{};
		std::atomic<size_t> current_index{ 0 };
		std::atomic<size_t> completed_files{ 0 };
		std::vector<std::vector<file_info>> per_thread_outdated_files(thread_count);
		utils::concurrency::container<std::exception_ptr> exception{};

		for (size_t i = 0; i < thread_count; ++i)
		{
			threads.emplace_back([&, i]()
				{
					auto& local_outdated_files = per_thread_outdated_files[i];

					while (!exception.access<bool>([](const std::exception_ptr& ptr)
					{
						return static_cast<bool>(ptr);
					}))
					{
						const auto index = current_index++;
						if (index >= files.size())
						{
							break;
						}

						try
						{
							const auto& info = files[index];

							if (this->is_outdated_file(info))
							{
								printf("Verification failed: %s\n", get_filename(info.name).data()); // TODO: Replace with CEF GUI logging
								local_outdated_files.emplace_back(info);
							}

							++completed_files; // TODO: Report progress to CEF GUI
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

		std::vector<file_info> outdated_files;
		for (const auto& thread_files : per_thread_outdated_files)
		{
			outdated_files.insert(outdated_files.end(), thread_files.begin(), thread_files.end());
		}

		printf("Finished verifying files\n"); // TODO: Replace with CEF GUI logging

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


	std::size_t game_updater::get_update_size(const std::vector<file_info>& outdated_files) const
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

	void game_updater::update_files(const std::vector<file_info>& outdated_files) const
	{
		printf("Found outdated files! Downloading/updating files...\n"); // TODO: Replace with CEF GUI logging

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
							const auto& file = outdated_files[index];

							this->update_file(file);

							++completed_files; // TODO: Report progress to CEF GUI
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

		printf("Finished downloading/updating files\n"); // TODO: Replace with CEF GUI logging
	}

	bool game_updater::is_outdated_file(const file_info& file) const
	{
		printf("Verifying: %s\n", get_filename(file.name).data()); // TODO: Replace with CEF GUI logging
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

	std::string game_updater::get_drive_filename(const file_info& file) const
	{
		return (this->install_path / file.name).string();
	}

	std::string game_updater::get_manifest_file_path() const
	{
		return (this->install_path / "latest.manifest").string();
	}

}