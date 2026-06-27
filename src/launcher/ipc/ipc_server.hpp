#pragma once

#include <memory>
#include <string>

namespace ipc
{
    // Named-pipe server: forks dial in and stream live presence to enrich Discord.
    class ipc_server
    {
    public:
        static ipc_server& instance();

        void start();
        void stop();

        // Push a presence-owner change to the connected fork.
        void notify_presence_owner(bool launcher_owns);

        // Route an accepted invite's join secret: connect a running fork, or cold-launch then connect.
        void handle_join_secret(const std::string& secret);

        // Drop any join queued for a not-yet-connected fork so a stale connect can't fire on a later hello.
        void clear_pending_join();

    private:
        ipc_server();
        ~ipc_server();

        struct impl;
        std::unique_ptr<impl> impl_;
    };
}
