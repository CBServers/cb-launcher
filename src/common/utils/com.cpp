#include "com.hpp"
#include "nt.hpp"
#include "string.hpp"

#include <stdexcept>

#include <ShlObj.h>
#include <propvarutil.h>
#pragma comment(lib, "shlwapi.lib")

#include "finally.hpp"


namespace utils::com
{
    namespace
    {
        [[maybe_unused]] class _
        {
        public:
            _()
            {
                if (FAILED(CoInitialize(nullptr)))
                {
                    throw std::runtime_error("Failed to initialize the component object model");
                }
            }

            ~_()
            {
                CoUninitialize();
            }
        } __;
    }

    bool select_folder(std::string& out_folder, const std::string& title, const std::string& selected_folder)
    {
        CComPtr<IFileOpenDialog> file_dialog{};
        if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&file_dialog))))
        {
            throw std::runtime_error("Failed to create co instance");
        }

        DWORD dw_options;
        if (FAILED(file_dialog->GetOptions(&dw_options)))
        {
            throw std::runtime_error("Failed to get options");
        }

        if (FAILED(file_dialog->SetOptions(dw_options | FOS_PICKFOLDERS | FOS_NOCHANGEDIR)))
        {
            throw std::runtime_error("Failed to set options");
        }

        auto wide_title = string::convert(title);
        if (FAILED(file_dialog->SetTitle(wide_title.data())))
        {
            throw std::runtime_error("Failed to set title");
        }

        if (!selected_folder.empty())
        {
            file_dialog->ClearClientData();

            auto wide_selected_folder = string::convert(selected_folder);
            for (auto& chr : wide_selected_folder)
            {
                if (chr == L'/')
                {
                    chr = L'\\';
                }
            }

            IShellItem* shell_item = nullptr;
            if (FAILED(SHCreateItemFromParsingName(wide_selected_folder.data(), NULL, IID_PPV_ARGS(&shell_item))))
            {
                throw std::runtime_error("Failed to create item from parsing name");
            }

            if (FAILED(file_dialog->SetDefaultFolder(shell_item)))
            {
                throw std::runtime_error("Failed to set default folder");
            }
        }

        const auto result = file_dialog->Show(nullptr);
        if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED))
        {
            return false;
        }

        if (FAILED(result))
        {
            throw std::runtime_error("Failed to show dialog");
        }

        CComPtr<IShellItem> result_item{};
        if (FAILED(file_dialog->GetResult(&result_item)))
        {
            throw std::runtime_error("Failed to get result");
        }

        PWSTR raw_path = nullptr;
        if (FAILED(result_item->GetDisplayName(SIGDN_FILESYSPATH, &raw_path)))
        {
            throw std::runtime_error("Failed to get path display name");
        }

        const auto _ = finally([&raw_path]
        {
            CoTaskMemFree(raw_path);
        });

        const std::wstring result_path = raw_path;
        out_folder = string::convert(result_path);

        return true;
    }

    CComPtr<IProgressDialog> create_progress_dialog()
    {
        CComPtr<IProgressDialog> progress_dialog{};
        if (FAILED(CoCreateInstance(CLSID_ProgressDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&progress_dialog))))
        {
            throw std::runtime_error("Failed to create co instance");
        }

        return progress_dialog;
    }

    namespace
    {
        // Spelled out rather than pulled from <propkey.h>: cef_sandbox.lib also defines
        // PKEY_AppUserModel_ID and wins the link order, dragging in Chromium sandbox objects
        // that reference WinRT/ntdll imports the launcher doesn't link.
        constexpr PROPERTYKEY app_user_model_id_key{
            {0x9F4C2855, 0x9F79, 0x4B39, {0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3}}, 5};

        std::filesystem::path get_known_folder_path(const KNOWNFOLDERID& folder_id)
        {
            PWSTR path = nullptr;
            if (FAILED(SHGetKnownFolderPath(folder_id, 0, nullptr, &path)))
            {
                return {};
            }

            const auto _ = finally([&path]
            {
                CoTaskMemFree(path);
            });

            return std::filesystem::path(path);
        }
    }

    std::filesystem::path get_desktop_path()
    {
        return get_known_folder_path(FOLDERID_Desktop);
    }

    std::filesystem::path get_start_menu_programs_path()
    {
        return get_known_folder_path(FOLDERID_Programs);
    }

    std::filesystem::path read_shortcut_target(const std::filesystem::path& shortcut_path)
    {
        CComPtr<IShellLinkW> shell_link{};
        if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&shell_link))))
        {
            return {};
        }

        CComPtr<IPersistFile> persist_file{};
        if (FAILED(shell_link->QueryInterface(IID_PPV_ARGS(&persist_file))))
        {
            return {};
        }

        if (FAILED(persist_file->Load(shortcut_path.c_str(), STGM_READ)))
        {
            return {};
        }

        wchar_t target[MAX_PATH]{};
        // SLGP_RAWPATH: read the literal stored target, don't let link-tracking auto-resolve a moved exe
        if (FAILED(shell_link->GetPath(target, MAX_PATH, nullptr, SLGP_RAWPATH)))
        {
            return {};
        }

        return std::filesystem::path(target);
    }

    std::wstring read_shortcut_app_user_model_id(const std::filesystem::path& shortcut_path)
    {
        CComPtr<IShellLinkW> shell_link{};
        if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&shell_link))))
        {
            return {};
        }

        CComPtr<IPersistFile> persist_file{};
        if (FAILED(shell_link->QueryInterface(IID_PPV_ARGS(&persist_file))))
        {
            return {};
        }

        if (FAILED(persist_file->Load(shortcut_path.c_str(), STGM_READ)))
        {
            return {};
        }

        CComPtr<IPropertyStore> property_store{};
        if (FAILED(shell_link->QueryInterface(IID_PPV_ARGS(&property_store))))
        {
            return {};
        }

        PROPVARIANT value{};
        if (FAILED(property_store->GetValue(app_user_model_id_key, &value)))
        {
            return {};
        }

        const auto _ = finally([&value]
        {
            PropVariantClear(&value);
        });

        return value.vt == VT_LPWSTR && value.pwszVal ? std::wstring{value.pwszVal} : std::wstring{};
    }

    bool create_shortcut(
        const std::filesystem::path& target_path,
        const std::filesystem::path& shortcut_path,
        const std::string& description,
        const std::filesystem::path& working_directory,
        const std::wstring& app_user_model_id)
    {
        CComPtr<IShellLinkW> shell_link{};
        if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&shell_link))))
        {
            return false;
        }

        shell_link->SetPath(target_path.c_str());
        shell_link->SetDescription(string::convert(description).data());

        if (!working_directory.empty())
        {
            shell_link->SetWorkingDirectory(working_directory.c_str());
        }
        else
        {
            shell_link->SetWorkingDirectory(target_path.parent_path().c_str());
        }

        // Must be stamped before the link is saved, or the property never lands on disk.
        if (!app_user_model_id.empty())
        {
            CComPtr<IPropertyStore> property_store{};
            if (SUCCEEDED(shell_link->QueryInterface(IID_PPV_ARGS(&property_store))))
            {
                PROPVARIANT value{};
                if (SUCCEEDED(InitPropVariantFromString(app_user_model_id.data(), &value)))
                {
                    property_store->SetValue(app_user_model_id_key, value);
                    property_store->Commit();
                    PropVariantClear(&value);
                }
            }
        }

        CComPtr<IPersistFile> persist_file{};
        if (FAILED(shell_link->QueryInterface(IID_PPV_ARGS(&persist_file))))
        {
            return false;
        }

        if (FAILED(persist_file->Save(shortcut_path.c_str(), TRUE)))
        {
            return false;
        }

        return true;
    }
}
