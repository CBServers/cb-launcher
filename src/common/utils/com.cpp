#include "com.hpp"
#include "nt.hpp"
#include "string.hpp"

#include <stdexcept>

#include <ShlObj.h>
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

        auto wide_title = std::wstring{ title.begin(), title.end() };
        if (FAILED(file_dialog->SetTitle(wide_title.data())))
        {
            throw std::runtime_error("Failed to set title");
        }

        if (!selected_folder.empty())
        {
            file_dialog->ClearClientData();

            auto wide_selected_folder = std::wstring{ selected_folder.begin(), selected_folder.end() };
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

    std::filesystem::path get_desktop_path()
    {
        PWSTR path = nullptr;
        if (FAILED(SHGetKnownFolderPath(FOLDERID_Desktop, 0, nullptr, &path)))
        {
            return {};
        }

        const auto _ = finally([&path]
        {
            CoTaskMemFree(path);
        });

        return std::filesystem::path(path);
    }

    bool create_shortcut(
        const std::filesystem::path& target_path,
        const std::filesystem::path& shortcut_path,
        const std::string& description,
        const std::filesystem::path& working_directory)
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
