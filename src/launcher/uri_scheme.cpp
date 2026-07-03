#include "std_include.hpp"
#include "uri_scheme.hpp"

#include "deep_link.hpp"

#include <utils/nt.hpp>
#include <utils/registry.hpp>
#include <utils/string.hpp>

#include <cstdio>

namespace uri_scheme
{
    void ensure_registered()
    {
        try
        {
            const std::wstring exe_w = utils::nt::library{}.get_path().wstring();
            const std::wstring root = std::wstring(L"Software\\Classes\\") + utils::string::convert(deep_link::SCHEME);
            const std::wstring command = L"\"" + exe_w + L"\" \"%1\"";

            // Gate on the actual registry state so deleted or hijacked keys get repaired too.
            const auto current = utils::registry::get_hkcu_string(root + L"\\shell\\open\\command", L"");
            if (current.has_value() && current.value() == command)
            {
                return;
            }

            utils::registry::set_hkcu_string(root, L"", L"URL:CB Servers Protocol");
            utils::registry::set_hkcu_string(root, L"URL Protocol", L"");
            utils::registry::set_hkcu_string(root + L"\\DefaultIcon", L"", L"\"" + exe_w + L"\",0");
            utils::registry::set_hkcu_string(root + L"\\shell\\open\\command", L"", command);
        }
        catch (...)
        {
            printf("Error registering cbservers:// URL scheme\n");
        }
    }
}
