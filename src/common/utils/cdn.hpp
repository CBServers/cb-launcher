#pragma once

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
        europe
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

        // Convert region to/from string
        static std::string region_to_string(cdn_region region);
        static cdn_region string_to_region(const std::string& str);

    private:
        cdn_manager();

        cdn_region preference_{cdn_region::automatic};
        latency_result cached_latency_{};
        bool latency_tested_{false};

        static constexpr const char* CDN_NA_URL = "https://cdn-na.cbservers.xyz/";
        static constexpr const char* CDN_EU_URL = "https://cdn-weu.cbservers.xyz/";
        static constexpr int LATENCY_TIMEOUT_SECONDS = 5;
    };
}
