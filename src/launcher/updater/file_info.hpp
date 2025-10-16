#pragma once

#include <string>
#include <vector>

namespace launcher_updater
{
	struct file_info
	{
		std::string name;
		std::size_t size;
		std::string hash;
	};
}

namespace game_updater
{
	struct file_info
	{
		std::string name;
		std::size_t size;
		std::string hash;
	};

	struct update_manifest
	{
		std::string hash;
		std::vector<file_info> files;

		bool empty() const
		{
			return (hash.empty() || files.empty());
		}
	};
}

namespace client_updater
{
	struct file_info
	{
		std::string name;
		std::size_t size;
		std::string hash;
	};
}
