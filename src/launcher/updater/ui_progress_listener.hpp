#pragma once

#include "progress_listener.hpp"
#include "progress_tracker.hpp"

namespace updater
{
	class ui_progress_listener : public progress_listener
	{
	public:
		ui_progress_listener() = default;
		~ui_progress_listener() override = default;

		void update_files(const std::vector<file_info>& files) override;
		void done_update() override;
		bool is_update_cancelled() override;

		void begin_file(const file_info& file) override;
		void end_file(const file_info& file) override;

		void file_progress(const file_info& file, size_t progress) override;

		// Set verification mode (file-count based progress, not byte-based)
		void set_verification_mode(bool verification_mode) override;

	private:
		size_t total_size_ = 0;
		bool verification_mode_ = false;
	};
}
