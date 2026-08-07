#pragma once

#include <string>
#include <vector>

namespace redist
{
    enum class detect_kind
    {
        registry_dword,
        registry_key_exists,
        file_exists,
        directory_prefix_exists,
    };

    struct detect_rule
    {
        detect_kind kind;
        std::vector<std::wstring> paths;
        std::wstring value_name;
        unsigned long expected = 1;
    };

    // An alternative passes when all of its rules pass; paths within a rule are OR'd.
    using detect_alternative = std::vector<detect_rule>;

    struct package_def
    {
        std::string id;
        std::string group_id;
        std::string group_name;
        std::string arch;
        std::string url;
        std::string filename;
        std::string install_args;
        bool is_directx = false;
        // Installed when any alternative passes (registry fast path first, then files on disk).
        std::vector<detect_alternative> detect;
    };

    const std::vector<package_def>& all_packages();
}
