#pragma once

#include <optional>
#include <string>

namespace utils::registry
{
    bool hkcu_string_value_exists(const std::wstring& subkey, const std::wstring& value_name);

    // Queries the 32-bit registry view (WOW6432Node), matching what 32-bit games see.
    bool hklm_wow32_string_value_exists(const std::wstring& subkey, const std::wstring& value_name);

    std::optional<std::wstring> get_hkcu_string(const std::wstring& subkey, const std::wstring& value_name);

    bool set_hkcu_string(const std::wstring& subkey, const std::wstring& value_name, const std::wstring& value);

    bool ensure_hkcu_key_exists(const std::wstring& subkey);
}
