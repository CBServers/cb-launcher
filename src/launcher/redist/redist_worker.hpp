#pragma once

#include <filesystem>
#include <string>

namespace redist
{
    constexpr auto REDIST_PIPE_NAME = L"\\\\.\\pipe\\cbservers-launcher-redist";
    constexpr int REDIST_PROTOCOL_VERSION = 1;

    // Downloaded-installer cache, shared by the launcher (writer) and the elevated worker (reader).
    std::filesystem::path cache_dir();

    // Entry point for the elevated child ("-redist-worker id1,id2,...").
    // Exit codes: 0 = all requested packages installed, 1 = one or more failed, 2 = fatal.
    int run_worker(const std::string& ids_csv);
}
