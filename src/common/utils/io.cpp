#include "io.hpp"
#include "nt.hpp"
#include "finally.hpp"

#include <winioctl.h>

#include <algorithm>
#include <fstream>
#include <optional>

namespace utils::io
{
    namespace
    {
        // Attributes only: no handle open, so a file the running game holds open still reports its size
        std::optional<std::size_t> query_file_size(const std::filesystem::path& file)
        {
            WIN32_FILE_ATTRIBUTE_DATA data{};
            if (!GetFileAttributesExW(file.c_str(), GetFileExInfoStandard, &data) ||
                (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
            {
                return std::nullopt;
            }

            // A symlink reports its own size (0), so follow it to the target
            if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
            {
                std::error_code ec;
                const auto size = std::filesystem::file_size(file, ec);
                if (ec)
                {
                    return std::nullopt;
                }
                return static_cast<std::size_t>(size);
            }

            return static_cast<std::size_t>(
                (static_cast<std::uint64_t>(data.nFileSizeHigh) << 32) | data.nFileSizeLow);
        }

        // Zero access rights: storage property queries need no elevation
        HANDLE open_device(const std::wstring& name)
        {
            return CreateFileW(name.data(), 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
        }

        struct disk_traits
        {
            bool nvme{};
            bool seek_penalty{true};
        };

        // Unanswered queries keep the pessimistic defaults
        disk_traits query_disk(const DWORD disk_number)
        {
            disk_traits traits{};

            const auto device = open_device(L"\\\\.\\PhysicalDrive" + std::to_wstring(disk_number));
            if (device == INVALID_HANDLE_VALUE)
            {
                return traits;
            }

            const auto _ = utils::finally([&]()
            {
                CloseHandle(device);
            });

            DWORD bytes = 0;
            STORAGE_PROPERTY_QUERY query{StorageDeviceProperty, PropertyStandardQuery};
            STORAGE_DESCRIPTOR_HEADER header{};
            if (DeviceIoControl(device, IOCTL_STORAGE_QUERY_PROPERTY, &query, sizeof(query), &header, sizeof(header), &bytes, nullptr) &&
                header.Size >= sizeof(STORAGE_DEVICE_DESCRIPTOR))
            {
                std::vector<char> descriptor(header.Size);
                if (DeviceIoControl(device, IOCTL_STORAGE_QUERY_PROPERTY, &query, sizeof(query), descriptor.data(),
                    static_cast<DWORD>(descriptor.size()), &bytes, nullptr))
                {
                    traits.nvme = reinterpret_cast<const STORAGE_DEVICE_DESCRIPTOR*>(descriptor.data())->BusType == BusTypeNvme;
                }
            }

            query.PropertyId = StorageDeviceSeekPenaltyProperty;
            DEVICE_SEEK_PENALTY_DESCRIPTOR seek_penalty{};
            if (DeviceIoControl(device, IOCTL_STORAGE_QUERY_PROPERTY, &query, sizeof(query), &seek_penalty,
                sizeof(seek_penalty), &bytes, nullptr) && bytes >= sizeof(seek_penalty))
            {
                traits.seek_penalty = seek_penalty.IncursSeekPenalty != FALSE;
            }

            return traits;
        }

        // Every physical disk behind the path's volume; empty when it can't be resolved (network paths, etc.)
        std::vector<disk_traits> query_volume_disks(const std::filesystem::path& path)
        {
            wchar_t mount_point[MAX_PATH]{};
            wchar_t volume_name[MAX_PATH]{};
            if (!GetVolumePathNameW(path.c_str(), mount_point, MAX_PATH) ||
                !GetVolumeNameForVolumeMountPointW(mount_point, volume_name, MAX_PATH))
            {
                return {};
            }

            std::wstring volume = volume_name;
            if (volume.ends_with(L'\\'))
            {
                volume.pop_back();
            }

            const auto device = open_device(volume);
            if (device == INVALID_HANDLE_VALUE)
            {
                return {};
            }

            std::vector<char> buffer(sizeof(VOLUME_DISK_EXTENTS));
            DWORD bytes = 0;
            bool queried = false;
            while (true)
            {
                queried = DeviceIoControl(device, IOCTL_VOLUME_GET_VOLUME_DISK_EXTENTS, nullptr, 0,
                    buffer.data(), static_cast<DWORD>(buffer.size()), &bytes, nullptr);
                if (queried || GetLastError() != ERROR_MORE_DATA)
                {
                    break;
                }

                const auto count = reinterpret_cast<const VOLUME_DISK_EXTENTS*>(buffer.data())->NumberOfDiskExtents;
                buffer.resize(offsetof(VOLUME_DISK_EXTENTS, Extents) + count * sizeof(DISK_EXTENT));
            }
            CloseHandle(device);

            if (!queried)
            {
                return {};
            }

            const auto* extents = reinterpret_cast<const VOLUME_DISK_EXTENTS*>(buffer.data());
            std::vector<disk_traits> disks;
            for (DWORD i = 0; i < extents->NumberOfDiskExtents; ++i)
            {
                disks.push_back(query_disk(extents->Extents[i].DiskNumber));
            }

            return disks;
        }
    }

    bool remove_file(const std::filesystem::path& file)
    {
        return DeleteFileW(file.wstring().data()) == TRUE;
    }

    bool move_file(const std::filesystem::path& src, const std::filesystem::path& target)
    {
        return MoveFileW(src.wstring().data(), target.wstring().data()) == TRUE;
    }

    bool move_file_replace(const std::filesystem::path& src, const std::filesystem::path& target)
    {
        return MoveFileExW(src.wstring().data(), target.wstring().data(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == TRUE;
    }

    bool file_exists(const std::filesystem::path& file)
    {
        return query_file_size(file).has_value();
    }

    bool write_file(const std::filesystem::path& file, const std::string& data, const bool append)
    {
        if (file.has_parent_path())
        {
            utils::io::create_directory(file.parent_path());
        }

        std::ofstream stream(file, std::ios::binary | std::ofstream::out | (append ? std::ofstream::app : 0));

        if (stream.is_open())
        {
            stream.write(data.data(), static_cast<std::streamsize>(data.size()));
            stream.close();
            return true;
        }

        return false;
    }

    std::string read_file(const std::filesystem::path& file)
    {
        std::string data;
        read_file(file, &data);
        return data;
    }

    bool read_file(const std::filesystem::path& file, std::string* data)
    {
        if (!data) return false;
        data->clear();

        if (file_exists(file))
        {
            std::ifstream stream(file, std::ios::binary);
            if (!stream.is_open()) return false;

            stream.seekg(0, std::ios::end);
            const std::streamsize size = stream.tellg();
            stream.seekg(0, std::ios::beg);

            if (size > -1)
            {
                data->resize(static_cast<std::string::size_type>(size));
                stream.read(data->data(), size);
                stream.close();
                return true;
            }
        }

        return false;
    }

    std::size_t file_size(const std::filesystem::path& file)
    {
        return query_file_size(file).value_or(0);
    }

    std::unordered_map<std::filesystem::path, file_stat_result> batch_stat_files(const std::vector<std::filesystem::path>& paths)
    {
        std::unordered_map<std::filesystem::path, file_stat_result> results;
        results.reserve(paths.size());

        for (const auto& path : paths)
        {
            const auto size = query_file_size(path);
            results[path] = file_stat_result{ size.has_value(), size.value_or(0) };
        }

        return results;
    }

    bool create_directory(const std::filesystem::path& directory)
    {
        return std::filesystem::create_directories(directory);
    }

    bool directory_exists(const std::filesystem::path& directory)
    {
        return std::filesystem::is_directory(directory);
    }

    bool directory_is_empty(const std::filesystem::path& directory)
    {
        return std::filesystem::is_empty(directory);
    }

    std::vector<std::filesystem::path> list_files(const std::filesystem::path& directory, const bool recursive)
    {
        std::vector<std::filesystem::path> files;

        if (recursive)
        {
            for (auto& file : std::filesystem::recursive_directory_iterator(directory))
            {
                files.push_back(file.path());
            }
        }
        else
        {
            for (auto& file : std::filesystem::directory_iterator(directory))
            {
                files.push_back(file.path());
            }
        }

        return files;
    }

    void copy_folder(const std::filesystem::path& src, const std::filesystem::path& target)
    {
        std::filesystem::copy(src, target,
                              std::filesystem::copy_options::overwrite_existing |
                              std::filesystem::copy_options::recursive);
    }

    bool is_inside_folder(const std::filesystem::path& file, const std::filesystem::path& folder)
    {
        std::error_code code{};
        const auto relative = std::filesystem::relative(file, folder, code);
        if (code)
        {
            return false;
        }

        const auto start = relative.begin();
        return start != relative.end() && start->native() != L"..";
    }

    bool is_nvme_drive(const std::filesystem::path& path)
    {
        const auto disks = query_volume_disks(path);
        return !disks.empty() && std::ranges::all_of(disks, [](const disk_traits& disk)
        {
            return disk.nvme && !disk.seek_penalty;
        });
    }

    bool is_solid_state_drive(const std::filesystem::path& path)
    {
        const auto disks = query_volume_disks(path);
        return !disks.empty() && std::ranges::all_of(disks, [](const disk_traits& disk)
        {
            return !disk.seek_penalty;
        });
    }
}
