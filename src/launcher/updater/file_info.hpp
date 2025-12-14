#pragma once

#include <string>
#include <vector>
#include <unordered_map>

namespace updater
{
	// Common file_info used by all updaters
	struct file_info
	{
		std::string name;
		std::size_t size;
		std::string hash;
		std::string component; // Component this file belongs to (e.g., "base", "sp", "mp_dlc", "zm_dlc")
	};
}

namespace game_updater
{
	struct component_info
	{
		std::string id;
		std::string display_name;
		bool required;
		bool default_enabled;
		bool show; // Whether to show this component in the UI
		std::size_t total_size; // Total size of this component in bytes
	};

	struct update_manifest
	{
		std::string hash;
		std::vector<updater::file_info> files;
		std::unordered_map<std::string, component_info> components;

		bool empty() const
		{
			return (hash.empty() || files.empty());
		}
	};
}
