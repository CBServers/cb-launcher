#pragma once

#include "file_info.hpp"
#include <vector>

namespace updater
{
	class progress_listener
	{
	public:
		virtual ~progress_listener() = default;

		virtual void update_files(const std::vector<file_info>& files) = 0;
		virtual void done_update() = 0;
		virtual bool is_update_cancelled() { return false; }

		virtual void begin_file(const file_info& file) = 0;
		virtual void end_file(const file_info& file) = 0;

		virtual void file_progress(const file_info& file, size_t progress) = 0;

		// Optional: Set verification mode (file-count based vs byte-based progress)
		// Default implementation does nothing - only ui_progress_listener needs this
		virtual void set_verification_mode([[maybe_unused]] bool verification_mode) {}
	};
}
