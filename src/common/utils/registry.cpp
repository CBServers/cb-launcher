#include "registry.hpp"

#include <Windows.h>

namespace utils::registry
{
    bool hkcu_string_value_exists(const std::wstring& subkey, const std::wstring& value_name)
    {
        HKEY key{};
        if (RegOpenKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, KEY_QUERY_VALUE, &key) != ERROR_SUCCESS)
        {
            return false;
        }

        DWORD type = 0;
        DWORD size = 0;
        const auto status = RegQueryValueExW(key, value_name.c_str(), nullptr, &type, nullptr, &size);
        RegCloseKey(key);

        if (status != ERROR_SUCCESS)
        {
            return false;
        }

        if (type != REG_SZ && type != REG_EXPAND_SZ)
        {
            return false;
        }

        // size includes the terminating null (in bytes). An empty string is just the null terminator (sizeof(wchar_t)).
        return size > sizeof(wchar_t);
    }

    bool set_hkcu_string(const std::wstring& subkey, const std::wstring& value_name, const std::wstring& value)
    {
        HKEY key{};
        if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE,
                            KEY_WRITE, nullptr, &key, nullptr) != ERROR_SUCCESS)
        {
            return false;
        }

        const auto byte_size = static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t));
        const auto status = RegSetValueExW(key, value_name.c_str(), 0, REG_SZ,
                                           reinterpret_cast<const BYTE*>(value.c_str()), byte_size);
        RegCloseKey(key);

        return status == ERROR_SUCCESS;
    }

    bool ensure_hkcu_key_exists(const std::wstring& subkey)
    {
        HKEY key{};
        if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr, REG_OPTION_NON_VOLATILE,
                            KEY_WRITE, nullptr, &key, nullptr) != ERROR_SUCCESS)
        {
            return false;
        }
        RegCloseKey(key);
        return true;
    }
}
