#pragma once

#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace mods::zip
{
    struct entry
    {
        uint32_t index{};
        std::string name;
        uint64_t size{};
        bool directory{};
        // Stored or deflate, not encrypted, not a symlink.
        bool supported{};
    };

    class reader
    {
    public:
        static std::optional<reader> open(const std::filesystem::path& archive, std::string& error);

        reader(reader&& other) noexcept;
        reader& operator=(reader&& other) noexcept;
        ~reader();

        [[nodiscard]] const std::vector<entry>& entries() const;

        // Streams one entry's contents; on_data returns false to cancel. Returns an error, "cancelled", or empty once the CRC checks out.
        std::string read(const entry& item, const std::function<bool(const char* data, size_t size)>& on_data) const;

    private:
        struct impl;
        explicit reader(std::unique_ptr<impl> state);
        std::unique_ptr<impl> impl_;
    };
}
