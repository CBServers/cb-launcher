#pragma once

namespace updater
{
    // Destination root a client manifest entry installs to. `automatic` = no 4th manifest
    // element, resolved by the legacy client_install_path_files heuristic.
    enum class file_dest
    {
        automatic,
        game,    // the user's game install folder
        appdata  // the client's appdata dir (client_default_path), i.e. the engine's fs_homepath
    };
}
