#include <std_include.hpp>
#include "unlockall.hpp"

#include <utils/nt.hpp>
#include <utils/io.hpp>
#include <utils/http.hpp>
#include <utils/cryptography.hpp>
#include <utils/properties.hpp>

#define UNLOCK_SERVER "https://cdn.brad.stream/unlockall/"

namespace unlockall
{
	namespace
	{
		std::string get_file_hash(const std::string& file_path)
		{
			std::string data;
			if (!utils::io::read_file(file_path, &data))
			{
				return {};
			}
			return utils::cryptography::sha1::compute(data, true);
		}

		std::string get_cache_buster()
		{
			return "?" + std::to_string(
				std::chrono::duration_cast<std::chrono::nanoseconds>(
					std::chrono::system_clock::now().time_since_epoch()).count());
		}

		std::vector<updater::file_info> parse_unlock_file_infos(const std::string& json)
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
	}

	unlockall::unlockall(const game_config::game_config_t& config, updater::ui_progress_listener* listener)
		: progress_listener_(listener)
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

		this->unlock_url = UNLOCK_SERVER + config.unlock_url_folder;
	}

	void unlockall::run() const
	{
		const auto file_infos = this->get_unlock_file_infos();
		if (file_infos.empty())
		{
			printf("Failed to get unlock file manifest. Cannot proceed.\n");
			throw std::runtime_error("Failed to fetch unlock file information from server.\nPlease check your internet connection and try again.");
		}

		// Check if already unlocked with proper verification
		if (this->is_already_unlocked(file_infos))
		{
			printf("All unlock files are already present.\n");
			return;
		}

		printf("Starting unlock all process...\n");

		if (this->progress_listener_)
		{
			this->progress_listener_->update_files(file_infos, updater::progress_mode::downloading);
		}

		// Ensure the unlock directory exists
		const auto unlock_dir = this->get_unlock_directory();
		if (!utils::io::directory_exists(unlock_dir.string()))
		{
			utils::io::create_directory(unlock_dir.string());
		}

		// Download and verify all unlock files
		for (const auto& file_info : file_infos)
		{
			// Skip if file is already valid (for re-download scenario)
			if (this->verify_unlock_file(file_info))
			{
				continue;
			}

			this->download_unlock_file(file_info);
		}

		printf("Unlock all completed successfully!\n");
	}

	std::filesystem::path unlockall::get_unlock_directory() const
	{
		return this->install_path / "players2/user";
	}

	std::vector<updater::file_info> unlockall::get_unlock_file_infos() const
	{
		const auto data = utils::http::get_data(this->unlock_url + "unlock.json" + get_cache_buster());
		if (!data || !data.has_value())
		{
			printf("Failed to fetch unlock manifest\n");
			return {};
		}

		const auto& result = data.value();
		if (result.code != CURLE_OK)
		{
			printf("Failed to fetch unlock manifest - HTTP error\n");
			return {};
		}

		auto files = parse_unlock_file_infos(result.buffer);
		return files;
	}

	bool unlockall::verify_unlock_file(const updater::file_info& file_info) const
	{
		const auto file_path = (this->get_unlock_directory() / file_info.name).string();

		if (!utils::io::file_exists(file_path))
		{
			return false;
		}

		const auto actual_size = utils::io::file_size(file_path);
		if (actual_size != file_info.size)
		{
			printf("Size mismatch for %s: expected %zu, got %zu\n",
				file_info.name.data(), file_info.size, actual_size);
			return false;
		}

		const auto actual_hash = get_file_hash(file_path);
		if (actual_hash != file_info.hash)
		{
			printf("Hash mismatch for %s\n", file_info.name.data());
			return false;
		}

		return true;
	}

	void unlockall::download_unlock_file(const updater::file_info& file) const
	{
		// Notify progress listener that file download is beginning
		if (this->progress_listener_)
		{
			this->progress_listener_->begin_file(file);
		}

		const auto url = this->unlock_url + file.name + "?" + file.hash;

		printf("Downloading: %s...\n", file.name.data());

		int currentPercent = 0;
		const auto data = utils::http::get_data(url, {}, {}, [&](size_t progress, [[maybe_unused]] size_t total, [[maybe_unused]] size_t speed) -> bool
		{
				if (this->progress_listener_)
				{
					this->progress_listener_->file_progress(file, progress);
				}

				auto progressRatio = (total > 0 && progress >= 0) ? static_cast<double>(progress) / total : 0.0;
				auto progressPercent = int(progressRatio * 100.0);
				if (progressPercent == currentPercent)
					return !this->is_update_cancelled();

				currentPercent = progressPercent;
				printf("Downloading: %s (%d%%)\n", file.name.data(), progressPercent);
				return !this->is_update_cancelled(); // Continue unless cancelled
			});

		if (!data || !data.has_value())
		{
			throw std::runtime_error("Failed to download: " + url + " - Data has no value");
		}

		try
		{
			const auto& result = data.value();
			if (result.code != CURLE_OK)
			{
				throw std::runtime_error("Failed to download: " + url + " - Invalid curl code");
			}

			// Verify downloaded data size
			if (result.buffer.size() != file.size)
			{
				throw std::runtime_error("Downloaded file size mismatch for " + file.name +
					": expected " + std::to_string(file.size) +
					", got " + std::to_string(result.buffer.size()));
			}

			// Verify downloaded data hash
			const auto downloaded_hash = utils::cryptography::sha1::compute(result.buffer, true);
			if (downloaded_hash != file.hash)
			{
				throw std::runtime_error("Downloaded file hash mismatch for " + file.name);
			}

			// Write verified file
			const auto out_file = (this->get_unlock_directory() / file.name).string();
			if (!utils::io::write_file(out_file, result.buffer, false))
			{
				throw std::runtime_error("Failed to write: " + file.name);
			}

			if (this->progress_listener_)
			{
				this->progress_listener_->end_file(file);
			}
		}
		catch (const std::exception& e)
		{
			throw std::runtime_error(e.what());
		}
		catch (...)
		{
			throw std::runtime_error("Unknown error occurred while downloading: " + file.name);
		}
	}

	bool unlockall::is_already_unlocked(const std::vector<updater::file_info>& file_infos) const
	{
		if (file_infos.empty())
		{
			return false; //assume not unlocked
		}

		for (const auto& file_info : file_infos)
		{
			if (!verify_unlock_file(file_info))
			{
				return false;
			}
		}

		return true;
	}

	bool unlockall::is_update_cancelled() const
	{
		return (this->progress_listener_ && this->progress_listener_->is_update_cancelled());
	}

	void unlockall::check_cancelled() const
	{
		if (this->is_update_cancelled())
		{
			throw std::runtime_error("Unlock all was cancelled");
		}
	}
}