#pragma once

#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace mod_download
{
    struct request
    {
        std::string name;
        // https:// URLs or cdn:<path> (resolved against the active mirror); several are the ordered parts of one file.
        std::vector<std::string> links;
        uint64_t size{};
        std::string hash;
    };

    // Streams into <target>.<hash>.part (resumable across runs), checks size and hash, then moves it over target.
    // Returns an error message, "cancelled", or empty on success.
    std::string download(const request& file, const std::filesystem::path& target, const std::function<bool(uint64_t)>& on_progress);

    // The resume state download() leaves beside target.
    bool has_partial(const std::filesystem::path& target, const std::string& hash);
    uint64_t partial_size(const std::filesystem::path& target, const std::string& hash);
    void remove_partial(const std::filesystem::path& target, const std::string& hash);
}
