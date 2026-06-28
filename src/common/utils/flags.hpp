#pragma once

#include <optional>
#include <string>

namespace utils::flags
{
    bool has_flag(const std::string& flag);
    void add_flag(const std::string& flag);
    std::optional<std::string> get_flag_value(const std::string& flag);
}
