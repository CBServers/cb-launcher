#pragma once

#include "file_info.hpp"
#include "progress_tracker.hpp"
#include <vector>

namespace updater
{
    class ui_progress_listener
    {
    public:
        ui_progress_listener() = default;
        ~ui_progress_listener() = default;

        void update_files(const std::vector<file_info>& files, progress_mode mode);
        void done_update();
        bool is_update_cancelled();

        void begin_file(const file_info& file);
        void end_file(const file_info& file);

        void file_progress(const file_info& file, size_t progress);

        void reset(bool new_update = false);
        void cancel_update();

    private:
        size_t total_size_ = 0;
    };
}
