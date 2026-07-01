#include "std_include.hpp"
#include "uri_scheme.hpp"

#include "deep_link.hpp"

#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/string.hpp>

#include <cstdio>

namespace uri_scheme
{
    namespace
    {
        bool set_key_value(const std::wstring& subkey, const wchar_t* name, const std::wstring& value)
        {
            HKEY key{};
            if (RegCreateKeyExW(HKEY_CURRENT_USER, subkey.c_str(), 0, nullptr, 0,
                                KEY_WRITE, nullptr, &key, nullptr) != ERROR_SUCCESS)
            {
                return false;
            }

            const auto bytes = static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t));
            const auto rc = RegSetValueExW(key, name, 0, REG_SZ,
                                           reinterpret_cast<const BYTE*>(value.c_str()), bytes);
            RegCloseKey(key);
            return rc == ERROR_SUCCESS;
        }
    }

    void ensure_registered()
    {
        try
        {
            const auto exe = utils::nt::library{}.get_path();
            const auto exe_utf8 = utils::string::path_to_utf8(exe);

            // Already registered for this exe? Nothing to do.
            const auto stored = utils::properties::load(property_keys::URI_SCHEME_PATH);
            if (stored.has_value() && stored.value() == exe_utf8)
            {
                return;
            }

            const std::wstring exe_w = exe.wstring();
            const std::wstring root = std::wstring(L"Software\\Classes\\") + utils::string::convert(deep_link::SCHEME);

            const auto ok =
                set_key_value(root, nullptr, L"URL:CB Servers Protocol") &&
                set_key_value(root, L"URL Protocol", L"") &&
                set_key_value(root + L"\\DefaultIcon", nullptr, L"\"" + exe_w + L"\",0") &&
                set_key_value(root + L"\\shell\\open\\command", nullptr, L"\"" + exe_w + L"\" \"%1\"");

            if (ok)
            {
                utils::properties::store(property_keys::URI_SCHEME_PATH, exe_utf8);
            }
        }
        catch (...)
        {
            printf("Error registering cbservers:// URL scheme\n");
        }
    }
}
