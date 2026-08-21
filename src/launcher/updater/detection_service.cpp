#include "std_include.hpp"
#include "detection_service.hpp"
#include "game_updater.hpp"
#include "update_cancelled.hpp"
#include "progress_tracker.hpp"

#include <utils/io.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>
#include <unordered_set>

namespace detection_service
{
    namespace
    {
        std::mutex& mutex()
        {
            static std::mutex m;
            return m;
        }

        std::unordered_set<std::string>& active_games()
        {
            static std::unordered_set<std::string> set;
            return set;
        }

        std::atomic<bool> stop_flag{false};
        std::thread sweep_thread;
        std::once_flag sweep_once;

        bool try_begin(const std::string& game_key)
        {
            std::lock_guard lock(mutex());
            return active_games().insert(game_key).second;
        }

        void end(const std::string& game_key)
        {
            std::lock_guard lock(mutex());
            active_games().erase(game_key);
        }

        // Writes nothing when the install root, valid files, or manifest can't be trusted
        void detect_and_store(const game_config::game_config_t& config, const bool only_if_stale)
        {
            const auto install = config.get_install_path();
            if (!install.has_value() || !utils::io::directory_exists(*install))
            {
                return;
            }

            if (!game_config::validate_game_path(config.game_key, *install))
            {
                return;
            }

            game_updater::game_updater updater(config, false, false, nullptr);
            updater.set_cancel_flag(&stop_flag);

            if (only_if_stale && updater.detection_cache_valid())
            {
                return;
            }

            const auto detected = updater.detect_installed_components();
            updater.store_detection_result(detected);
            if (config.get_list(property_keys::SELECTED_COMPONENTS).empty())
            {
                config.set_list(property_keys::SELECTED_COMPONENTS, updater.with_required_components(detected));
            }
        }

        std::uintmax_t manifest_size_on_disk(const game_config::game_config_t& config)
        {
            if (config.manifest_path.empty())
            {
                return 0;
            }

            return static_cast<std::uintmax_t>(utils::io::file_size(utils::properties::get_appdata_path() / config.manifest_path));
        }

        void run_sweep()
        {
            // Lowers I/O priority as well, so the sweep always loses to a download or a running game
            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);

            // Smallest manifest first: quick games stamp instantly, MWR trails where it bothers nobody
            std::vector<std::pair<std::uintmax_t, std::string>> candidates;
            for (const auto& [key, unused] : game_config::game_configs_)
            {
                const auto config = game_config::get_game_config(key);
                if (!config || !config->is_installed())
                {
                    continue;
                }

                const auto install = config->get_install_path();
                if (!install.has_value() || install->empty())
                {
                    continue;
                }

                candidates.emplace_back(manifest_size_on_disk(*config), key);
            }
            std::sort(candidates.begin(), candidates.end());

            for (const auto& [size, key] : candidates)
            {
                // A running verify/download stamps its own game; wait it out rather than compete
                while (!stop_flag.load() && !updater::progress_tracker::instance().wait_for_idle(std::chrono::milliseconds(500)))
                {
                }

                if (stop_flag.load())
                {
                    break;
                }

                const auto config = game_config::get_game_config(key);
                if (!config || !try_begin(key))
                {
                    continue;
                }

                try
                {
                    detect_and_store(*config, true);
                }
                catch (...)
                {
                    // Aborted scans write nothing and are retried next launch
                }

                end(key);
            }

            SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END);
        }
    }

    bool is_active(const std::string& game_key)
    {
        std::lock_guard lock(mutex());
        return active_games().count(game_key) > 0;
    }

    bool start_detection(const game_config::game_config_t& config)
    {
        if (!try_begin(config.game_key))
        {
            return false;
        }

        std::thread([config]
        {
            try
            {
                detect_and_store(config, false);
            }
            catch (const updater::update_cancelled&)
            {
            }
            catch (const std::exception& e)
            {
                printf("Component detection failed for %s: %s\n", config.game_key.data(), e.what());
            }

            end(config.game_key);
        }).detach();

        return true;
    }

    void start_sweep()
    {
        std::call_once(sweep_once, []
        {
            sweep_thread = std::thread(run_sweep);
        });
    }

    void shutdown()
    {
        stop_flag = true;
        if (sweep_thread.joinable())
        {
            sweep_thread.join();
        }
    }
}
