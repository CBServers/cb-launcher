#include "hash.hpp"

#include <fstream>
#include <algorithm>
#include <cstring>

#include <xxhash.h>
#include <utils/cryptography.hpp>
#include <utils/string.hpp>

namespace utils::hash
{
    namespace
    {
        constexpr auto read_buffer_size = 16ull * 1024ull * 1024ull; // 16MB

        std::string get_file_hash_generic(std::ifstream& file_stream, const std::size_t file_size, const cancel_check& check)
        {
            XXH3_state_t* state = XXH3_createState();
            if (!state)
            {
                return {};
            }

            XXH3_64bits_reset(state);
            auto bytes_to_read = file_size;

            std::string buffer;
            buffer.resize(read_buffer_size);

            try
            {
                while (bytes_to_read > 0)
                {
                    if (check) check();
                    const auto read_size = std::min(bytes_to_read, read_buffer_size);
                    file_stream.read(buffer.data(), read_size);
                    XXH3_64bits_update(state, buffer.data(), read_size);
                    bytes_to_read -= read_size;
                }
            }
            catch (...)
            {
                XXH3_freeState(state);
                throw;
            }

            const auto hash_value = XXH3_64bits_digest(state);
            XXH3_freeState(state);

            std::string hash;
            hash.append(reinterpret_cast<const char*>(&hash_value), sizeof(hash_value));
            return utils::string::dump_hex(hash, "");
        }

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
        std::ifstream file_stream(file, std::ios::binary);
        if (!file_stream.is_open())
        {
            return {};
        }

        file_stream.seekg(0, std::ios::end);
        const auto file_size = static_cast<std::size_t>(file_stream.tellg());
        file_stream.seekg(0, std::ios::beg);

        return get_file_hash_generic(file_stream, file_size, check);
    }

    std::string get_buffer_hash(std::string& buffer)
    {
            return get_generic_buffer_hash(buffer);
    }
}
