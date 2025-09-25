#pragma once

#include <format>
#include <source_location>

namespace utils::logger
{
#ifdef _DEBUG
	void log_format(const std::source_location& location, const std::string_view& fmt, std::format_args&& args);
#else
	void log_format(const std::string_view& fmt, std::format_args&& args);
#endif

	struct format_with_location
	{
		std::string_view format{};
		std::source_location location{};

		format_with_location(const std::string_view& fmt,
		                     std::source_location loc = std::source_location::current())
			: format(fmt)
			  , location(std::move(loc))
		{
		}

		format_with_location(const char* fmt,
			std::source_location loc = std::source_location::current())
			: format(fmt)
			, location(std::move(loc))
		{
		}
	};

	template <typename... Args>
	void write(const format_with_location& fmt, const Args&... args)
	{
#ifdef _DEBUG
		log_format(fmt.location, fmt.format, std::make_format_args(args...));
#else
		log_format(fmt.format, std::make_format_args(args...));
#endif
	}
}
