#include "std_include.hpp"
#include "cef/cef_ui.hpp"
#include "commands/commands.hpp"
#include "updater/updater.hpp"

#include <utils/flags.hpp>
#include <utils/named_mutex.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>
#include <utils/io.hpp>
#include <utils/nt.hpp>
#include <utils/com.hpp>

namespace
{
    void set_working_directory()
    {
        const auto appdata = utils::properties::get_appdata_path();

        if (!utils::io::directory_exists(appdata / "data"))
        {
            utils::io::create_directory(appdata / "data");
        }

        std::filesystem::current_path(appdata);
    }

    void enable_dpi_awareness()
    {
        const utils::nt::library user32{"user32.dll"};

        const auto set_dpi_awareness_context = user32
            ? user32.get_proc<BOOL(WINAPI*)(DPI_AWARENESS_CONTEXT)>("SetProcessDpiAwarenessContext")
            : nullptr;

        // Minimum: Windows 10, version 1703
        if (set_dpi_awareness_context)
        {
            set_dpi_awareness_context(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            return;
        }

        const utils::nt::library shcore{"shcore.dll"};

        const auto set_dpi_awareness = shcore
            ? shcore.get_proc<HRESULT(WINAPI*)(PROCESS_DPI_AWARENESS)>("SetProcessDpiAwareness")
            : nullptr;

        // Minimum: Windows 8.1
        if (set_dpi_awareness)
        {
            set_dpi_awareness(PROCESS_PER_MONITOR_DPI_AWARE);
            return;
        }

        // Call vista function if nothing else was not resolved
        SetProcessDPIAware();
    }

    void run_as_singleton()
    {
        static utils::named_mutex mutex{"cb-launcher"};
        if (!mutex.try_lock(3s))
        {
            throw std::runtime_error{"CB Servers Launcher is already running"};
        }
    }

    bool is_subprocess()
    {
        return strstr(GetCommandLineA(), "--cb-subprocess");
    }

    void run_watchdog()
    {
        std::thread([]()
        {
            const auto parent = utils::nt::get_parent_pid();
            if (utils::nt::wait_for_process(parent))
            {
                std::this_thread::sleep_for(3s);
                utils::nt::terminate();
            }
        }).detach();
    }

    int run_subprocess(const utils::nt::library& process, const std::filesystem::path& path)
    {
        const cef::cef_ui cef_ui{process, path};
        return cef_ui.run_process();
    }

    void show_window(const utils::nt::library& process, const std::filesystem::path& path)
    {
        cef::cef_ui cef_ui{process, path};
        commands::register_all_commands(cef_ui);
        cef_ui.create(path / "data" / "launcher-ui", "main.html");
        cef::cef_ui::work();
    }

    void create_shortcut()
    {
        try
        {
            if (utils::properties::load(property_keys::SHORTCUT_CREATED) == "true")
            {
                return;
            }

            const auto launcher_path = utils::nt::library{}.get_path();
            const auto desktop_path = utils::com::get_desktop_path();

            if (desktop_path.empty())
            {
                return;
            }

            const auto shortcut_path = desktop_path / "CB Servers Launcher.lnk";

            if (utils::com::create_shortcut(launcher_path, shortcut_path, "Launch the CB Servers Launcher"))
            {
                utils::properties::store(property_keys::SHORTCUT_CREATED, "true");
            }
        }
        catch (...)
        {
            printf("Error creating shortcut\n");
        }
    }
}

int CALLBACK WinMain(const HINSTANCE instance, HINSTANCE, LPSTR, int)
{
    // Harden DLL search before anything else runs: System32 + AddDllDirectory entries only.
    // Prevents planting via stray DLLs in the launcher's own directory.
    SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS);

    try
    {
        set_working_directory();

        const utils::nt::library lib{instance};
        const auto path = utils::properties::get_appdata_path();

        if (is_subprocess())
        {
            run_watchdog();
            return run_subprocess(lib, path);
        }

        enable_dpi_awareness();

#if !defined(DEBUG)
        run_as_singleton();
#else
        AllocConsole();
        FILE* fp;
        freopen_s(&fp, "CONOUT$", "w", stdout);
        freopen_s(&fp, "CONOUT$", "w", stderr);
        printf("Debug console enabled\n");
#endif

        if (!utils::flags::has_flag("noupdate"))
        {
            launcher_updater::run(path);
        }

        if (!utils::nt::is_wine_environment())
        {
            create_shortcut();
        }
        else
        {
            printf("[Wine/Proton] Running under Wine - some Windows-specific features are disabled\n");
        }

        show_window(lib, path);

        return 0;
    }
    catch (updater::update_cancelled&)
    {
        return 0;
    }
    catch (std::exception& e)
    {
        MessageBoxA(nullptr, e.what(), "ERROR", MB_ICONERROR);
    }
    catch (...)
    {
        MessageBoxA(nullptr, "An unknown error occurred", "ERROR", MB_ICONERROR);
    }

    return 1;
}
