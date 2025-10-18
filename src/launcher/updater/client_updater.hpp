#pragma once

#include "file_info.hpp"
#include "progress_listener.hpp"
#include <game_config.hpp>

namespace client_updater
{
	class client_updater
	{
	public:
		client_updater(const game_config::game_config_t& config, updater::progress_listener* listener = nullptr);

		void run() const;

		[[nodiscard]] std::vector<updater::file_info> get_outdated_files(const std::vector<updater::file_info>& files) const;

		void update_files(const std::vector<updater::file_info>& outdated_files) const;

	private:
		std::filesystem::path install_path;
		std::string update_manifest_url;
		std::string update_folder_url;
		std::vector<std::string> files_to_update;
		updater::progress_listener* progress_listener_;

		void update_file(const updater::file_info& file) const;

		[[nodiscard]] bool is_outdated_file(const updater::file_info& file) const;
		[[nodiscard]] std::filesystem::path get_drive_filename(const updater::file_info& file) const;
		[[nodiscard]] bool is_update_cancelled() const;
	};
}
