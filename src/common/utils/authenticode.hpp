#pragma once

#include <filesystem>

namespace utils::authenticode
{
    // True when `file` carries a valid embedded Authenticode signature chaining to a
    // trusted root and the signer's subject name starts with "Microsoft".
    bool verify_microsoft_signature(const std::filesystem::path& file);
}
