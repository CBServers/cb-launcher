#include <std_include.hpp>

#include "ui_progress_listener.hpp"

namespace updater
{
	void ui_progress_listener::update_files(const std::vector<file_info>& files)
	{
		// Calculate total size (only used for download mode)
		this->total_size_ = 0;
		for (const auto& file : files)
		{
			this->total_size_ += file.size;
		}

		// In verification mode, pass 0 for total_bytes so progress is file-count based
		const size_t total_bytes = this->verification_mode_ ? 0 : this->total_size_;
		progress_tracker::instance().begin_update(files.size(), total_bytes);
	}

	void ui_progress_listener::done_update()
	{
		progress_tracker::instance().end_update();
	}

	bool ui_progress_listener::is_update_cancelled()
	{
		return progress_tracker::instance().is_cancelled();
	}

	void ui_progress_listener::begin_file(const file_info& file)
	{
		progress_tracker::instance().set_current_file(file.name);
	}

	void ui_progress_listener::end_file(const file_info& file)
	{
		progress_tracker::instance().file_completed(file.name);
	}

	void ui_progress_listener::file_progress([[maybe_unused]] const file_info& file, size_t progress)
	{
		// Progress is the number of bytes downloaded in this within this call
		progress_tracker::instance().update_downloaded_bytes(progress);
	}

	void ui_progress_listener::set_verification_mode(bool verification_mode)
	{
		this->verification_mode_ = verification_mode;
	}
}
