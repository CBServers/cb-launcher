#pragma once

#include <string>
#include <vector>

namespace redist
{
    enum class detect_kind
    {
        registry_dword,
        file_exists,
    };

    struct detect_rule
    {
        detect_kind kind;
        std::wstring path;
        std::wstring value_name;
        unsigned long expected = 1;
    };

    struct package_def
    {
        std::string id;
        std::string name;
        std::string url;
        std::string filename;
        std::string install_args;
        bool is_directx = false;
        std::vector<detect_rule> detect;
    };

    const std::vector<package_def>& all_packages();
}
