#pragma once

#include "nt.hpp"
#include <ShlObj.h>
#include <atlbase.h>

namespace utils::com
{
    bool select_folder(std::string& out_folder, const std::string& title = "Select a Folder", const std::string& selected_folder = {});
    CComPtr<IProgressDialog> create_progress_dialog();

    std::filesystem::path get_desktop_path();
    std::filesystem::path get_start_menu_programs_path();
    std::filesystem::path read_shortcut_target(const std::filesystem::path& shortcut_path);
    std::wstring read_shortcut_app_user_model_id(const std::filesystem::path& shortcut_path);
    // app_user_model_id, when set, is stamped onto the link so Windows can resolve the app's
    // toast notifications back to it.
    bool create_shortcut(
        const std::filesystem::path& target_path,
        const std::filesystem::path& shortcut_path,
        const std::string& description,
        const std::filesystem::path& working_directory = {},
        const std::wstring& app_user_model_id = {});
}
