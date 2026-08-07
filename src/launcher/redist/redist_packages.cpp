#include <std_include.hpp>

#include "redist_packages.hpp"

namespace redist
{
    namespace
    {
        constexpr auto UNINSTALL_64 = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\";
        constexpr auto UNINSTALL_32 = L"SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\";

        std::vector<std::wstring> uninstall_keys(const std::wstring& prefix, std::initializer_list<const wchar_t*> guids)
        {
            std::vector<std::wstring> out;
            out.reserve(guids.size());
            for (const auto* g : guids) out.emplace_back(prefix + g);
            return out;
        }
    }

    namespace
    {
        // Runtime-files alternative: all listed files/dirs must exist (registry can drift, DLLs cannot).
        detect_alternative system_dlls(const wchar_t* dir, std::initializer_list<const wchar_t*> names)
        {
            detect_alternative alt;
            for (const auto* name : names)
            {
                alt.push_back({ detect_kind::file_exists,
                    { std::wstring(L"%SystemRoot%\\") + dir + L"\\" + name }, L"", 0 });
            }
            return alt;
        }

        detect_alternative winsxs_assembly(const wchar_t* prefix)
        {
            return {{ detect_kind::directory_prefix_exists,
                { std::wstring(L"%SystemRoot%\\WinSxS\\") + prefix }, L"", 0 }};
        }
    }

    const std::vector<package_def>& all_packages()
    {
        static const std::vector<package_def> packages = {
            {
                "vcr2005_x86", "vcr2005", "Visual C++ 2005 SP1", "x86",
                "https://download.microsoft.com/download/8/B/4/8B42259F-5D70-43F4-AC2E-4B208FD8D66A/vcredist_x86.exe",
                "vcredist2005_x86.exe",
                "/q",
                false,
                {
                    {{ detect_kind::registry_key_exists, uninstall_keys(UNINSTALL_32, {
                        L"{7299052B-02A4-4627-81F2-1818DA5D550D}",
                        L"{837b34e3-7c30-493c-8f6a-2b0f04e2912c}",
                        L"{710f4c1c-cc18-4c49-8cbf-51240c89a1a2}",
                    }), L"", 0 }},
                    winsxs_assembly(L"x86_microsoft.vc80.crt_1fc8b3b9a1e18e3b"),
                }
            },
            {
                "vcr2005_x64", "vcr2005", "Visual C++ 2005 SP1", "x64",
                "https://download.microsoft.com/download/8/B/4/8B42259F-5D70-43F4-AC2E-4B208FD8D66A/vcredist_x64.exe",
                "vcredist2005_x64.exe",
                "/q",
                false,
                {
                    {{ detect_kind::registry_key_exists, uninstall_keys(UNINSTALL_64, {
                        L"{071c9b48-7c32-4621-a0ac-3f809523288f}",
                        L"{6ce5bae9-d3ca-4b99-891a-1dc6c118a5fc}",
                        L"{ad8a2fa1-06e7-4b0d-927d-6e54b3d31028}",
                    }), L"", 0 }},
                    winsxs_assembly(L"amd64_microsoft.vc80.crt_1fc8b3b9a1e18e3b"),
                }
            },
            {
                "vcr2008_x86", "vcr2008", "Visual C++ 2008 SP1", "x86",
                "https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x86.exe",
                "vcredist2008_x86.exe",
                "/q",
                false,
                {
                    {{ detect_kind::registry_key_exists, uninstall_keys(UNINSTALL_32, {
                        L"{9A25302D-30C0-39D9-BD6F-21E6EC160475}",
                        L"{9BE518E6-ECC6-35A9-88E4-87755C07200F}",
                        L"{1F1C2DFC-2D24-3E06-BCB8-725134ADF989}",
                    }), L"", 0 }},
                    winsxs_assembly(L"x86_microsoft.vc90.crt_1fc8b3b9a1e18e3b"),
                }
            },
            {
                "vcr2008_x64", "vcr2008", "Visual C++ 2008 SP1", "x64",
                "https://download.microsoft.com/download/5/D/8/5D8C65CB-C849-4025-8E95-C3966CAFD8AE/vcredist_x64.exe",
                "vcredist2008_x64.exe",
                "/q",
                false,
                {
                    {{ detect_kind::registry_key_exists, uninstall_keys(UNINSTALL_64, {
                        L"{8220EEFE-38CD-377E-8595-13398D740ACE}",
                        L"{5FCE6D76-F5DC-37AB-B2B8-22AB8CEDB1D4}",
                        L"{4B6C7001-C7D6-3710-913E-5BC23FCE91E6}",
                    }), L"", 0 }},
                    winsxs_assembly(L"amd64_microsoft.vc90.crt_1fc8b3b9a1e18e3b"),
                }
            },
            {
                "vcr2010_x86", "vcr2010", "Visual C++ 2010 SP1", "x86",
                "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x86.exe",
                "vcredist2010_x86.exe",
                "/q /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\10.0\\VC\\VCRedist\\x86" }, L"Installed", 1 }},
                    system_dlls(L"SysWOW64", { L"msvcr100.dll", L"msvcp100.dll" }),
                }
            },
            {
                "vcr2010_x64", "vcr2010", "Visual C++ 2010 SP1", "x64",
                "https://download.microsoft.com/download/1/6/5/165255E7-1014-4D0A-B094-B6A430A6BFFC/vcredist_x64.exe",
                "vcredist2010_x64.exe",
                "/q /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\10.0\\VC\\VCRedist\\x64" }, L"Installed", 1 }},
                    system_dlls(L"System32", { L"msvcr100.dll", L"msvcp100.dll" }),
                }
            },
            {
                "vcr2012_x86", "vcr2012", "Visual C++ 2012 Update 4", "x86",
                "https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x86.exe",
                "vcredist2012_x86.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\11.0\\VC\\Runtimes\\x86" }, L"Installed", 1 }},
                    system_dlls(L"SysWOW64", { L"msvcr110.dll", L"msvcp110.dll" }),
                }
            },
            {
                "vcr2012_x64", "vcr2012", "Visual C++ 2012 Update 4", "x64",
                "https://download.microsoft.com/download/1/6/B/16B06F60-3B20-4FF2-B699-5E9B7962F9AE/VSU_4/vcredist_x64.exe",
                "vcredist2012_x64.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\11.0\\VC\\Runtimes\\x64" }, L"Installed", 1 }},
                    system_dlls(L"System32", { L"msvcr110.dll", L"msvcp110.dll" }),
                }
            },
            {
                "vcr2013_x86", "vcr2013", "Visual C++ 2013", "x86",
                "https://aka.ms/highdpimfc2013x86enu",
                "vcredist2013_x86.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\12.0\\VC\\Runtimes\\x86" }, L"Installed", 1 }},
                    system_dlls(L"SysWOW64", { L"msvcr120.dll", L"msvcp120.dll" }),
                }
            },
            {
                "vcr2013_x64", "vcr2013", "Visual C++ 2013", "x64",
                "https://aka.ms/highdpimfc2013x64enu",
                "vcredist2013_x64.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\12.0\\VC\\Runtimes\\x64" }, L"Installed", 1 }},
                    system_dlls(L"System32", { L"msvcr120.dll", L"msvcp120.dll" }),
                }
            },
            {
                "vcr2022_x86", "vcr2022", "Visual C++ 2015-2022", "x86",
                "https://aka.ms/vs/17/release/vc_redist.x86.exe",
                "vc_redist2022_x86.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86" }, L"Installed", 1 }},
                    system_dlls(L"SysWOW64", { L"vcruntime140.dll", L"msvcp140.dll" }),
                }
            },
            {
                "vcr2022_x64", "vcr2022", "Visual C++ 2015-2022", "x64",
                "https://aka.ms/vs/17/release/vc_redist.x64.exe",
                "vc_redist2022_x64.exe",
                "/install /quiet /norestart",
                false,
                {
                    {{ detect_kind::registry_dword, { L"SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64" }, L"Installed", 1 }},
                    system_dlls(L"System32", { L"vcruntime140.dll", L"msvcp140.dll" }),
                }
            },
            {
                "dx_jun2010", "dx_jun2010", "DirectX (June 2010 Redist)", "",
                "https://download.microsoft.com/download/8/4/A/84A35BF1-DAFE-4AE8-82AF-AD2AE20B6B14/directx_Jun2010_redist.exe",
                "directx_Jun2010_redist.exe",
                "/silent",
                true,
                {
                    {
                        { detect_kind::file_exists, { L"%SystemRoot%\\System32\\D3DX9_43.dll" }, L"", 0 },
                        { detect_kind::file_exists, { L"%SystemRoot%\\SysWOW64\\D3DX9_43.dll" }, L"", 0 },
                    },
                }
            },
        };
        return packages;
    }
}
