#pragma once

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>

// min and max is required by gdi, therefore NOMINMAX won't work
#ifdef max
#undef max
#endif

#ifdef min
#undef min
#endif

#include <string>
#include <functional>
#include <filesystem>

namespace utils::nt
{
    class library final
    {
    public:
        static library load(const std::string& name);
        static library load(const std::filesystem::path& path);
        static library get_by_address(void* address);

        library();
        explicit library(const std::string& name);
        explicit library(HMODULE handle);

        library(const library& a) : module_(a.module_)
        {
        }

        bool operator!=(const library& obj) const { return !(*this == obj); };
        bool operator==(const library& obj) const;

        operator bool() const;
        operator HMODULE() const;

        [[nodiscard]] void* get_entry_point() const;
        [[nodiscard]] size_t get_relative_entry_point() const;

        [[nodiscard]] bool is_valid() const;
        [[nodiscard]] std::string get_name() const;
        [[nodiscard]] std::filesystem::path get_path() const;
        [[nodiscard]] std::filesystem::path get_folder() const;
        [[nodiscard]] std::uint8_t* get_ptr() const;
        void free();

        [[nodiscard]] HMODULE get_handle() const;

        template <typename T>
        T get_proc(const std::string& process) const
        {
            if (!this->is_valid()) T{};
            return reinterpret_cast<T>(GetProcAddress(this->module_, process.data()));
        }

        template <typename T>
        std::function<T> get(const std::string& process) const
        {
            if (!this->is_valid()) return std::function<T>();
            return static_cast<T*>(this->get_proc<void*>(process));
        }

        template <typename T, typename... Args>
        T invoke(const std::string& process, Args ... args) const
        {
            auto method = this->get<T(__cdecl)(Args ...)>(process);
            if (method) return method(args...);
            return T();
        }

        template <typename T, typename... Args>
        T invoke_pascal(const std::string& process, Args ... args) const
        {
            auto method = this->get<T(__stdcall)(Args ...)>(process);
            if (method) return method(args...);
            return T();
        }

        template <typename T, typename... Args>
        T invoke_this(const std::string& process, void* this_ptr, Args ... args) const
        {
            auto method = this->get<T(__thiscall)(void*, Args ...)>(this_ptr, process);
            if (method) return method(args...);
            return T();
        }

        std::vector<PIMAGE_SECTION_HEADER> get_section_headers() const;

        PIMAGE_NT_HEADERS get_nt_headers() const;
        PIMAGE_DOS_HEADER get_dos_header() const;
        PIMAGE_OPTIONAL_HEADER get_optional_header() const;

        void** get_iat_entry(const std::string& module_name, const std::string& proc_name) const;

        static void set_dll_directory(const std::filesystem::path& directory);
        static void add_dll_directory(const std::filesystem::path& directory);
        static std::filesystem::path get_dll_directory();
        static bool delay_load(const std::string& library);

    private:
        HMODULE module_;
    };

    bool is_wine_environment();

    __declspec(noreturn) void raise_hard_exception();
    std::string load_resource(int id);

    void launch_process(const std::filesystem::path& process, const std::string& command_line);
    unsigned long launch_process(const std::filesystem::path& process, const std::string& command_line, const std::filesystem::path& working_directory);
    // `out_handle` takes ownership of the elevation broker's process handle, which carries rights a medium-IL OpenProcess can't obtain.
    unsigned long launch_process_elevated(const std::filesystem::path& process, const std::string& command_line, const std::filesystem::path& working_directory, HANDLE* out_handle = nullptr, int show = SW_SHOWNORMAL);
    // Relaunches our own exe elevated with a hidden window. Returns the owned process handle,
    // or nullptr on failure (GetLastError() == ERROR_CANCELLED means the user declined UAC).
    HANDLE relaunch_self_elevated(const std::string& command_line);
    // CreateProcess first, retrying through a UAC prompt on ERROR_ELEVATION_REQUIRED (740).
    // `elevated` reports whether the prompt path was taken (set even when it then fails, so ERROR_CANCELLED is attributable).
    unsigned long launch_process_maybe_elevated(const std::filesystem::path& process, const std::string& command_line, const std::filesystem::path& working_directory, bool* elevated = nullptr, HANDLE* out_handle = nullptr);
    bool is_elevated();
    bool is_process_elevated(unsigned long pid);
    std::filesystem::path get_process_path(unsigned long pid);
    bool is_process_running(const std::string& processName);
    // First matching pid, or 0 when the process isn't running.
    unsigned long find_process_id(const std::string& processName);
    bool stop_process(const std::string& processName);
    bool terminate_process(unsigned long pid);
    // Terminates through a handle already owned (e.g. from an elevated launch), which needs no OpenProcess and so no UAC prompt.
    bool terminate_process_handle(HANDLE process);
    // Last resort for a high-IL process: taskkill /F /PID behind a UAC prompt.
    bool terminate_process_elevated(unsigned long pid);
    bool is_process_alive(unsigned long pid);
    // Same, through a handle already owned, so an elevated target can't fail the check on OpenProcess.
    bool is_process_alive_handle(HANDLE process);
    void relaunch_self(std::string command_line = GetCommandLineA());
    void update_dll_search_path(const std::filesystem::path& directory);

    unsigned long get_parent_pid();
    bool wait_for_process(unsigned long pid);

    __declspec(noreturn) void terminate(uint32_t code = 0);
}
