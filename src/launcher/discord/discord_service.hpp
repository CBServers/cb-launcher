#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace discord
{
    enum class link_status
    {
        unavailable, // SDK DLL missing or no application ID configured
        unlinked,
        linking,    // OAuth flow in progress
        connecting, // tokens present, connecting to Discord
        linked,
        error, // tokens present but connection failed; retried with backoff
    };

    std::string link_status_to_string(link_status status);

    struct friend_entry
    {
        std::string id;
        std::string display_name;
        std::string avatar_url;
        std::string status; // "online" | "idle" | "offline"
        bool in_launcher{false};
        bool linked{false};
    };

    struct own_profile
    {
        std::string id;
        std::string display_name;
        std::string avatar_url;
    };

    class discord_service
    {
    public:
        static discord_service& instance();

        void start();
        void stop();

        void begin_link();
        void unlink();

        link_status get_status() const;
        std::optional<own_profile> get_profile() const;
        std::string get_last_error() const;

        // All Discord friends with their linked/in-launcher flags. Filtering
        // to linked friends happens at the command layer so a late registry
        // response only needs to re-flag entries.
        std::vector<friend_entry> get_friends() const;
        bool registry_ok() const;

    private:
        discord_service();
        ~discord_service();

        struct impl;
        std::unique_ptr<impl> impl_;
    };
}
