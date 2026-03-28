#pragma once

#include <string>
#include <cstdint>

namespace utils::hash
{
    std::string get_file_hash(const std::string& file);
    std::string get_buffer_hash(std::string& buffer);
}
