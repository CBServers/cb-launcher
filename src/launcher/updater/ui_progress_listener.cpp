#include <std_include.hpp>

#include "ui_progress_listener.hpp"

namespace updater
{
    void ui_progress_listener::update_files(const std::vector<file_info>& files, progress_mode mode)
    {
        // Calculate total size for byte-based progress
        this->total_size_ = 0;
        for (const auto& file : files)
        {
            this->total_size_ += file.size;
        }

        progress_tracker::instance().begin_update(files.size(), this->total_size_, mode);
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
        // Progress is the number of bytes downloaded/verified in this call
        progress_tracker::instance().update_downloaded_bytes(progress);
    }

    void ui_progress_listener::reset(bool new_update)
    {
        progress_tracker::instance().reset(new_update);
    }

    void ui_progress_listener::cancel_update()
    {
        progress_tracker::instance().cancel_update();
    }
}
