#include <std_include.hpp>

#include "redist_installer.hpp"
#include "redist_packages.hpp"

#include <utils/http.hpp>
#include <utils/properties.hpp>

#include <filesystem>
#include <fstream>

namespace redist
{
    namespace
    {
        std::wstring expand_env(const std::wstring& input)
        {
            wchar_t buf[MAX_PATH * 2];
            const auto n = ExpandEnvironmentStringsW(input.c_str(), buf, ARRAYSIZE(buf));
            if (n == 0 || n > ARRAYSIZE(buf)) return input;
            return std::wstring(buf, n - 1);
        }

        bool registry_dword_equals(const std::wstring& subkey, const std::wstring& value_name, DWORD expected)
        {
            HKEY hkey = nullptr;
            const REGSAM access = KEY_READ | KEY_WOW64_64KEY;
            if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.c_str(), 0, access, &hkey) != ERROR_SUCCESS)
            {
                return false;
            }
            DWORD value = 0;
            DWORD size = sizeof(value);
            DWORD type = 0;
            const auto rc = RegQueryValueExW(hkey, value_name.c_str(), nullptr, &type, reinterpret_cast<LPBYTE>(&value), &size);
            RegCloseKey(hkey);
            if (rc != ERROR_SUCCESS || type != REG_DWORD) return false;
            return value == expected;
        }

        std::filesystem::path cache_dir()
        {
            auto p = utils::properties::get_appdata_path() / "redist-cache";
            std::error_code ec;
            std::filesystem::create_directories(p, ec);
            return p;
        }

        bool shell_execute_wait(const std::wstring& verb, const std::wstring& file, const std::wstring& params,
            const std::wstring& working_dir, DWORD& exit_code)
        {
            SHELLEXECUTEINFOW info{};
            info.cbSize = sizeof(info);
            info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
            info.lpVerb = verb.c_str();
            info.lpFile = file.c_str();
            info.lpParameters = params.empty() ? nullptr : params.c_str();
            info.lpDirectory = working_dir.empty() ? nullptr : working_dir.c_str();
            info.nShow = SW_HIDE;

            if (!ShellExecuteExW(&info) || !info.hProcess)
            {
                exit_code = GetLastError();
                return false;
            }

            WaitForSingleObject(info.hProcess, INFINITE);
            DWORD ec = 0;
            GetExitCodeProcess(info.hProcess, &ec);
            CloseHandle(info.hProcess);
            exit_code = ec;
            return true;
        }

        std::wstring widen(const std::string& s)
        {
            if (s.empty()) return {};
            const auto n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
            std::wstring w(n, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
            return w;
        }
    }

    redist_installer& redist_installer::instance()
    {
        static redist_installer s;
        return s;
    }

    bool redist_installer::fail(package_state& ps, std::string msg)
    {
        std::lock_guard lock(this->mutex_);
        ps.error = std::move(msg);
        return false;
    }

    bool redist_installer::is_installed(const package_def& def) const
    {
        for (const auto& rule : def.detect)
        {
            switch (rule.kind)
            {
            case detect_kind::registry_dword:
                if (!registry_dword_equals(rule.path, rule.value_name, rule.expected)) return false;
                break;
            case detect_kind::file_exists:
            {
                const auto expanded = expand_env(rule.path);
                std::error_code ec;
                if (!std::filesystem::exists(expanded, ec)) return false;
                break;
            }
            }
        }
        return true;
    }

    void redist_installer::refresh_detection()
    {
        std::lock_guard lock(this->mutex_);
        if (this->state_.running) return;

        this->state_.packages.clear();
        for (const auto& def : all_packages())
        {
            package_state ps;
            ps.id = def.id;
            ps.name = def.name;
            ps.status = this->is_installed(def) ? package_status::installed : package_status::pending;
            this->state_.packages.push_back(ps);
        }
        this->state_.finished = false;
        this->state_.overall_message.clear();
    }

    bool redist_installer::start_install()
    {
        {
            std::lock_guard lock(this->mutex_);
            if (this->state_.running) return false;
        }

        this->refresh_detection();

        {
            std::lock_guard lock(this->mutex_);
            this->state_.running = true;
            this->state_.finished = false;
            this->state_.overall_message = "Starting installation...";
        }

        if (this->worker_.joinable()) this->worker_.detach();
        this->worker_ = std::thread([this] { this->worker_main(); });
        this->worker_.detach();
        return true;
    }

    void redist_installer::worker_main()
    {
        const auto& defs = all_packages();
        std::vector<size_t> work_indices;

        {
            std::lock_guard lock(this->mutex_);
            for (size_t i = 0; i < this->state_.packages.size(); ++i)
            {
                if (this->state_.packages[i].status == package_status::pending)
                {
                    work_indices.push_back(i);
                }
            }
        }

        size_t done = 0, failed = 0;
        for (auto i : work_indices)
        {
            const auto& def = defs[i];

            {
                std::lock_guard lock(this->mutex_);
                this->state_.overall_message = "Installing " + def.name + "...";
            }

            this->install_one(this->state_.packages[i], def);

            {
                std::lock_guard lock(this->mutex_);
                if (this->state_.packages[i].status == package_status::completed) ++done;
                else if (this->state_.packages[i].status == package_status::failed) ++failed;
            }
        }

        {
            std::lock_guard lock(this->mutex_);
            this->state_.running = false;
            this->state_.finished = true;
            if (work_indices.empty())
            {
                this->state_.overall_message = "All redistributables already installed.";
            }
            else if (failed == 0)
            {
                this->state_.overall_message = "All redistributables installed.";
            }
            else
            {
                this->state_.overall_message = std::to_string(done) + " installed, " + std::to_string(failed) + " failed.";
            }
        }
    }

    void redist_installer::install_one(package_state& ps, const package_def& def)
    {
        {
            std::lock_guard lock(this->mutex_);
            ps.status = package_status::downloading;
            ps.progress_percent = 0;
        }

        const auto dest = cache_dir() / def.filename;

        if (!this->download_to(def.url, dest, ps))
        {
            std::lock_guard lock(this->mutex_);
            ps.status = package_status::failed;
            if (ps.error.empty()) ps.error = "Download failed";
            return;
        }


        {
            std::lock_guard lock(this->mutex_);
            ps.status = package_status::installing;
            ps.progress_percent = 100;
        }

        const auto success = def.is_directx
            ? this->install_directx(dest, ps)
            : this->run_installer(dest, def.install_args, ps);

        std::lock_guard lock(this->mutex_);
        ps.status = success ? package_status::completed : package_status::failed;
    }

    bool redist_installer::download_to(const std::string& url, const std::filesystem::path& dest, package_state& ps)
    {
        std::ofstream ofs(dest, std::ios::binary | std::ios::trunc);
        if (!ofs) return this->fail(ps, "Cannot write to cache");

        const auto result = utils::http::get_data_stream(url, {}, {},
            [this, &ps](size_t progress, size_t total_size, size_t) -> bool
            {
                if (total_size > 0)
                {
                    const auto pct = static_cast<int>((progress * 100ULL) / total_size);
                    std::lock_guard lock(this->mutex_);
                    ps.progress_percent = pct;
                }
                return true;
            },
            [&ofs](const char* chunk, size_t size) -> bool
            {
                if (chunk && size > 0) ofs.write(chunk, static_cast<std::streamsize>(size));
                return true;
            });

        ofs.close();

        if (!result || result->response_code >= 400)
        {
            std::error_code ec;
            std::filesystem::remove(dest, ec);
            return this->fail(ps, "HTTP " + std::to_string(result ? result->response_code : 0));
        }
        return true;
    }

    bool redist_installer::run_installer(const std::filesystem::path& exe, const std::string& args, package_state& ps)
    {
        DWORD exit_code = 0;
        if (!shell_execute_wait(L"runas", exe.wstring(), widen(args), exe.parent_path().wstring(), exit_code))
        {
            return this->fail(ps, "Launch failed (" + std::to_string(exit_code) + ")");
        }

        // 3010 = reboot required (runtime is installed); 1638 = newer version already present.
        if (exit_code == 0 || exit_code == 3010 || exit_code == 1638) return true;

        return this->fail(ps, "Installer exit " + std::to_string(exit_code));
    }

    bool redist_installer::install_directx(const std::filesystem::path& downloaded_exe, package_state& ps)
    {
        const auto extract_dir = cache_dir() / "dx_extract";
        std::error_code ec;
        std::filesystem::remove_all(extract_dir, ec);
        std::filesystem::create_directories(extract_dir, ec);

        DWORD exit_code = 0;
        const auto extract_args = L"/Q /T:\"" + extract_dir.wstring() + L"\"";
        if (!shell_execute_wait(L"open", downloaded_exe.wstring(), extract_args,
            downloaded_exe.parent_path().wstring(), exit_code) || exit_code != 0)
        {
            return this->fail(ps, "Extract failed (" + std::to_string(exit_code) + ")");
        }

        const auto dxsetup = extract_dir / "DXSETUP.exe";
        if (!std::filesystem::exists(dxsetup, ec))
        {
            return this->fail(ps, "DXSETUP.exe missing after extract");
        }

        if (!shell_execute_wait(L"runas", dxsetup.wstring(), L"/silent", extract_dir.wstring(), exit_code))
        {
            return this->fail(ps, "DXSETUP launch failed (" + std::to_string(exit_code) + ")");
        }

        if (exit_code == 0) return true;
        return this->fail(ps, "DXSETUP exit " + std::to_string(exit_code));
    }

    redist_state redist_installer::get_state() const
    {
        std::lock_guard lock(this->mutex_);
        return this->state_;
    }
}
