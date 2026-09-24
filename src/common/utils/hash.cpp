#include "hash.hpp"

#include <algorithm>
#include <cstring>
#include <memory>
#include <stdexcept>

#include <xxhash.h>
#include <utils/cryptography.hpp>
#include <utils/finally.hpp>
#include <utils/nt.hpp>
#include <utils/string.hpp>

namespace utils::hash
{
    namespace
    {
        constexpr auto read_buffer_size = 16ull * 1024ull * 1024ull; // 16MB

        std::string get_generic_buffer_hash(const std::string& buffer)
        {
            const auto hash_value = XXH3_64bits(buffer.data(), buffer.size());
            std::string hash;
            hash.append(reinterpret_cast<const char*>(&hash_value), sizeof(hash_value));
            return utils::string::dump_hex(hash, "");
        }
    }

    std::string get_file_hash(const std::filesystem::path& file, const cancel_check& check)
    {
        const auto handle = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
        if (handle == INVALID_HANDLE_VALUE)
        {
            return {};
        }

        const auto _ = utils::finally([&]()
        {
            CloseHandle(handle);
        });

        LARGE_INTEGER file_size{};
        if (!GetFileSizeEx(handle, &file_size))
        {
            return {};
        }

        // Sized to the file so small files don't pay for a 16MB allocation each
        const auto buffer_size = static_cast<DWORD>(std::min(static_cast<std::uint64_t>(file_size.QuadPart), read_buffer_size));
        const auto buffer = std::make_unique_for_overwrite<char[]>(std::max(buffer_size, 1ul));

        stream_hasher hasher{};
        while (true)
        {
            if (check) check();

            DWORD read = 0;
            if (!ReadFile(handle, buffer.get(), buffer_size, &read, nullptr))
            {
                return {};
            }

            if (read == 0)
            {
                break;
            }

            hasher.update(buffer.get(), read);
        }

        return hasher.digest();
    }

    std::string get_buffer_hash(std::string& buffer)
    {
            return get_generic_buffer_hash(buffer);
    }

    stream_hasher::stream_hasher()
        : state_(XXH3_createState())
    {
        if (!this->state_)
        {
            throw std::runtime_error("Failed to allocate hash state");
        }

        XXH3_64bits_reset(this->state_);
    }

    stream_hasher::~stream_hasher()
    {
        if (this->state_)
        {
            XXH3_freeState(this->state_);
        }
    }

    void stream_hasher::update(const void* data, const std::size_t size)
    {
        XXH3_64bits_update(this->state_, data, size);
    }

    std::string stream_hasher::digest() const
    {
        const auto hash_value = XXH3_64bits_digest(this->state_);

        std::string hash;
        hash.append(reinterpret_cast<const char*>(&hash_value), sizeof(hash_value));
        return utils::string::dump_hex(hash, "");
    }
}
