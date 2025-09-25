#include "logger.hpp"
#include "nt.hpp"

#include <fstream>
#include <mutex>
#include <string>

namespace utils::logger
{
	namespace
	{
		constexpr auto* log_file_name = "cbservers.log";
		std::mutex logger_mutex;

		std::ofstream& get_stream()
		{
			static auto log_file_stream =
				std::ofstream(log_file_name, std::ios_base::out | std::ios_base::trunc);
			return log_file_stream;
		}

		void write_to_log(const std::string& line)
		{
			std::unique_lock _(logger_mutex);

			try
			{
				auto& log_file_stream = get_stream();

				if (log_file_stream.is_open())
				{
					log_file_stream << line << std::endl;
				}
			}
			catch (const std::exception&)
			{
				MessageBoxA(nullptr, "Failed to write to the log file.\nSomething is seriously wrong.",
					nullptr, MB_ICONERROR);
			}
		}
	}

#ifdef _DEBUG
	void log_format(const std::source_location& location, const std::string_view& fmt, std::format_args&& args)
#else
	void log_format(const std::string_view& fmt, std::format_args&& args)
#endif
	{
#ifdef _DEBUG
		const auto loc_info = std::format("Debug: {}::{}\n    ", location.file_name(), location.function_name());
		const auto line = loc_info + std::vformat(fmt, args);
#else
		const auto line = std::vformat(fmt, args);
#endif

		write_to_log(line);
	}
}
