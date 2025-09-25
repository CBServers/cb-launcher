#pragma once

#include <string>

namespace utils::cryptography
{
	namespace sha1
	{
		std::string compute(const std::string& data, bool hex = false);
		std::string compute(const uint8_t* data, size_t length, bool hex = false);
	}
}
