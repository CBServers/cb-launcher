#pragma once

#include <filesystem>
#include <string>

namespace discord::avatar_cache
{
    // Resolves a Discord CDN avatar URL to a local PNG, downloading it once and reusing it after.
    // Blocking — call off the UI thread. Returns empty if the URL is unusable or the fetch fails.
    std::filesystem::path fetch(const std::string& url);

    // Trims the cache back to a bounded size, oldest first.
    void prune();
}
