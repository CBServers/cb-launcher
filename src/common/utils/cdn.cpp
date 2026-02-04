#include "cdn.hpp"
#include "properties.hpp"

#include <curl/curl.h>
#include <chrono>

namespace utils::cdn
{
	namespace
	{
		// Dummy write callback that discards data (for HEAD request measurement)
		size_t discard_callback(void*, size_t size, size_t nmemb, void*)
		{
			return size * nmemb;
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
	}

	std::string cdn_manager::get_active_cdn_url()
	{
		switch (this->preference_)
		{
		case cdn_region::north_america:
			return CDN_NA_URL;

		case cdn_region::europe:
			return CDN_EU_URL;

		case cdn_region::automatic:
		default:

			// If we haven't tested, test latencies
			if (!this->latency_tested_)
			{
				printf("Testing CDN server latencies...\n");
				const auto result = this->test_all_latencies();
				if (result.success)
				{
					printf("CDN latency test complete. Recommended: %s\n",
						this->region_to_string(result.recommended).data());
				}
				else
				{
					printf("CDN latency test failed, using default server\n");
				}
			}

			// If we have cached latency results, use the recommended server
			if (this->latency_tested_ && this->cached_latency_.success)
			{
				switch (this->cached_latency_.recommended)
				{
				case cdn_region::europe:
					return CDN_EU_URL;
				case cdn_region::north_america:
				default:
					return CDN_NA_URL;
				}
			}
			// Default to NA if no latency test has been run
			return CDN_NA_URL;
		}
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

	latency_result cdn_manager::test_all_latencies()
	{
		latency_result result;
		result.success = false;

		// Create server entries
		cdn_server na_server;
		na_server.region = cdn_region::north_america;
		na_server.name = "North America";
		na_server.url = CDN_NA_URL;
		na_server.latency_ms = test_latency(CDN_NA_URL);

		cdn_server eu_server;
		eu_server.region = cdn_region::europe;
		eu_server.name = "Europe";
		eu_server.url = CDN_EU_URL;
		eu_server.latency_ms = test_latency(CDN_EU_URL);

		result.servers.push_back(na_server);
		result.servers.push_back(eu_server);

		// Determine recommended server based on lowest latency
		result.recommended = cdn_region::north_america; // Default

		if (na_server.latency_ms.has_value() || eu_server.latency_ms.has_value())
		{
			result.success = true;

			if (na_server.latency_ms.has_value() && eu_server.latency_ms.has_value())
			{
				// Both succeeded, pick the faster one
				if (eu_server.latency_ms.value() < na_server.latency_ms.value())
				{
					result.recommended = cdn_region::europe;
				}
			}
			else if (eu_server.latency_ms.has_value())
			{
				// Only EU succeeded
				result.recommended = cdn_region::europe;
			}
			// else only NA succeeded (or both failed), keep NA as default
		}

		// Cache the result
		this->cached_latency_ = result;
		this->latency_tested_ = true;

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

	const latency_result& cdn_manager::get_cached_latency() const
	{
		return this->cached_latency_;
	}

	void cdn_manager::clear_cached_latency()
	{
		this->cached_latency_ = {};
		this->latency_tested_ = false;
	}

	std::vector<cdn_server> cdn_manager::get_servers() const
	{
		std::vector<cdn_server> servers;

		cdn_server na_server;
		na_server.region = cdn_region::north_america;
		na_server.name = "North America";
		na_server.url = CDN_NA_URL;

		cdn_server eu_server;
		eu_server.region = cdn_region::europe;
		eu_server.name = "Europe";
		eu_server.url = CDN_EU_URL;

		// Include cached latency if available
		if (this->latency_tested_)
		{
			for (const auto& cached : this->cached_latency_.servers)
			{
				if (cached.region == cdn_region::north_america)
				{
					na_server.latency_ms = cached.latency_ms;
				}
				else if (cached.region == cdn_region::europe)
				{
					eu_server.latency_ms = cached.latency_ms;
				}
			}
		}

		servers.push_back(na_server);
		servers.push_back(eu_server);
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
		return cdn_region::automatic;
	}
}
