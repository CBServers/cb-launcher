#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <rapidjson/document.h>

namespace social
{
    enum class profile_state
    {
        none,     // no CB profile on this install yet
        creating, // a create/recover request is in flight
        ready,
        error,
    };

    std::string profile_state_to_string(profile_state state);

    struct cb_profile
    {
        std::string cb_id;
        std::string handle;
        std::string display_name;
        std::string avatar_url;
        std::string bio;
        std::string accent;        // "#rrggbb", empty = launcher default
        std::string favorite_game;
    };

    // A friend, request, or LFG poster, with live presence folded in.
    struct cb_person
    {
        std::string cb_id;
        std::string handle;
        std::string display_name;
        std::string avatar_url;
        bool online{false};
        std::string game;
        std::string mode;
        std::string status;
        std::string bio;
        std::string accent;
        std::string favorite_game;
        // game id -> seconds played, accumulated from our own presence beats.
        std::vector<std::pair<std::string, int64_t>> playtime;
        int64_t created_at{0};
        int64_t last_seen{0};
        std::string relation; // "self" | "friend" | "requested" | "incoming" | "none"
        std::string note;     // LFG only
        int slots{0};         // LFG only
        int joined{0};        // LFG only
        bool i_joined{false}; // LFG only

        // In-game join state, mirroring discord::friend_entry.
        bool joinable{false};
        bool direct_join{false}; // public/dedicated server => join without host approval
        bool openable{false};    // closed private match we can knock on
        bool same_match{false};
        std::string match_id;
    };

    // A pending CB game invite or join-request, mirroring discord::invite_entry.
    struct cb_invite
    {
        std::string id;
        std::string sender_cb_id;
        std::string sender_name;
        std::string sender_avatar;
        std::string game;
        bool is_request{false};  // a friend asked to join us
        bool is_approval{false}; // a host approved our join request
        bool needs_open{false};  // approving requires opening our match first
        std::string join_secret;
        std::string match_id;
    };

    // A queued report, with both sides resolved so the queue reads without extra lookups.
    struct mod_report
    {
        std::string id;
        std::string reason;
        std::string context;
        std::string status;
        int64_t at{0};
        cb_person reporter;
        cb_person target;
    };

    // One moderator action, for the audit trail.
    struct mod_log_entry
    {
        std::string action;
        std::string detail;
        int64_t at{0};
        cb_person by;
        cb_person target;
    };

    // A moderator's view of one account.
    struct mod_account
    {
        cb_person person;
        std::string role;
        std::string mute_reason;
        int64_t muted_until{0};
        int64_t created_at{0};
        int device_count{0};
    };

    // One row of the conversation list: who, the last thing said, and how much is unread.
    struct dm_conversation
    {
        cb_person person;
        std::string preview;
        int64_t last_at{0};
        int unread{0};
    };

    struct friends_snapshot
    {
        std::vector<cb_person> friends;
        std::vector<cb_person> incoming;
        std::vector<cb_person> outgoing;
    };

    // Something the account owner should see, such as a new device being bound.
    struct security_event
    {
        std::string kind; // "device-added" | "recover-blocked"
        std::string via;  // "hwid" | "discord" | "code"
        int64_t at{0};
    };

    struct chat_message
    {
        int64_t id{0};
        std::string cb_id;
        std::string handle;
        std::string display_name;
        std::string accent;
        std::string text;
    };

    // Opt-in discovery: while on, we publish what we're playing so non-friends can find us.
    struct broadcast_state
    {
        bool on{false};
        std::string game;
        std::string note;
        int slots{0};
    };

    // Launcher-native CB account keyed off social::identity. Independent of Discord, which is optional.
    class cbfriends_service
    {
    public:
        static cbfriends_service& instance();

        cbfriends_service(const cbfriends_service&) = delete;
        cbfriends_service& operator=(const cbfriends_service&) = delete;

        // Loads the cached profile from disk, if the user already created one.
        void start();

        // The game we're currently in, or "" when idle. Published on the presence heartbeat.
        void set_activity(const std::string& game);

        // Fired when the friends snapshot changes, so the IPC layer can re-push it to a fork.
        void set_friends_changed_callback(std::function<void()> callback);

        // Publishes the join flags on presence and holds the secret locally for outgoing invites.
        void set_rich_activity(const std::string& game, const std::string& join_secret, bool direct_join,
                               bool openable, const std::string& match_id);
        void clear_rich_activity();
        bool is_joinable() const;
        bool is_same_match(const std::string& game, const std::string& match_id) const;

        void send_invite(const std::string& cb_id);
        void request_join(const std::string& cb_id);
        std::vector<cb_invite> get_invites() const;
        // Routes their secret for an invite, or approves and replies with ours for a request.
        void accept_invite(const std::string& id);
        void decline_invite(const std::string& id);
        void set_join_secret_callback(std::function<void(std::string)> callback);
        // Fired when approving a join-request needs the game to open its private match first.
        void set_open_match_callback(std::function<void()> callback);

        profile_state get_state() const;
        std::optional<cb_profile> get_profile() const;
        std::string get_last_error() const;
        bool has_recovery_code() const;
        std::string get_recovery_code() const;

        // Opt-in creation, seeded from the linked Discord account if there is one. Non-blocking.
        void begin_create_profile(const std::string& handle, const std::string& display_name);
        // Any field may be empty to leave it unchanged; a handle collision lands in get_last_error().
        void begin_update_profile(const std::string& display_name, const std::string& handle,
                                  const std::string& bio, const std::string& accent,
                                  const std::string& favorite_game, const std::string& avatar_url);

        // Pulls the avatar (and a missing display name) from the linked Discord account.
        void sync_discord();

        // Looks up anyone's public profile for the right-click card; poll get_viewed_profile().
        void request_profile(const std::string& cb_id);
        std::optional<cb_person> get_viewed_profile() const;

        void stop();

        // Actions are fire-and-forget then refresh; read the cache with get_friends().
        friends_snapshot get_friends() const;
        void add_friend(const std::string& handle);
        void accept_friend(const std::string& cb_id);
        void decline_friend(const std::string& cb_id);
        void cancel_request(const std::string& cb_id);
        void remove_friend(const std::string& cb_id);

        // The board is only polled while the Community tab is open.
        void set_community_active(bool active);
        // People seen in the same match recently and not already connected to.
        std::vector<cb_person> get_played_with() const;

        // Anyone we already hold a profile for, so a toast can resolve art without the UI naming a URL.
        std::optional<cb_person> find_person(const std::string& cb_id) const;

        // Direct messages. Friends only; the worker checks that on every call.
        void set_dm_peer(const std::string& cb_id); // "" closes the conversation
        std::string get_dm_peer() const;
        std::vector<chat_message> get_dm_messages() const;
        std::vector<dm_conversation> get_dm_conversations() const;
        int get_dm_unread() const;
        void send_dm(const std::string& cb_id, const std::string& text);

        // Moderation. The role is decided server-side on every call; this is only what to show.
        std::string get_mod_role() const;
        void set_mod_active(bool active);
        std::vector<mod_report> get_mod_reports() const;
        std::vector<mod_log_entry> get_mod_log() const;
        std::optional<mod_account> get_mod_lookup() const;
        void mod_lookup(const std::string& handle);
        void mod_resolve(const std::string& report_id);
        void mod_mute(const std::string& cb_id, int minutes, const std::string& reason);
        void mod_set_role(const std::string& cb_id, const std::string& role);

        void set_lfg_filter(const std::string& game); // "" = all games
        std::vector<cb_person> get_lfg() const;
        void post_lfg(const std::string& game, const std::string& mode, const std::string& note, int slots);
        void clear_lfg();
        void lfg_join(const std::string& poster_cb_id); // express interest + send a friend request

        broadcast_state get_broadcast() const;
        // on=true publishes for non-friend discovery and keeps it alive; off clears it. Persisted.
        void set_broadcast(bool on, const std::string& game, const std::string& note, int slots);

        // Chat rooms are "all" or a game id; only the open room is polled.
        void set_chat_room(const std::string& room);
        std::vector<chat_message> get_chat() const;
        void send_chat(const std::string& room, const std::string& text);
        // Pulls an older page of the open room and prepends it to the cache.
        void load_older_chat();
        bool has_more_chat() const;

        // Moderation. Blocking is one-way, enforced server-side, and severs any friendship.
        void block_user(const std::string& cb_id);
        void unblock_user(const std::string& cb_id);
        std::vector<cb_person> get_blocked() const;
        void report_user(const std::string& cb_id, const std::string& reason);

        // Device binds and blocked recovery attempts on this account.
        std::vector<security_event> get_security_events() const;

    private:
        cbfriends_service() = default;

        std::string base_url() const;
        void do_create_profile(std::string handle, std::string display_name);
        void do_update_profile(std::string display_name, std::string handle, std::string bio,
                               std::string accent, std::string favorite_game, std::string avatar_url);
        void do_request_profile(std::string cb_id);
        void recover_and_store(const std::string& via, const std::string& hwid, const std::string& token);
        void store_from_response(const rapidjson::Value& doc);

        void ensure_worker();
        void worker_loop();
        void refresh_friends();
        void refresh_lfg();
        void send_presence();
        void send_broadcast_keepalive();
        void load_broadcast();
        void poll_invites();
        void chat_loop();
        void poll_chat(bool hold);
        void stop_chat_worker();
        void dm_loop();
        void poll_dm(bool hold);
        void stop_dm_worker();
        void refresh_dm_list();
        void refresh_blocked();
        void refresh_security();
        void refresh_played_with();
        void refresh_mod_role();
        void refresh_mod_queue();
        void process_message(const rapidjson::Value& message);
        void send_reply(const std::string& to, const std::string& reply_to, const std::string& game,
                        const std::string& match, const std::string& secret);
        std::optional<cb_person> find_friend(const std::string& cb_id) const;
        // Fire-and-forget signed POST on a detached thread, then run `after`.
        void post_action(std::string endpoint, std::string body, std::function<void()> after);

        mutable std::mutex mutex_;
        profile_state state_{profile_state::none};
        std::optional<cb_profile> profile_;
        std::string last_error_;

        friends_snapshot friends_;
        std::vector<cb_person> lfg_;
        std::string lfg_filter_game_;

        std::string current_game_;
        std::function<void()> friends_changed_cb_;

        bool broadcast_on_{false};
        std::string broadcast_game_;
        std::string broadcast_note_;
        int broadcast_slots_{0};

        // Local join state fed by the fork's rich presence.
        std::string activity_game_;
        std::string activity_secret_;
        bool activity_direct_{false};
        bool activity_openable_{false};
        std::string activity_match_;

        std::vector<cb_invite> invites_;
        std::function<void(std::string)> join_secret_cb_;
        std::function<void()> open_match_cb_;

        std::string dm_peer_;
        std::vector<chat_message> dm_;
        int64_t dm_after_{0};
        std::vector<dm_conversation> dm_list_;
        int dm_unread_{0};

        std::string chat_room_;
        std::vector<chat_message> chat_;
        int64_t chat_after_{0};
        int64_t chat_oldest_{0};
        bool chat_more_{true};

        std::vector<cb_person> played_with_;
        std::vector<cb_person> blocked_;
        std::vector<security_event> security_;

        std::string mod_role_;
        std::vector<mod_report> mod_reports_;
        std::vector<mod_log_entry> mod_log_;
        std::optional<mod_account> mod_lookup_;

        std::optional<cb_person> viewed_profile_;

        std::thread worker_;
        std::thread chat_worker_;
        std::thread dm_worker_;
        std::atomic<bool> running_{false};
        std::atomic<bool> chat_running_{false};
        std::atomic<bool> dm_running_{false};
        std::atomic<bool> community_active_{false};
        std::atomic<bool> mod_active_{false};
        std::atomic<bool> broadcasting_{false};
        std::atomic<int64_t> last_presence_{0};
        std::atomic<int64_t> last_slow_{0};
        std::atomic<int64_t> last_dm_{0};
    };
}
