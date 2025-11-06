#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <atomic>

namespace updater
{
	enum class progress_mode
	{
		verifying,
		downloading
	};

	class progress_tracker
	{
	public:
		struct progress_state
		{
			std::string current_file;
			std::string status_message;
			size_t total_files = 0;
			size_t completed_files = 0;
			size_t total_bytes = 0;
			size_t downloaded_bytes = 0;
			bool is_active = false;
			bool is_cancelled = false;
			float progress_percent = 0.0f;
		};

		static progress_tracker& instance();

		// Called by updater to manage lifecycle
		void begin_update(size_t total_files, size_t total_bytes, progress_mode mode);
		void end_update();
		void cancel_update();
		bool is_cancelled() const;

		// Called by updater during progress
		void set_current_file(const std::string& file_name);
		void file_completed(const std::string& file_name);
		void update_downloaded_bytes(size_t current_file_size);

		// Called by UI to read progress
		progress_state get_progress() const;
		bool is_active() const;

		// Clear/reset
		void reset(bool new_update);

	private:
		progress_tracker() = default;
		~progress_tracker() = default;

		progress_tracker(const progress_tracker&) = delete;
		progress_tracker& operator=(const progress_tracker&) = delete;

		mutable std::recursive_mutex mutex_;
		progress_state state_;
		progress_mode mode_ = progress_mode::verifying;
		std::vector<std::string> files_in_progress_;  // Track all files currently being processed

		void recalculate_progress();
		void update_current_file_display();  // Update current_file from files_in_progress_
	};
}
