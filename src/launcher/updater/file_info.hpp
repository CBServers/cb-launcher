#pragma once

#include <string>
#include <vector>

namespace updater
{
	// Common file_info used by all updaters
	struct file_info
	{
		std::string name;
		std::size_t size;
		std::string hash;
	};
}

namespace game_updater
{
	struct update_manifest
	{
		std::string hash;
		std::vector<updater::file_info> files;

		bool empty() const
		{
			return (hash.empty() || files.empty());
		}
	};
}
