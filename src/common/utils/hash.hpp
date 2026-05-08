#pragma once

#include <string>
#include <cstdint>
#include <functional>

namespace utils::hash
{
    // cancel_check is invoked between read chunks. It may throw to abort hashing.
    using cancel_check = std::function<void()>;

    std::string get_file_hash(const std::string& file, const cancel_check& check = {});
    std::string get_buffer_hash(std::string& buffer);
}
