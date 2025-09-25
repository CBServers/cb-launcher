#pragma once
#include <filesystem>

namespace utils::compression
{
	void decompress(const std::filesystem::path& file, const std::filesystem::path& into);
}
