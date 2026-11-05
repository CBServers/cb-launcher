#pragma once

#include "file_info.hpp"

// A macro so game_config can build client URLs by literal concatenation
#define UPDATER_GITHUB_BASE "https://github.com/CBServers/updater/raw/main/updater/"

namespace update_mirrors
{
    // Source of truth; CBServers/updater's cdn-mirror workflow copies this tree to <cdn>/updater/
    inline constexpr auto GITHUB_BASE = UPDATER_GITHUB_BASE;

    // Manifest from bases[0], files fall back along bases; never another bucket, which may lag and cache the gap
    struct route
    {
        std::vector<std::string> bases;
    };

    // One route per CDN mirror (preferred region first), then GitHub alone
    std::vector<route> routes();

    // Tree path of a URL under GITHUB_BASE, or nullopt for any other URL
    std::optional<std::string> tree_path(const std::string& url);

    struct manifest_result
    {
        std::string body;
        route source;
    };

    // Takes the first route whose manifest answers 2xx and passes valid; throws listing every attempt otherwise
    manifest_result fetch_manifest(const std::vector<route>& routes, const std::string& path,
        const std::function<bool(const std::string&)>& valid);

    enum class fetch_status
    {
        ok,
        cancelled,
    };

    // Downloads a file along the route until size and SHA-1 match; throws listing every attempt otherwise
    fetch_status fetch_file(const route& source, const std::string& folder, const updater::file_info& file,
        const std::function<bool(size_t)>& progress, std::string& data);
}
