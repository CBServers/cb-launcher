#pragma once

#include <atomic>
#include <filesystem>
#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

namespace redist
{
    enum class package_status
    {
        unknown,
        installed,
        pending,
        downloading,
        installing,
        completed,
        failed,
    };

    struct package_state
    {
        std::string id;
        std::string name;
        package_status status = package_status::unknown;
        int progress_percent = 0;
        std::string error;
    };

    struct redist_state
    {
        bool running = false;
        bool finished = false;
        std::string overall_message;
        std::vector<package_state> packages;
    };

    struct missing_group
    {
        std::string group_id;
        std::string group_name;
        std::vector<std::string> archs;
    };

    class redist_installer
    {
    public:
        static redist_installer& instance();

        void refresh_detection();
        bool start_install(const std::vector<std::string>& target_ids = {});
        redist_state get_state() const;

        // For each requested group ID, returns one entry listing any archs whose detection failed. Unknown group IDs are skipped silently.
        std::vector<missing_group> get_missing(const std::vector<std::string>& required_group_ids) const;

    private:
        redist_installer() = default;

        void worker_main(const std::vector<std::string>& target_ids);
        bool download_to(const std::string& url, const std::filesystem::path& dest, package_state& ps);
        void run_elevated_phase(const std::vector<size_t>& indices);
        void apply_worker_line(const std::string& line, const std::unordered_set<std::string>& batch_ids);
        void fail_unfinished(const std::vector<size_t>& indices, const std::string& msg);
        bool is_installed(const struct package_def& def) const;
        bool fail(package_state& ps, std::string msg);

        mutable std::mutex mutex_;
        redist_state state_;
        std::atomic<bool> worker_running_{ false };
    };
}
