#pragma once

#include <string>
#include <cstdint>

namespace utils::hash
{
	struct DB_AuthHash
	{
		unsigned char bytes[32];
	};

	struct DB_AuthSignature
	{
		unsigned char bytes[256];
	};

	struct XPakHeader
	{
		char header[8];
		std::int32_t version;
		unsigned char unknown[16];
		DB_AuthHash hash;
		DB_AuthSignature signature;
	};

	std::string get_file_hash(const std::string& file);
	std::string get_buffer_hash(std::string& buffer, const std::string& filename);
}
