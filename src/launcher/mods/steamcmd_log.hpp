#pragma once

namespace mods::steamcmd_log
{
    enum class content_phase
    {
        unknown,
        running,
        reconfiguring,
        preallocating,
        downloading,
        committing,
        finished,
    };

    // The state of one SteamCMD process, as told by steamcmd/logs/content_log.txt.
    struct content_run
    {
        content_phase phase = content_phase::unknown;
        bool saw_update_started = false;
        uint64_t stage_baseline = 0; // already-staged bytes, non-zero when resuming
        uint64_t stage_total = 0;    // final item size on disk
        bool saw_commit = false;
    };

    // One entry per process, in order: the log is appended to across runs.
    std::vector<content_run> parse_content_runs(const std::string& text, uint32_t appid);
}
