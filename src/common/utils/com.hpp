#pragma once

#include "nt.hpp"
#include <ShlObj.h>
#include <atlbase.h>

namespace utils::com
{
    bool select_folder(std::string& out_folder, const std::string& title = "Select a Folder", const std::string& selected_folder = {});
    CComPtr<IProgressDialog> create_progress_dialog();

    std::filesystem::path get_desktop_path();
    bool create_shortcut(
        const std::filesystem::path& target_path,
        const std::filesystem::path& shortcut_path,
        const std::string& description,
        const std::filesystem::path& working_directory = {});
}
