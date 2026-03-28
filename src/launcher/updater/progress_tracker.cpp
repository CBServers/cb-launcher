#include <std_include.hpp>

#include "progress_tracker.hpp"

#include <utils/string.hpp>
#include <algorithm>

namespace updater
{
    progress_tracker& progress_tracker::instance()
    {
        static progress_tracker instance;
        return instance;
    }

    void progress_tracker::begin_update(size_t total_files, size_t total_bytes, progress_mode mode)
    {
        std::lock_guard lock(this->mutex_);
        this->state_.is_active = true;
        this->state_.is_cancelled = false; // Reset cancellation flag for new update
        this->state_.total_files = total_files;
        this->state_.total_bytes = total_bytes;
        this->state_.completed_files = 0;
        this->state_.downloaded_bytes = 0;
        this->state_.current_file.clear();

        const char* action = (mode == progress_mode::verifying) ? "verification"
            : (mode == progress_mode::deleting) ? "deletion" : "download";
        this->state_.status_message = utils::string::va("Starting %s...", action);

        this->state_.progress_percent = 0.0f;
        this->mode_ = mode;
        this->files_in_progress_.clear();
    }

    void progress_tracker::end_update()
    {
        std::lock_guard lock(this->mutex_);
        this->state_.is_active = false;
        this->state_.progress_percent = 100.0f;
        this->state_.status_message = "Update complete";
    }

    void progress_tracker::cancel_update()
    {
        std::lock_guard lock(this->mutex_); 
        this->state_.is_active = false;
        this->state_.is_cancelled = true;
        this->state_.status_message = "Update cancelled";
    }

    bool progress_tracker::is_cancelled() const
    {
        std::lock_guard lock(this->mutex_);
        return this->state_.is_cancelled;
    }

    void progress_tracker::set_current_file(const std::string& file_name)
    {
        std::lock_guard lock(this->mutex_);

        // Add file to the in-progress list
        this->files_in_progress_.push_back(file_name);

        // Update the display to show the first file in the list
        this->update_current_file_display();
    }

    void progress_tracker::file_completed(const std::string& file_name)
    {
        std::lock_guard lock(this->mutex_);

        // Remove the file from the in-progress list
        auto it = std::find(this->files_in_progress_.begin(), this->files_in_progress_.end(), file_name);
        if (it != this->files_in_progress_.end())
        {
            this->files_in_progress_.erase(it);
        }

        // Update the display to show the next file (or clear if none)
        this->update_current_file_display();

        if (this->state_.completed_files < this->state_.total_files)
        {
            this->state_.completed_files++;
        }

        this->recalculate_progress();
    }

    void progress_tracker::update_downloaded_bytes(size_t current_file_size)
    {
        std::lock_guard lock(this->mutex_);

        // Calculate total: completed files bytes + current file progress
        size_t completed_bytes = this->state_.downloaded_bytes;
        this->state_.downloaded_bytes = completed_bytes + current_file_size;

        this->recalculate_progress();
    }

    void progress_tracker::recalculate_progress()
    {
        if (this->state_.total_bytes == 0)
        {
            // Fallback to file count if we don't have byte information
            if (this->state_.total_files > 0)
            {
                this->state_.progress_percent =
                    (static_cast<float>(this->state_.completed_files) / static_cast<float>(this->state_.total_files)) * 100.0f;
            }
            else
            {
                this->state_.progress_percent = 0.0f;
            }
        }
        else
        {
            this->state_.progress_percent =
                (static_cast<float>(this->state_.downloaded_bytes) / static_cast<float>(this->state_.total_bytes)) * 100.0f;
        }

        // Clamp to 0-100 range
        if (this->state_.progress_percent < 0.0f)
        {
            this->state_.progress_percent = 0.0f;
        }
        else if (this->state_.progress_percent > 100.0f)
        {
            this->state_.progress_percent = 100.0f;
        }

        // Update status message with progress
        if (!this->state_.current_file.empty())
        {
            const char* action = (this->mode_ == progress_mode::verifying) ? "Verifying"
            : (this->mode_ == progress_mode::deleting) ? "Deleting"
            : "Downloading";
            this->state_.status_message = utils::string::va(
                "%s %s (%zu/%zu files)...",
                action,
                this->state_.current_file.data(),
                this->state_.completed_files,
                this->state_.total_files
            );
        }
    }

    progress_tracker::progress_state progress_tracker::get_progress() const
    {
        std::lock_guard lock(this->mutex_);
        return this->state_;
    }

    bool progress_tracker::is_active() const
    {
        std::lock_guard lock(this->mutex_);
        return this->state_.is_active;
    }

    void progress_tracker::reset(bool new_update)
    {
        std::lock_guard lock(this->mutex_);
        this->state_ = progress_state{};
        this->files_in_progress_.clear();

        if (new_update)
        {
            this->state_.is_active = true;
            this->state_.is_cancelled = false;
        }
    }

    void progress_tracker::update_current_file_display()
    {
        // Mutex should already be locked by caller

        if (this->files_in_progress_.empty())
        {
            // No files in progress, clear the display
            this->state_.current_file.clear();

            // Update status message based on state
            if (this->state_.completed_files == this->state_.total_files && this->state_.total_files > 0)
            {
                const char* action = (this->mode_ == progress_mode::verifying) ? "Verified"
                : (this->mode_ == progress_mode::deleting) ? "Deleted" : "Downloaded";
                this->state_.status_message = utils::string::va("%s all files (%zu/%zu)",
                    action, this->state_.completed_files, this->state_.total_files);
            }
            else if (this->state_.is_active)
            {
                const char* action = (this->mode_ == progress_mode::verifying) ? "Verifying"
            : (this->mode_ == progress_mode::deleting) ? "Deleting" : "Downloading";
                this->state_.status_message = utils::string::va("%s files... (%zu/%zu)",
                    action, this->state_.completed_files, this->state_.total_files);
            }
        }
        else
        {
            // Display the last file in the list
            this->state_.current_file = this->files_in_progress_.back();

            const char* action = (this->mode_ == progress_mode::verifying) ? "Verifying"
            : (this->mode_ == progress_mode::deleting) ? "Deleting" : "Downloading";
            this->state_.status_message = utils::string::va(
                "%s %s (%zu/%zu files)...",
                action,
                this->state_.current_file.data(),
                this->state_.completed_files,
                this->state_.total_files
            );
        }
    }
}
