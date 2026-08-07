#include <std_include.hpp>

#include "redist_worker.hpp"
#include "redist_packages.hpp"

#include <utils/authenticode.hpp>
#include <utils/io.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/string.hpp>

#include <filesystem>

namespace redist
{
    namespace
    {
        template <typename F>
        std::string build_json_object(F&& fill)
        {
            rapidjson::StringBuffer buffer;
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            writer.StartObject();
            fill(writer);
            writer.EndObject();
            return std::string(buffer.GetString(), buffer.GetSize());
        }

        // Status pipe back to the launcher. Absence is non-fatal: installs proceed blind.
        class status_pipe
        {
        public:
            status_pipe()
            {
                for (auto attempt = 0; attempt < 20; ++attempt)
                {
                    this->handle_ = CreateFileW(REDIST_PIPE_NAME, GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
                    if (this->handle_ != INVALID_HANDLE_VALUE) return;

                    if (GetLastError() == ERROR_PIPE_BUSY)
                    {
                        WaitNamedPipeW(REDIST_PIPE_NAME, 1000);
                        continue;
                    }

                    Sleep(100);
                }
            }

            ~status_pipe()
            {
                if (this->handle_ != INVALID_HANDLE_VALUE)
                {
                    FlushFileBuffers(this->handle_);
                    CloseHandle(this->handle_);
                }
            }

            void send_line(const std::string& json)
            {
                if (this->handle_ == INVALID_HANDLE_VALUE) return;

                const auto line = json + "\n";
                DWORD written = 0;
                if (!WriteFile(this->handle_, line.data(), static_cast<DWORD>(line.size()), &written, nullptr))
                {
                    CloseHandle(this->handle_);
                    this->handle_ = INVALID_HANDLE_VALUE;
                }
            }

            void send_package(const std::string& id, const char* status, const std::string& error = {})
            {
                this->send_line(build_json_object([&](auto& w)
                {
                    w.Key("type"); w.String("package");
                    w.Key("id"); w.String(id.data(), static_cast<rapidjson::SizeType>(id.size()));
                    w.Key("status"); w.String(status);
                    if (!error.empty())
                    {
                        w.Key("error"); w.String(error.data(), static_cast<rapidjson::SizeType>(error.size()));
                    }
                }));
            }

            void send_fatal(const std::string& error)
            {
                this->send_line(build_json_object([&](auto& w)
                {
                    w.Key("type"); w.String("fatal");
                    w.Key("error"); w.String(error.data(), static_cast<rapidjson::SizeType>(error.size()));
                }));
            }

        private:
            HANDLE handle_ = INVALID_HANDLE_VALUE;
        };

        bool run_and_wait(const std::filesystem::path& exe, const std::string& args,
            const std::filesystem::path& working_dir, DWORD& exit_code)
        {
            SHELLEXECUTEINFOW info{};
            const auto file = exe.wstring();
            const auto params = utils::string::convert(args);
            const auto dir = working_dir.wstring();

            info.cbSize = sizeof(info);
            info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
            info.lpVerb = L"open";
            info.lpFile = file.data();
            info.lpParameters = params.empty() ? nullptr : params.data();
            info.lpDirectory = dir.empty() ? nullptr : dir.data();
            info.nShow = SW_HIDE;

            if (!ShellExecuteExW(&info) || !info.hProcess)
            {
                exit_code = GetLastError();
                return false;
            }

            WaitForSingleObject(info.hProcess, INFINITE);
            DWORD code = 0;
            GetExitCodeProcess(info.hProcess, &code);
            CloseHandle(info.hProcess);
            exit_code = code;
            return true;
        }

        bool install_package(const package_def& def, const std::filesystem::path& staged,
            const std::filesystem::path& staging_dir, std::string& error)
        {
            DWORD exit_code = 0;

            if (def.is_directx)
            {
                const auto extract_dir = staging_dir / "dx_extract";
                std::error_code ec;
                std::filesystem::create_directories(extract_dir, ec);

                const auto extract_args = "/Q /T:\"" + utils::string::path_to_utf8(extract_dir) + "\"";
                if (!run_and_wait(staged, extract_args, staging_dir, exit_code) || exit_code != 0)
                {
                    error = "Extract failed (" + std::to_string(exit_code) + ")";
                    return false;
                }

                const auto dxsetup = extract_dir / "DXSETUP.exe";
                if (!utils::io::file_exists(dxsetup))
                {
                    error = "DXSETUP.exe missing after extract";
                    return false;
                }

                if (!run_and_wait(dxsetup, "/silent", extract_dir, exit_code))
                {
                    error = "DXSETUP launch failed (" + std::to_string(exit_code) + ")";
                    return false;
                }

                if (exit_code != 0)
                {
                    error = "DXSETUP exit " + std::to_string(exit_code);
                    return false;
                }
                return true;
            }

            if (!run_and_wait(staged, def.install_args, staging_dir, exit_code))
            {
                error = "Launch failed (" + std::to_string(exit_code) + ")";
                return false;
            }

            // 3010 = reboot required (runtime is installed); 1638 = newer version already present.
            if (exit_code == 0 || exit_code == 3010 || exit_code == 1638) return true;

            error = "Installer exit " + std::to_string(exit_code);
            return false;
        }

        // %SystemRoot%\Temp is admin-writable only, so a staged copy can't be swapped
        // by a medium-IL process between the signature check and execution.
        std::filesystem::path make_staging_dir()
        {
            wchar_t windows_dir[MAX_PATH]{};
            if (!GetWindowsDirectoryW(windows_dir, ARRAYSIZE(windows_dir))) return {};

            auto dir = std::filesystem::path(windows_dir) / "Temp" /
                ("cb-launcher-redist-" + std::to_string(GetCurrentProcessId()));

            std::error_code ec;
            std::filesystem::remove_all(dir, ec);
            if (!std::filesystem::create_directories(dir, ec)) return {};
            return dir;
        }

        const package_def* find_package(const std::string& id)
        {
            for (const auto& def : all_packages())
            {
                if (def.id == id) return &def;
            }
            return nullptr;
        }
    }

    std::filesystem::path cache_dir()
    {
        auto p = utils::properties::get_appdata_path() / "redist-cache";
        std::error_code ec;
        std::filesystem::create_directories(p, ec);
        return p;
    }

    int run_worker(const std::string& ids_csv)
    {
        status_pipe pipe;

        pipe.send_line(build_json_object([](auto& w)
        {
            w.Key("type"); w.String("hello");
            w.Key("protocolVersion"); w.Int(REDIST_PROTOCOL_VERSION);
        }));

        if (!utils::nt::is_elevated())
        {
            pipe.send_fatal("not-elevated");
            return 2;
        }

        const auto ids = utils::string::split(ids_csv, ',');
        std::vector<const package_def*> defs;
        for (const auto& id : ids)
        {
            if (id.empty()) continue;

            // Ids are the only accepted input; paths never cross the trust boundary.
            const auto* def = find_package(id);
            if (!def)
            {
                pipe.send_package(id, "failed", "unknown-id");
                continue;
            }
            defs.push_back(def);
        }

        if (defs.empty())
        {
            pipe.send_fatal("no-valid-ids");
            return 2;
        }

        const auto staging_dir = make_staging_dir();
        if (staging_dir.empty())
        {
            pipe.send_fatal("staging-dir");
            return 2;
        }

        const auto cache = cache_dir();
        int installed = 0, failed = 0;

        for (const auto* def : defs)
        {
            pipe.send_package(def->id, "installing");

            const auto source = cache / def->filename;
            const auto staged = staging_dir / def->filename;

            if (!CopyFileW(source.wstring().data(), staged.wstring().data(), FALSE))
            {
                pipe.send_package(def->id, "failed", "cache-missing");
                ++failed;
                continue;
            }

            if (!utils::authenticode::verify_microsoft_signature(staged))
            {
                std::error_code ec;
                std::filesystem::remove(staged, ec);
                pipe.send_package(def->id, "failed", "signature");
                ++failed;
                continue;
            }

            std::string error;
            if (install_package(*def, staged, staging_dir, error))
            {
                pipe.send_package(def->id, "completed");
                ++installed;
            }
            else
            {
                pipe.send_package(def->id, "failed", error);
                ++failed;
            }
        }

        pipe.send_line(build_json_object([&](auto& w)
        {
            w.Key("type"); w.String("done");
            w.Key("installed"); w.Int(installed);
            w.Key("failed"); w.Int(failed);
        }));

        std::error_code ec;
        std::filesystem::remove_all(staging_dir, ec);

        return failed == 0 ? 0 : 1;
    }
}
