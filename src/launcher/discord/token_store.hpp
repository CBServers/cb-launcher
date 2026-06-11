#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace discord::token_store
{
    struct tokens
    {
        std::string access_token;
        std::string refresh_token;
        int64_t expires_at{0};
    };

    void save(const tokens& t);
    std::optional<tokens> load();
    void clear();
}
