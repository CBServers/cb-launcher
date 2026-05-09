#pragma once

#include <string>

namespace utils::registry
{
    bool hkcu_string_value_exists(const std::wstring& subkey, const std::wstring& value_name);

    bool set_hkcu_string(const std::wstring& subkey, const std::wstring& value_name, const std::wstring& value);
}
