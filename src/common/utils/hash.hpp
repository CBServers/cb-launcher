#pragma once

#include <string>
#include <cstdint>
#include <functional>
#include <filesystem>

struct XXH3_state_s;

namespace utils::hash
{
    // cancel_check is invoked between read chunks. It may throw to abort hashing.
    using cancel_check = std::function<void()>;

    std::string get_file_hash(const std::filesystem::path& file, const cancel_check& check = {});
    std::string get_buffer_hash(std::string& buffer);

    // Digests data as it arrives, producing the same hash get_file_hash would for the same bytes.
    class stream_hasher
    {
    public:
        stream_hasher();
        ~stream_hasher();

        stream_hasher(const stream_hasher&) = delete;
        stream_hasher& operator=(const stream_hasher&) = delete;

        void update(const void* data, std::size_t size);
        [[nodiscard]] std::string digest() const;

    private:
        XXH3_state_s* state_{};
    };
}
