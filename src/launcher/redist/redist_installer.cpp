#include <std_include.hpp>

#include "redist_installer.hpp"
#include "redist_packages.hpp"
#include "redist_worker.hpp"

#include "pipe_listener.hpp"

#include <utils/http.hpp>
#include <utils/io.hpp>
#include <utils/nt.hpp>

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <thread>

namespace redist
{
    namespace
    {
        std::wstring expand_env(const std::wstring& input)
        {
            wchar_t buf[MAX_PATH * 2];
            const auto n = ExpandEnvironmentStringsW(input.data(), buf, ARRAYSIZE(buf));
            if (n == 0 || n > ARRAYSIZE(buf)) return input;
            return std::wstring(buf, n - 1);
        }

        bool registry_dword_equals(const std::wstring& subkey, const std::wstring& value_name, DWORD expected)
        {
            HKEY hkey = nullptr;
            const REGSAM access = KEY_READ | KEY_WOW64_64KEY;
            if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.data(), 0, access, &hkey) != ERROR_SUCCESS)
            {
                return false;
            }
            DWORD value = 0;
            DWORD size = sizeof(value);
            DWORD type = 0;
            const auto rc = RegQueryValueExW(hkey, value_name.data(), nullptr, &type, reinterpret_cast<LPBYTE>(&value), &size);
            RegCloseKey(hkey);
            if (rc != ERROR_SUCCESS || type != REG_DWORD) return false;
            return value == expected;
        }

        bool registry_key_exists(const std::wstring& subkey)
        {
            HKEY hkey = nullptr;
            const REGSAM access = KEY_READ | KEY_WOW64_64KEY;
            if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.data(), 0, access, &hkey) != ERROR_SUCCESS)
            {
                return false;
            }
            RegCloseKey(hkey);
            return true;
        }

        bool directory_prefix_exists(const std::wstring& prefix)
        {
            // Wildcard search so NTFS filters; WinSxS is far too large to iterate.
            WIN32_FIND_DATAW data{};
            const auto handle = FindFirstFileExW((prefix + L"*").data(), FindExInfoBasic, &data,
                FindExSearchLimitToDirectories, nullptr, 0);
            if (handle == INVALID_HANDLE_VALUE) return false;

            auto found = false;
            do
            {
                if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
                {
                    found = true;
                    break;
                }
            } while (FindNextFileW(handle, &data));

            FindClose(handle);
            return found;
        }

        bool rule_satisfied(const detect_rule& rule)
        {
            for (const auto& path : rule.paths)
            {
                switch (rule.kind)
                {
                case detect_kind::registry_dword:
                    if (registry_dword_equals(path, rule.value_name, rule.expected)) return true;
                    break;
                case detect_kind::registry_key_exists:
                    if (registry_key_exists(path)) return true;
                    break;
                case detect_kind::file_exists:
                    if (utils::io::file_exists(expand_env(path))) return true;
                    break;
                case detect_kind::directory_prefix_exists:
                    if (directory_prefix_exists(expand_env(path))) return true;
                    break;
                }
            }
            return false;
        }

        std::string json_string(const rapidjson::Value& value, const char* key)
        {
            if (value.HasMember(key) && value[key].IsString())
            {
                return value[key].GetString();
            }
            return {};
        }

        std::string friendly_worker_error(const std::string& error)
        {
            if (error == "cache-missing") return "Installer file missing from cache";
            if (error == "signature") return "Installer failed signature verification";
            if (error == "not-elevated") return "The installer did not receive administrator rights";
            return error;
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
        for (const auto& alternative : def.detect)
        {
            if (!alternative.empty() &&
                std::all_of(alternative.begin(), alternative.end(), rule_satisfied))
            {
                return true;
            }
        }
        return false;
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
            ps.name = def.arch.empty() ? def.group_name : def.group_name + " " + def.arch;
            ps.status = this->is_installed(def) ? package_status::installed : package_status::pending;
            this->state_.packages.push_back(ps);
        }
        this->state_.finished = false;
        this->state_.overall_message.clear();
    }

    std::vector<missing_group> redist_installer::get_missing(const std::vector<std::string>& required_group_ids) const
    {
        std::vector<missing_group> result;
        const auto& defs = all_packages();

        for (const auto& group_id : required_group_ids)
        {
            missing_group group;
            for (const auto& def : defs)
            {
                if (def.group_id != group_id) continue;
                if (this->is_installed(def)) continue;

                if (group.group_id.empty())
                {
                    group.group_id = def.group_id;
                    group.group_name = def.group_name;
                }
                group.archs.push_back(def.arch);
            }
            if (!group.group_id.empty()) result.push_back(std::move(group));
        }

        return result;
    }

    bool redist_installer::start_install(const std::vector<std::string>& target_ids)
    {
        auto expected = false;
        if (!this->worker_running_.compare_exchange_strong(expected, true)) return false;

        this->refresh_detection();

        {
            std::lock_guard lock(this->mutex_);
            this->state_.running = true;
            this->state_.finished = false;
            this->state_.overall_message = "Starting installation...";
        }

        std::thread([this, ids = target_ids]
        {
            this->worker_main(ids);
            this->worker_running_ = false;
        }).detach();
        return true;
    }

    void redist_installer::worker_main(const std::vector<std::string>& target_ids)
    {
        const auto& defs = all_packages();
        std::vector<size_t> work_indices;
        const auto targeted = !target_ids.empty();

        {
            std::lock_guard lock(this->mutex_);
            for (size_t i = 0; i < this->state_.packages.size(); ++i)
            {
                if (targeted)
                {
                    if (std::find(target_ids.begin(), target_ids.end(), this->state_.packages[i].id) == target_ids.end()) continue;
                    this->state_.packages[i].status = package_status::pending;
                    this->state_.packages[i].error.clear();
                }
                else if (this->state_.packages[i].status != package_status::pending) continue;
                work_indices.push_back(i);
            }
        }

        std::vector<size_t> downloaded;
        for (auto i : work_indices)
        {
            const auto& def = defs[i];

            {
                std::lock_guard lock(this->mutex_);
                this->state_.packages[i].status = package_status::downloading;
                this->state_.packages[i].progress_percent = 0;
                this->state_.overall_message = "Downloading " + this->state_.packages[i].name + "...";
            }

            if (this->download_to(def.url, cache_dir() / def.filename, this->state_.packages[i]))
            {
                downloaded.push_back(i);
            }
            else
            {
                std::lock_guard lock(this->mutex_);
                this->state_.packages[i].status = package_status::failed;
                if (this->state_.packages[i].error.empty()) this->state_.packages[i].error = "Download failed";
            }
        }

        if (!downloaded.empty())
        {
            {
                std::lock_guard lock(this->mutex_);
                for (auto i : downloaded)
                {
                    this->state_.packages[i].status = package_status::installing;
                    this->state_.packages[i].progress_percent = 100;
                }
                this->state_.overall_message = "Waiting for administrator approval...";
            }

            this->run_elevated_phase(downloaded);
        }

        {
            std::lock_guard lock(this->mutex_);
            size_t done = 0, failed = 0;
            for (auto i : work_indices)
            {
                if (this->state_.packages[i].status == package_status::completed) ++done;
                else if (this->state_.packages[i].status == package_status::failed) ++failed;
            }

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
            utils::io::remove_file(dest);
            return this->fail(ps, "HTTP " + std::to_string(result ? result->response_code : 0));
        }
        return true;
    }

    void redist_installer::run_elevated_phase(const std::vector<size_t>& indices)
    {
        const auto& defs = all_packages();

        std::string joined;
        std::unordered_set<std::string> batch_ids;
        {
            std::lock_guard lock(this->mutex_);
            for (auto i : indices)
            {
                if (!joined.empty()) joined += ',';
                joined += this->state_.packages[i].id;
                batch_ids.insert(this->state_.packages[i].id);
            }
        }

        pipe::listener listener;
        pipe::listener::options opts{};
        opts.name = REDIST_PIPE_NAME;
        opts.access = PIPE_ACCESS_INBOUND;
        opts.in_buffer = 8192;
        // On create failure we fall back to exit-code-only mode; results re-detect on worker exit.

        listener.start(std::move(opts), [this, &listener, &batch_ids](void* pipe)
        {
            DWORD pid = 0;
            if (!GetNamedPipeClientProcessId(pipe, &pid)) return;

            // Only our own exe may report status.
            const auto client = utils::nt::get_process_path(pid).wstring();
            const auto self = utils::nt::library{}.get_path().wstring();
            if (client.empty() || _wcsicmp(client.data(), self.data()) != 0) return;

            std::string buffer;
            char chunk[4096];
            DWORD read = 0;
            while (listener.read(pipe, chunk, sizeof(chunk), read) && read > 0)
            {
                buffer.append(chunk, read);
                size_t newline;
                while ((newline = buffer.find('\n')) != std::string::npos)
                {
                    auto line = buffer.substr(0, newline);
                    buffer.erase(0, newline + 1);
                    if (!line.empty() && line.back() == '\r') line.pop_back();
                    if (!line.empty()) this->apply_worker_line(line, batch_ids);
                }
            }
        });

        const auto handle = utils::nt::relaunch_self_elevated("-redist-worker " + joined);
        if (!handle)
        {
            const auto declined = GetLastError() == ERROR_CANCELLED;
            this->fail_unfinished(indices, declined
                ? "Administrator permission is required to install redistributables"
                : "Could not start the elevated installer");
            listener.stop();
            return;
        }

        // Liveness is the health signal; installers can legitimately run for minutes.
        constexpr DWORD max_wait_ms = 30 * 60 * 1000;
        DWORD waited = 0;
        while (WaitForSingleObject(handle, 1000) == WAIT_TIMEOUT)
        {
            waited += 1000;
            if (waited >= max_wait_ms)
            {
                utils::nt::terminate_process_handle(handle);
                this->fail_unfinished(indices, "Installation timed out");
                break;
            }
        }

        DWORD exit_code = 1;
        GetExitCodeProcess(handle, &exit_code);
        CloseHandle(handle);
        listener.stop();

        // Packages without a terminal pipe line: trust re-detection on clean exit, else fail.
        if (exit_code == 0)
        {
            std::lock_guard lock(this->mutex_);
            for (auto i : indices)
            {
                auto& ps = this->state_.packages[i];
                if (ps.status != package_status::installing) continue;
                if (this->is_installed(defs[i]))
                {
                    ps.status = package_status::completed;
                }
                else
                {
                    ps.status = package_status::failed;
                    ps.error = "Installation did not complete";
                }
            }
        }
        else
        {
            this->fail_unfinished(indices, "Installer process ended unexpectedly (exit " + std::to_string(exit_code) + ")");
        }
    }

    void redist_installer::apply_worker_line(const std::string& line, const std::unordered_set<std::string>& batch_ids)
    {
        rapidjson::Document doc;
        doc.Parse(line.data(), line.size());
        if (doc.HasParseError() || !doc.IsObject()) return;

        const auto type = json_string(doc, "type");

        if (type == "package")
        {
            const auto id = json_string(doc, "id");
            if (!batch_ids.contains(id)) return;

            const auto status = json_string(doc, "status");
            std::lock_guard lock(this->mutex_);
            for (auto& ps : this->state_.packages)
            {
                if (ps.id != id) continue;

                if (status == "installing")
                {
                    ps.status = package_status::installing;
                    this->state_.overall_message = "Installing " + ps.name + "...";
                }
                else if (status == "completed")
                {
                    ps.status = package_status::completed;
                }
                else if (status == "failed")
                {
                    ps.status = package_status::failed;
                    ps.error = friendly_worker_error(json_string(doc, "error"));
                }
                break;
            }
        }
        else if (type == "fatal")
        {
            const auto error = friendly_worker_error(json_string(doc, "error"));
            std::lock_guard lock(this->mutex_);
            for (auto& ps : this->state_.packages)
            {
                if (!batch_ids.contains(ps.id)) continue;
                if (ps.status == package_status::installing)
                {
                    ps.status = package_status::failed;
                    ps.error = error;
                }
            }
        }
    }

    void redist_installer::fail_unfinished(const std::vector<size_t>& indices, const std::string& msg)
    {
        std::lock_guard lock(this->mutex_);
        for (auto i : indices)
        {
            auto& ps = this->state_.packages[i];
            if (ps.status != package_status::installing) continue;
            ps.status = package_status::failed;
            ps.error = msg;
        }
    }

    redist_state redist_installer::get_state() const
    {
        std::lock_guard lock(this->mutex_);
        return this->state_;
    }
}
