#include <std_include.hpp>

#include "redist_packages.hpp"

namespace redist
{
    const std::vector<package_def>& all_packages()
    {
        static const std::vector<package_def> packages = {
            {
                "vcr2010_x86",
                "Visual C++ 2010 SP1 x86",
                "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe",
                "vcredist2010_x86.exe",
                "/q /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\10.0\\VC\\VCRedist\\x86", L"Installed", 1 }}
            },
            {
                "vcr2010_x64",
                "Visual C++ 2010 SP1 x64",
                "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe",
                "vcredist2010_x64.exe",
                "/q /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\10.0\\VC\\VCRedist\\x64", L"Installed", 1 }}
            },
            {
                "vcr2013_x86",
                "Visual C++ 2013 x86",
                "https://aka.ms/highdpimfc2013x86enu",
                "vcredist2013_x86.exe",
                "/install /quiet /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\12.0\\VC\\Runtimes\\x86", L"Installed", 1 }}
            },
            {
                "vcr2013_x64",
                "Visual C++ 2013 x64",
                "https://aka.ms/highdpimfc2013x64enu",
                "vcredist2013_x64.exe",
                "/install /quiet /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\12.0\\VC\\Runtimes\\x64", L"Installed", 1 }}
            },
            {
                "vcr2022_x86",
                "Visual C++ 2015-2022 x86",
                "https://aka.ms/vs/17/release/vc_redist.x86.exe",
                "vc_redist2022_x86.exe",
                "/install /quiet /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86", L"Installed", 1 }}
            },
            {
                "vcr2022_x64",
                "Visual C++ 2015-2022 x64",
                "https://aka.ms/vs/17/release/vc_redist.x64.exe",
                "vc_redist2022_x64.exe",
                "/install /quiet /norestart",
                false,
                {{ detect_kind::registry_dword, L"SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64", L"Installed", 1 }}
            },
            {
                "dx_jun2010",
                "DirectX (June 2010 Redist)",
                "https://download.microsoft.com/download/8/4/A/84A35BF1-DAFE-4AE8-82AF-AD2AE20B6B14/directx_Jun2010_redist.exe",
                "directx_Jun2010_redist.exe",
                "/silent",
                true,
                {
                    { detect_kind::file_exists, L"%SystemRoot%\\System32\\D3DX9_43.dll", L"", 0 },
                    { detect_kind::file_exists, L"%SystemRoot%\\SysWOW64\\D3DX9_43.dll", L"", 0 },
                }
            },
        };
        return packages;
    }
}
