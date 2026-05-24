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
    };

    struct detect_rule
    {
        detect_kind kind;
        std::vector<std::wstring> paths;
        std::wstring value_name;
        unsigned long expected = 1;
    };

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
        std::vector<detect_rule> detect;
    };

    const std::vector<package_def>& all_packages();
}
