#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <thread>
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

    class redist_installer
    {
    public:
        static redist_installer& instance();

        void refresh_detection();
        bool start_install();
        redist_state get_state() const;

    private:
        redist_installer() = default;

        void worker_main();
        void install_one(package_state& ps, const struct package_def& def);
        bool download_to(const std::string& url, const std::filesystem::path& dest, package_state& ps);
        bool run_installer(const std::filesystem::path& exe, const std::string& args, package_state& ps);
        bool install_directx(const std::filesystem::path& downloaded_exe, package_state& ps);
        bool is_installed(const package_def& def) const;
        bool fail(package_state& ps, std::string msg);

        mutable std::mutex mutex_;
        redist_state state_;
        std::thread worker_;
        std::atomic<bool> worker_running_{ false };
    };
}
