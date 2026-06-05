#pragma once

#include <string>
#include <vector>
#include <filesystem>
#include <unordered_map>

namespace utils::io
{
    struct file_stat_result
    {
        bool exists;
        std::size_t size;
    };

    bool remove_file(const std::filesystem::path& file);
    bool move_file(const std::filesystem::path& src, const std::filesystem::path& target);
    bool file_exists(const std::filesystem::path& file);
    bool write_file(const std::filesystem::path& file, const std::string& data, bool append = false);
    bool read_file(const std::filesystem::path& file, std::string* data);
    std::string read_file(const std::filesystem::path& file);
    std::size_t file_size(const std::filesystem::path& file);
    std::unordered_map<std::filesystem::path, file_stat_result> batch_stat_files(const std::vector<std::filesystem::path>& paths);
    bool create_directory(const std::filesystem::path& directory);
    bool directory_exists(const std::filesystem::path& directory);
    bool directory_is_empty(const std::filesystem::path& directory);
    std::vector<std::filesystem::path> list_files(const std::filesystem::path& directory, bool recursive = false);
    void copy_folder(const std::filesystem::path& src, const std::filesystem::path& target);
}
