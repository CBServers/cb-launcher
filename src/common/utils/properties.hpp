#pragma once

#include "named_mutex.hpp"
#include <mutex>
#include <optional>
#include <filesystem>

namespace utils::properties
{
    std::filesystem::path get_appdata_path();
    std::filesystem::path get_appdata_folder_path(const std::string& folder);

    // Portable mode: -portable flag or a marker file inside the exe-side data folder.
    bool is_portable();
    std::filesystem::path get_portable_root();
    std::filesystem::path get_local_root();
    std::filesystem::path get_portable_marker();
    // Left in the new root by a data move; its presence tells the next start to delete the other root.
    std::filesystem::path get_move_marker(const std::filesystem::path& root);

    std::unique_lock<named_mutex> lock();

    std::optional<std::string> load(const std::string& name);
    void store(const std::string& name, const std::string& value);
}
