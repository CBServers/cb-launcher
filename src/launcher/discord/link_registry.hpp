#pragma once

#include <optional>
#include <string>
#include <vector>

namespace discord::link_registry
{
    bool register_link(const std::string& access_token);
    bool unregister_link(const std::string& access_token);

    // Returns the subset of the given Discord user IDs that have linked the
    // launcher, or nullopt if the registry could not be reached.
    std::optional<std::vector<std::string>> intersect(const std::string& access_token,
                                                      const std::vector<std::string>& ids);
}
