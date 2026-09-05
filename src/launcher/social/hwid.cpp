#include "std_include.hpp"
#include "hwid.hpp"

#include <utils/cryptography.hpp>
#include <utils/string.hpp>

namespace social::hwid
{
    namespace
    {
        // Reads MachineGuid from the 64-bit registry view, which is also what Wine exposes.
        std::string machine_guid()
        {
            wchar_t buffer[128]{};
            DWORD size = sizeof(buffer);
            const auto status = RegGetValueW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography",
                                             L"MachineGuid", RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY,
                                             nullptr, buffer, &size);
            if (status != ERROR_SUCCESS)
            {
                return {};
            }

            return utils::string::convert(std::wstring{buffer});
        }

        // Serial of the volume Windows lives on; changes on a reformat, which is fine for an anchor.
        std::string system_volume_serial()
        {
            wchar_t windows_dir[MAX_PATH]{};
            if (GetWindowsDirectoryW(windows_dir, MAX_PATH) == 0)
            {
                return {};
            }

            const std::wstring root = std::wstring(windows_dir).substr(0, 3);
            DWORD serial = 0;
            if (!GetVolumeInformationW(root.c_str(), nullptr, 0, &serial, nullptr, nullptr, nullptr, 0))
            {
                return {};
            }

            return std::to_string(serial);
        }
    }

    std::string compute()
    {
        std::string material;
        material.append(machine_guid());
        material.push_back('|');
        material.append(system_volume_serial());

        return utils::cryptography::sha256::compute(material, true);
    }
}
