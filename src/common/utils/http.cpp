#include "http.hpp"
#include <algorithm>
#include <chrono>
#include <thread>
#include "finally.hpp"

#pragma comment(lib, "ws2_32.lib")

namespace utils::http
{
	namespace
	{
		struct progress_helper
		{
			const std::function<bool(size_t, size_t, size_t)>* callback{};
			std::exception_ptr exception{};
			std::chrono::high_resolution_clock::time_point start{};
		};

		struct stream_helper
		{
			const std::function<bool(const char*, size_t)>* callback{};
			std::exception_ptr exception{};
			curl_off_t bytes_written{};  // Track total bytes written across retries for resume support
		};

		int progress_callback(void* clientp, const curl_off_t dltotal, const curl_off_t dlnow, const curl_off_t /*ultotal*/, const curl_off_t /*ulnow*/)
		{
			auto* helper = static_cast<progress_helper*>(clientp);

			try
			{
				const auto now = std::chrono::high_resolution_clock::now();
				const auto count = std::max(1, static_cast<int>(std::chrono::duration_cast<
					std::chrono::seconds>(now - helper->start).count()));
				const auto speed = dlnow / count;

				if (*helper->callback)
				{
					// Callback returns false to abort
					if (!(*helper->callback)(dlnow, dltotal, speed))
					{
						return 1; // Abort transfer
					}
				}
			}
			catch (...)
			{
				helper->exception = std::current_exception();
				return -1;
			}

			return 0;
		}

		size_t write_callback(void* contents, const size_t size, const size_t nmemb, void* userp)
		{
			auto* buffer = static_cast<std::string*>(userp);

			const auto total_size = size * nmemb;
			buffer->append(static_cast<char*>(contents), total_size);
			return total_size;
		}

		size_t write_callback_stream(void* contents, const size_t size, const size_t nmemb, void* userp)
		{
			const auto total_size = size * nmemb;
			auto* write_helper = static_cast<stream_helper*>(userp);

			try
			{
				if (*write_helper->callback)
				{
					// Callback returns false to abort
					if (!(*write_helper->callback)(static_cast<char*>(contents), total_size))
					{
						return 0; // Abort transfer
					}
				}
				// Track bytes written for resume support across retries
				write_helper->bytes_written += total_size;
			}
			catch (...)
			{
				write_helper->exception = std::current_exception();
				return 0; // Abort on exception
			}

			return total_size;
		}

		bool should_retry_request(const CURLcode code, const unsigned int response_code)
		{
			// Don't retry user cancellations
			if (code == CURLE_ABORTED_BY_CALLBACK)
			{
				return false;
			}

			// Don't retry if request succeeded (200-299 or 206 Partial Content)
			if (code == CURLE_OK && response_code >= 200 && response_code < 300)
			{
				return false;
			}

			// Don't retry HTTP 416 Range Not Satisfiable - caller should delete partial and start fresh
			if (code == CURLE_OK && response_code == 416)
			{
				return false;
			}

			return true;
		}
	}

	std::optional<result> get_data(const std::string& url, const std::string& fields,
		const headers& headers, const std::function<bool(size_t, size_t, size_t)>& callback, int timeout, uint32_t retries)
	{
		curl_slist* header_list = nullptr;
		auto* curl = curl_easy_init();
		if (!curl)
		{
			return {};
		}

		auto _ = utils::finally([&]()
		{
			curl_slist_free_all(header_list);
			curl_easy_cleanup(curl);
		});

		for (const auto& header : headers)
		{
			auto data = header.first + ": " + header.second;
			header_list = curl_slist_append(header_list, data.data());
		}

		curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list);
		curl_easy_setopt(curl, CURLOPT_URL, url.data());
		curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1);
		curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeout);

		// Connection timeout - fail if can't connect within 30 seconds
		curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);

		// Stall detection - abort if speed drops below 1000 bytes/sec for 60 seconds
		curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1000L);
		curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, 60L);

		if (!fields.empty())
		{
			curl_easy_setopt(curl, CURLOPT_POSTFIELDS, fields.data());
		}

		CURLcode last_code = CURLE_OK;
		unsigned int last_response_code = 0;

		// Retry loop
		for (auto i = 0u; i < retries + 1; ++i)
		{
			std::string buffer{};
			progress_helper helper{};
			helper.callback = &callback;

			curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
			curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buffer);
			curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, progress_callback);
			curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &helper);
			curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0);

			const auto code = curl_easy_perform(curl);
			unsigned int response_code{};
			curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);

			// Track last error for reporting if all retries fail
			last_code = code;
			last_response_code = response_code;

			if (helper.exception)
			{
				std::rethrow_exception(helper.exception);
			}

			// Check if we should retry this request
			if (!should_retry_request(code, response_code))
			{
				result result;
				result.code = code;
				result.response_code = response_code;
				result.buffer = std::move(buffer);
				return result;
			}

			// If we have more retries left, wait a bit before trying again
			if (i < retries)
			{
				printf("HTTP request failed for %s (code: %d, response: %u), retrying in 1s... (attempt %u/%u)\n",
					url.data(), code, response_code, i + 1, retries);
				std::this_thread::sleep_for(std::chrono::milliseconds(1000));
			}
		}

		// All retries failed - return the actual last error
		result result;
		result.code = last_code;
		result.response_code = last_response_code;
		return result;
	}

	std::optional<result> get_data_stream(const std::string& url, const headers& headers,
		const std::string& fields, const std::function<bool(size_t, size_t, size_t)>& progress_callback_,
		const std::function<bool(const char*, size_t)>& stream_callback, int timeout, uint32_t retries)
	{
		curl_slist* header_list = nullptr;
		auto* curl = curl_easy_init();
		if (!curl)
		{
			return {};
		}

		auto _ = utils::finally([&]()
		{
			curl_slist_free_all(header_list);
			curl_easy_cleanup(curl);
		});

		// Set up headers
		for (const auto& header : headers)
		{
			auto data = header.first + ": " + header.second;
			header_list = curl_slist_append(header_list, data.data());
		}

		// Set common curl options
		curl_easy_setopt(curl, CURLOPT_HTTPHEADER, header_list);
		curl_easy_setopt(curl, CURLOPT_URL, url.data());
		curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1);
		curl_easy_setopt(curl, CURLOPT_TIMEOUT, timeout);

		// Connection timeout - fail if can't connect within 30 seconds
		curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);

		// Stall detection - abort if speed drops below 1000 bytes/sec for 60 seconds
		curl_easy_setopt(curl, CURLOPT_LOW_SPEED_LIMIT, 1000L);
		curl_easy_setopt(curl, CURLOPT_LOW_SPEED_TIME, 60L);

		if (!fields.empty())
		{
			curl_easy_setopt(curl, CURLOPT_POSTFIELDS, fields.data());
		}

		CURLcode last_code = CURLE_OK;
		unsigned int last_response_code = 0;

		// Keep stream_helper outside retry loop so bytes_written accumulates across retries
		stream_helper write_helper{};
		write_helper.callback = &stream_callback;

		// Retry loop
		for (auto i = 0u; i < retries + 1; ++i)
		{
			// Reset progress helper for each attempt (speed calculation needs reset)
			progress_helper helper{};
			helper.callback = &progress_callback_;
			helper.start = std::chrono::high_resolution_clock::now();

			// Resume from bytes already written in this session (for internal retries)
			if (write_helper.bytes_written > 0)
			{
				curl_easy_setopt(curl, CURLOPT_RESUME_FROM_LARGE, write_helper.bytes_written);
			}

			curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback_stream);
			curl_easy_setopt(curl, CURLOPT_WRITEDATA, &write_helper);
			curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, progress_callback);
			curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &helper);
			curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0);

			const auto code = curl_easy_perform(curl);
			unsigned int response_code{};
			curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);

			// Track last error for reporting if all retries fail
			last_code = code;
			last_response_code = response_code;

			// Handle exceptions from callbacks
			if (helper.exception)
			{
				std::rethrow_exception(helper.exception);
			}

			if (write_helper.exception)
			{
				std::rethrow_exception(write_helper.exception);
			}

			// Check if we should retry this request
			if (!should_retry_request(code, response_code))
			{
				result result;
				result.code = code;
				result.response_code = response_code;
				return result;
			}

			// If we have more retries left, wait a bit before trying again
			if (i < retries)
			{
				printf("HTTP stream request failed for %s (code: %d, response: %u), retrying in 1s... (attempt %u/%u)\n",
					url.data(), code, response_code, i + 1, retries);
				std::this_thread::sleep_for(std::chrono::milliseconds(1000));
			}
		}

		// All retries failed - return the actual last error
		result result;
		result.code = last_code;
		result.response_code = last_response_code;
		return result;
	}

	std::future<std::optional<result>> get_data_async(const std::string& url, const std::string& fields,
		const headers& headers, const std::function<int(size_t, size_t, size_t)>& callback, uint32_t retries)
	{
		return std::async(std::launch::async, [url, fields, headers, callback, retries]()
			{
				return get_data(url, fields, headers, callback, 0, retries);
			});
	}
}
