#pragma once

#include <functional>
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
        bool joinable{false};         // their game has a joinable party => we can join/ask to join
        bool direct_join{false};      // joinable on a public/dedicated server => "Join" (no host approval)
        bool openable{false};         // closed private match we could knock on (host opens on approve)
        std::string activity_details; // game name from their launcher presence, empty if none
        std::string activity_state;   // mode/line 3 from their launcher presence, empty if none

        // Structured in-match state parsed from the party-id presence flags (empty => not in a fork match).
        std::string game_id;       // fork id, e.g. "boiii"
        std::string game_mode;     // "mp" / "zm" / ...
        std::string game_map;      // raw map key, e.g. "mp_nuketown_x"
        std::string game_gametype; // raw gametype key, e.g. "tdm"
    };

    struct own_profile
    {
        std::string id;
        std::string display_name;
        std::string avatar_url;
    };

    // A pending Discord activity invite or join-request.
    struct invite_entry
    {
        std::string id;          // keyed by sender id (one pending per sender)
        std::string sender_id;
        std::string sender_name; // resolved from the friends cache
        std::string sender_avatar;
        std::string game_id;     // fork id the invite concerns; ours for a knock, theirs otherwise
        bool is_request{false};  // true => friend asked to join us; false => friend invited us
        bool is_approval{false}; // true => a host accepted a join request WE sent (prompt with approval text)
        bool needs_open{false};  // approving this join-request requires opening our match first
    };

    class discord_service
    {
    public:
        static discord_service& instance();

        void start();
        void stop();

        void begin_link();
        void unlink();

        // Publish "Playing <display_name> — <mode>" rich presence with game art (game_id resolves the art URL).
        void set_game_activity(const std::string& game_id, const std::string& display_name,
                               const std::string& mode);
        void clear_activity();

        // Live state reported by a fork over IPC.
        struct rich_presence_info
        {
            std::string map_display; // empty => in menu
            std::string gametype;    // friendly, e.g. "Zombies"
            std::string server_name; // empty => private match
            int players{0};
            int max_players{0};
            std::string join_secret; // unified cbl: secret; empty => not joinable
            bool direct_join{false}; // transport is direct (public/dedicated server) vs nat (private host)
            bool openable{false};    // hosting a private match not yet open to friends
            std::string map_raw;      // raw map key for the party-id presence flags
            std::string gametype_raw; // raw gametype key for the party-id presence flags
        };

        // Enrich the card with live fork state; self-contained so it works without a prior set_game_activity.
        void set_rich_game_activity(const std::string& game_id, const std::string& display_name,
                                    const std::string& mode, const rich_presence_info& info);
        // Strip enrichment back to the baseline (game + mode).
        void clear_rich_activity();

        // The launcher owns presence iff linked (SDK connected + ready). Forks go silent while it does.
        bool owns_presence() const;
        // Invoked (on the discord thread) whenever ownership flips; also fired once with the current value on set.
        void set_presence_owner_callback(std::function<void(bool)> callback);

        // Invites. The local game must publish a joinable presence (is_joinable) to send invites.
        bool is_joinable() const;
        void send_invite(const std::string& user_id);
        // Ask a joinable friend to let us join (hop 1). Approvals arriving within AUTO_ACCEPT_WINDOW
        // of the request connect silently; later ones prompt in the launcher.
        void request_join(const std::string& user_id);
        std::vector<invite_entry> get_invites() const;
        void accept_invite(const std::string& id); // Join => accept+route; JoinRequest => approve
        void decline_invite(const std::string& id);
        // Invoked (on the discord thread) with a join secret when the user accepts an invite.
        void set_join_secret_callback(std::function<void(std::string)> callback);
        // Invoked (on the discord thread) when approving a knock/invite requires the game to open its match.
        void set_open_match_callback(std::function<void()> callback);

        link_status get_status() const;
        std::optional<own_profile> get_profile() const;
        std::string get_last_error() const;

        // All Discord friends with their linked/in-launcher flags. Filtering
        // to linked friends happens at the command layer so a late registry
        // response only needs to re-flag entries.
        std::vector<friend_entry> get_friends() const;
        bool registry_ok() const;

        // Invoked (from the discord thread or a registry worker) whenever the friends list or their
        // presence changes; also fired once on set. Used to push friends snapshots over IPC.
        void set_friends_changed_callback(std::function<void()> callback);

    private:
        discord_service();
        ~discord_service();

        struct impl;
        std::unique_ptr<impl> impl_;
    };
}
