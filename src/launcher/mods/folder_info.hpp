#pragma once

namespace mods
{
    // What a mod or map folder says about itself; any field can be empty.
    struct folder_info
    {
        std::string name;
        std::string author;
        std::string description;
        std::string version;
    };

    // Reads mod.json / info.json / meta.json, <folder>.arena and desc.txt, first match per field.
    folder_info read_folder_info(const std::filesystem::path& directory);
}
