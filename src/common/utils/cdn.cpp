#include "cdn.hpp"

#include <thread>
#include "properties.hpp"
#include "flags.hpp"

#include <curl/curl.h>
#include <chrono>
#include <cstdio>

namespace utils::cdn
{
    namespace
    {
        // Dummy write callback that discards data (for HEAD request measurement)
        size_t discard_callback(void*, size_t size, size_t nmemb, void*)
        {
            return size * nmemb;
        }

        // Mirrors share one layout, so any of them can serve any file; order is preference
        const std::vector<std::string> NA_HOSTS = {
            "https://cdn-na.cbservers.dev/",
            "https://cdn-na.cbservers.xyz/",
        };

        const std::vector<std::string> EU_HOSTS = {
            "https://cdn-eu.cbservers.dev/",
            "https://cdn-weu.cbservers.xyz/",
        };

        const std::vector<std::string> NO_HOSTS = {};

        cdn_region other_region(const cdn_region region)
        {
            return region == cdn_region::europe ? cdn_region::north_america : cdn_region::europe;
        }
    }

    cdn_manager& cdn_manager::instance()
    {
        static cdn_manager instance;
        return instance;
    }

    cdn_manager::cdn_manager()
    {
        load_preference();
        load_custom_url();
    }

    const std::vector<std::string>& cdn_manager::hosts_for(const cdn_region region)
    {
        switch (region)
        {
        case cdn_region::north_america:
            return NA_HOSTS;
        case cdn_region::europe:
            return EU_HOSTS;
        default:
            return NO_HOSTS;
        }
    }

    std::string cdn_manager::working_host(const cdn_region region) const
    {
        if (!this->latency_tested_)
        {
            return {};
        }

        for (const auto& server : this->cached_latency_.servers)
        {
            if (server.region == region && server.latency_ms.has_value())
            {
                return server.url;
            }
        }
        return {};
    }

    cdn_region cdn_manager::preferred_region_locked() const
    {
        if (this->preference_ == cdn_region::north_america || this->preference_ == cdn_region::europe)
        {
            return this->preference_;
        }

        if (this->latency_tested_ && this->cached_latency_.success
            && this->cached_latency_.recommended == cdn_region::europe)
        {
            return cdn_region::europe;
        }

        return cdn_region::north_america;
    }

    std::string cdn_manager::resolve_locked() const
    {
        // Automatic mode may recommend the custom server; it has no mirrors, so honour it as-is
        if (this->preference_ == cdn_region::automatic && this->latency_tested_ && this->cached_latency_.success
            && this->cached_latency_.recommended == cdn_region::custom && !this->custom_url_.empty()
            && !this->dead_hosts_.contains(this->custom_url_))
        {
            return this->custom_url_;
        }

        const auto preferred = this->preferred_region_locked();
        for (const auto region : {preferred, other_region(preferred)})
        {
            // The probe-verified mirror goes first, then the rest in list order as untested fallbacks
            std::vector<std::string> candidates;
            const auto verified = this->working_host(region);
            if (!verified.empty())
            {
                candidates.push_back(verified);
            }
            for (const auto& host : hosts_for(region))
            {
                if (host != verified)
                {
                    candidates.push_back(host);
                }
            }

            for (const auto& host : candidates)
            {
                if (!this->dead_hosts_.contains(host))
                {
                    return host;
                }
            }
        }

        return {};
    }

    std::string cdn_manager::get_active_cdn_url()
    {
        if (this->preference_ == cdn_region::custom && !this->custom_url_.empty())
        {
            return this->custom_url_;
        }

        // Probing every CDN takes seconds, and this is reached from UI command handlers, so it
        // runs in the background and the caller gets the first mirror until an answer exists.
        this->begin_latency_test();

        std::lock_guard lock(this->mutex_);
        const auto url = this->resolve_locked();
        if (!url.empty())
        {
            return url;
        }

        // Every mirror is marked dead; hand back the first one so the download fails with an honest error
        return hosts_for(this->preferred_region_locked()).front();
    }

    std::optional<std::string> cdn_manager::failover(const std::string& failed_url)
    {
        std::lock_guard lock(this->mutex_);
        this->dead_hosts_.insert(failed_url);

        if (this->preference_ == cdn_region::custom && !this->custom_url_.empty())
        {
            return std::nullopt; // pinned on purpose, never silently swap
        }

        const auto next = this->resolve_locked();
        if (next.empty() || next == failed_url)
        {
            return std::nullopt;
        }
        return next;
    }

    std::optional<double> cdn_manager::test_latency(const std::string& url)
    {
        auto* curl = curl_easy_init();
        if (!curl)
        {
            return std::nullopt;
        }

        curl_easy_setopt(curl, CURLOPT_URL, url.data());
        curl_easy_setopt(curl, CURLOPT_NOBODY, 1L); // HEAD request
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(LATENCY_TIMEOUT_SECONDS));
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, static_cast<long>(LATENCY_TIMEOUT_SECONDS));
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, discard_callback);

        const auto start = std::chrono::high_resolution_clock::now();
        const auto result = curl_easy_perform(curl);
        const auto end = std::chrono::high_resolution_clock::now();

        std::optional<double> latency;
        if (result == CURLE_OK)
        {
            const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(end - start);
            latency = static_cast<double>(duration.count()) / 1000.0; // Convert to milliseconds
        }

        curl_easy_cleanup(curl);
        return latency;
    }

    // Runs the probe once, off the calling thread. Callers read the default until it lands.
    void cdn_manager::begin_latency_test()
    {
        if (this->latency_tested_.load() || flags::has_flag("offline"))
        {
            return;
        }

        bool expected = false;
        if (!this->latency_testing_.compare_exchange_strong(expected, true))
        {
            return; // already in flight
        }

        std::thread([this]
        {
            try
            {
                this->test_all_latencies();
            }
            catch (...)
            {
                // A failed probe just leaves the default in place.
            }
            this->latency_testing_ = false;
        }).detach();
    }

    latency_result cdn_manager::test_all_latencies()
    {
        latency_result result;
        result.success = false;

        // A region reports the first of its mirrors that answers, and its url is that mirror
        const auto probe_region = [this](const cdn_region region, const char* name)
        {
            cdn_server server;
            server.region = region;
            server.name = name;
            const auto& hosts = hosts_for(region);
            server.url = hosts.front();
            for (const auto& host : hosts)
            {
                const auto latency = this->test_latency(host);
                if (latency.has_value())
                {
                    server.url = host;
                    server.latency_ms = latency;
                    break;
                }
                printf("CDN mirror %s did not answer\n", host.data());
            }
            return server;
        };

        result.servers.push_back(probe_region(cdn_region::north_america, "North America"));
        result.servers.push_back(probe_region(cdn_region::europe, "Europe"));

        const auto custom_url = [this]
        {
            std::lock_guard lock(this->mutex_);
            return this->custom_url_;
        }();

        if (!custom_url.empty())
        {
            cdn_server custom_server;
            custom_server.region = cdn_region::custom;
            custom_server.name = "Custom";
            custom_server.url = custom_url;
            custom_server.latency_ms = test_latency(custom_url);
            result.servers.push_back(custom_server);
        }

        // Pick fastest server with valid latency; default to NA on total failure
        result.recommended = cdn_region::north_america;
        std::optional<double> best_latency;
        for (const auto& server : result.servers)
        {
            if (!server.latency_ms.has_value())
            {
                continue;
            }
            result.success = true;
            if (!best_latency.has_value() || server.latency_ms.value() < best_latency.value())
            {
                best_latency = server.latency_ms;
                result.recommended = server.region;
            }
        }

        {
            std::lock_guard lock(this->mutex_);
            this->cached_latency_ = result;
            this->latency_tested_ = true;
        }

        return result;
    }

    cdn_region cdn_manager::get_preference() const
    {
        return this->preference_;
    }

    void cdn_manager::set_preference(cdn_region region)
    {
        this->preference_ = region;
        save_preference();
        std::lock_guard lock(this->mutex_);
        this->dead_hosts_.clear();
    }

    void cdn_manager::load_preference()
    {
        const auto value = properties::load(property_keys::CDN_PREFERENCE);
        if (value.has_value())
        {
            this->preference_ = string_to_region(value.value());
        }
        else
        {
            this->preference_ = cdn_region::automatic;
        }
    }

    void cdn_manager::save_preference()
    {
        properties::store(property_keys::CDN_PREFERENCE, region_to_string(this->preference_));
    }

    latency_result cdn_manager::get_cached_latency() const
    {
        std::lock_guard lock(this->mutex_);
        return this->cached_latency_;
    }

    void cdn_manager::clear_cached_latency()
    {
        std::lock_guard lock(this->mutex_);
        this->cached_latency_ = {};
        this->dead_hosts_.clear();
        this->latency_tested_ = false;
    }

    std::vector<cdn_server> cdn_manager::get_servers() const
    {
        std::lock_guard lock(this->mutex_);
        std::vector<cdn_server> servers;

        cdn_server na_server;
        na_server.region = cdn_region::north_america;
        na_server.name = "North America";
        na_server.url = NA_HOSTS.front();

        cdn_server eu_server;
        eu_server.region = cdn_region::europe;
        eu_server.name = "Europe";
        eu_server.url = EU_HOSTS.front();

        cdn_server custom_server;
        custom_server.region = cdn_region::custom;
        custom_server.name = "Custom";
        custom_server.url = this->custom_url_;

        if (this->latency_tested_)
        {
            for (const auto& cached : this->cached_latency_.servers)
            {
                if (cached.region == cdn_region::north_america)
                {
                    na_server.url = cached.url;
                    na_server.latency_ms = cached.latency_ms;
                }
                else if (cached.region == cdn_region::europe)
                {
                    eu_server.url = cached.url;
                    eu_server.latency_ms = cached.latency_ms;
                }
                else if (cached.region == cdn_region::custom)
                {
                    custom_server.latency_ms = cached.latency_ms;
                }
            }
        }

        servers.push_back(na_server);
        servers.push_back(eu_server);
        if (!this->custom_url_.empty())
        {
            servers.push_back(custom_server);
        }
        return servers;
    }

    std::string cdn_manager::region_to_string(cdn_region region)
    {
        switch (region)
        {
        case cdn_region::north_america:
            return "na";
        case cdn_region::europe:
            return "eu";
        case cdn_region::custom:
            return "custom";
        case cdn_region::automatic:
        default:
            return "auto";
        }
    }

    cdn_region cdn_manager::string_to_region(const std::string& str)
    {
        if (str == "na")
        {
            return cdn_region::north_america;
        }
        if (str == "eu")
        {
            return cdn_region::europe;
        }
        if (str == "custom")
        {
            return cdn_region::custom;
        }
        return cdn_region::automatic;
    }

    const std::string& cdn_manager::get_custom_url() const
    {
        return this->custom_url_;
    }

    void cdn_manager::set_custom_url(const std::string& url)
    {
        {
            std::lock_guard lock(this->mutex_);
            this->custom_url_ = url;
        }
        save_custom_url();
        clear_cached_latency();
    }

    void cdn_manager::load_custom_url()
    {
        const auto value = properties::load(property_keys::CDN_CUSTOM_URL);
        if (value.has_value())
        {
            this->custom_url_ = value.value();
        }
    }

    void cdn_manager::save_custom_url()
    {
        properties::store(property_keys::CDN_CUSTOM_URL, this->custom_url_);
    }
}
