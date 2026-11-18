#include "std_include.hpp"
#include "zip_reader.hpp"

#include <utils/finally.hpp>
#include <utils/io.hpp>

#include <miniz.h>

namespace mods::zip
{
    namespace
    {
        constexpr size_t READ_CHUNK = 1 << 20;
        constexpr mz_uint8 HOST_UNIX = 3;
        constexpr mz_uint32 MODE_TYPE_MASK = 0170000;
        constexpr mz_uint32 MODE_SYMLINK = 0120000;

        bool is_symlink(const mz_zip_archive_file_stat& stat)
        {
            return (stat.m_version_made_by >> 8) == HOST_UNIX && ((stat.m_external_attr >> 16) & MODE_TYPE_MASK) == MODE_SYMLINK;
        }
    }

    struct reader::impl
    {
        FILE* file{};
        mz_zip_archive zip{};
        std::vector<entry> entries;

        ~impl()
        {
            mz_zip_reader_end(&zip);
            if (file)
            {
                fclose(file);
            }
        }
    };

    reader::reader(std::unique_ptr<impl> state) : impl_(std::move(state))
    {
    }

    reader::reader(reader&& other) noexcept = default;
    reader& reader::operator=(reader&& other) noexcept = default;
    reader::~reader() = default;

    std::optional<reader> reader::open(const std::filesystem::path& archive, std::string& error)
    {
        auto state = std::make_unique<impl>();
        if (_wfopen_s(&state->file, archive.c_str(), L"rb") != 0 || !state->file)
        {
            state->file = nullptr;
            error = "The zip archive could not be opened.";
            return std::nullopt;
        }

        if (!mz_zip_reader_init_cfile(&state->zip, state->file, utils::io::file_size(archive), 0))
        {
            error = "The file is not a valid zip archive.";
            return std::nullopt;
        }

        const auto count = mz_zip_reader_get_num_files(&state->zip);
        state->entries.reserve(count);
        for (mz_uint i = 0; i < count; ++i)
        {
            mz_zip_archive_file_stat stat{};
            if (!mz_zip_reader_file_stat(&state->zip, i, &stat))
            {
                error = "Failed to read the zip archive.";
                return std::nullopt;
            }

            entry item{};
            item.index = i;
            item.name = stat.m_filename;
            item.size = stat.m_uncomp_size;
            item.directory = stat.m_is_directory;
            item.supported = stat.m_is_supported && !stat.m_is_encrypted && !is_symlink(stat)
                && (stat.m_method == 0 || stat.m_method == MZ_DEFLATED);
            state->entries.push_back(std::move(item));
        }

        return reader(std::move(state));
    }

    const std::vector<entry>& reader::entries() const
    {
        return impl_->entries;
    }

    std::string reader::read(const entry& item, const std::function<bool(const char* data, size_t size)>& on_data) const
    {
        if (!item.supported || item.directory)
        {
            return "Unsupported zip entry " + item.name;
        }

        auto* iter = mz_zip_reader_extract_iter_new(&impl_->zip, item.index, 0);
        if (!iter)
        {
            return "Failed to read " + item.name + " from the zip archive";
        }

        auto freed = false;
        const auto release = utils::finally([&] { if (!freed) mz_zip_reader_extract_iter_free(iter); });

        std::vector<char> buffer(READ_CHUNK);
        uint64_t total = 0;
        while (total < item.size)
        {
            const auto read = mz_zip_reader_extract_iter_read(iter, buffer.data(), buffer.size());
            if (read == 0)
            {
                return "Failed to read " + item.name + " from the zip archive";
            }

            total += read;
            if (!on_data(buffer.data(), read))
            {
                return "cancelled";
            }
        }

        freed = true;
        if (!mz_zip_reader_extract_iter_free(iter))
        {
            return "The zip archive is damaged (" + item.name + ")";
        }

        return {};
    }
}
