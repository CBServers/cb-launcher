#pragma once

#include <atomic>
#include <string>
#include <optional>
#include <vector>

#include "property_keys.hpp"

namespace utils::cdn
{
    enum class cdn_region
    {
        automatic,
        north_america,
        europe,
        custom
    };

    struct cdn_server
    {
        cdn_region region{};
        std::string name{};
        std::string url{};
        std::optional<double> latency_ms{};
    };

    struct latency_result
    {
        std::vector<cdn_server> servers{};
        cdn_region recommended{};
        bool success{};
    };

    class cdn_manager
    {
    public:
        static cdn_manager& instance();

        // Get the active CDN base URL based on current preference
        std::string get_active_cdn_url();

        // Test latency to a specific server URL (returns milliseconds, or nullopt on failure)
        std::optional<double> test_latency(const std::string& url);

        // Test latency to all configured servers
        latency_result test_all_latencies();
        // Starts the probe in the background if it has not run; returns immediately.
        void begin_latency_test();

        // Get/set the user's CDN preference
        cdn_region get_preference() const;
        void set_preference(cdn_region region);

        // Load/save preference from/to properties storage
        void load_preference();
        void save_preference();

        // Get cached latency results (from last test)
        const latency_result& get_cached_latency() const;

        // Clear cached latency results
        void clear_cached_latency();

        // Get list of available servers
        std::vector<cdn_server> get_servers() const;

        // Get/set the user-defined custom CDN URL (empty string = none)
        const std::string& get_custom_url() const;
        void set_custom_url(const std::string& url);

        // Convert region to/from string
        static std::string region_to_string(cdn_region region);
        static cdn_region string_to_region(const std::string& str);

    private:
        cdn_manager();

        void load_custom_url();
        void save_custom_url();

        cdn_region preference_{cdn_region::automatic};
        std::string custom_url_{};
        latency_result cached_latency_{};
        std::atomic<bool> latency_tested_{false};
        std::atomic<bool> latency_testing_{false};

        static constexpr const char* CDN_NA_URL = "https://cdn-na.cbservers.xyz/";
        static constexpr const char* CDN_EU_URL = "https://cdn-weu.cbservers.xyz/";
        static constexpr int LATENCY_TIMEOUT_SECONDS = 5;
    };
}
