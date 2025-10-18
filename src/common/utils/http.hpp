#pragma once

#include <string>
#include <optional>
#include <future>
#include <curl/curl.h>

namespace utils::http
{
	struct result
	{
		CURLcode code{};
		unsigned int response_code{};
		std::string buffer{};
	};

	using headers = std::unordered_map<std::string, std::string>;

	std::optional<result> get_data(const std::string& url, const std::string& fields = {},
		const headers& headers = {}, const std::function<bool(size_t, size_t, size_t)>& callback = {}, int timeout = 0, uint32_t retries = 2);

	std::optional<result> get_data_stream(const std::string& url, const headers& headers = {},
		const std::string& fields = {}, const std::function<bool(size_t, size_t, size_t)>& progress_callback_ = {},
		const std::function<bool(const char*, size_t)>& stream_callback = {}, int timeout = 0, uint32_t retries = 2);

	std::future<std::optional<result>> get_data_async(const std::string& url, const std::string& fields = {},
		const headers& headers = {}, const std::function<int(size_t, size_t)>& callback = {}, uint32_t retries = 2);
}
