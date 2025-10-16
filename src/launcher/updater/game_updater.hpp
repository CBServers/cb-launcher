#pragma once

#include "file_info.hpp"
#include <string>
#include <filesystem>
#include <game_config.hpp>

namespace game_updater
{
	class game_updater
	{
	public:
		game_updater(const game_config::game_config_t& config, bool force_update);

		void run(bool& update_needed) const;

		[[nodiscard]] std::vector<file_info> get_outdated_files(const std::vector<file_info>& files) const;

		void update_files(const std::vector<file_info>& outdated_files) const;
		bool needs_to_update(const std::string& hash) const;

	private:
		std::filesystem::path install_path;
		std::string base_url;
		bool force_update;

		void update_file(const file_info& file) const;

		std::size_t get_update_size(const std::vector<file_info>& files) const;
		std::size_t get_available_drive_space() const;

		[[nodiscard]] bool is_outdated_file(const file_info& file) const;
		[[nodiscard]] std::string get_drive_filename(const file_info& file) const;
		[[nodiscard]] std::string get_manifest_file_path() const;
	};
}
