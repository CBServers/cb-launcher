#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>

namespace discord
{
    struct relay_client_state;

    // Long-poll client for the self-hosted invite relay. Invites and join-requests ride this instead
    // of Discord's app-wide rate-limited surface; anything the relay can't deliver falls back to the SDK.
    class relay_client
    {
    public:
        // Retry hint for a relay throttle; its tightest bucket refills one token every 20s.
        static constexpr float throttle_retry_seconds = 20.0f;

        enum class outcome
        {
            delivered,
            offline,   // recipient has no relay session => fall back to the SDK
            throttled, // relay-side limit => report rate_limited, never fall back
            blocked,   // relay refused the pair => nothing more to do
            failed,    // transport error / no session => fall back to the SDK
        };

        // Incoming relay message, mirroring the wire object minus the fields the client never reads.
        struct message
        {
            std::string id;
            uint64_t sender_id{};
            std::string kind; // "invite" | "join-request"
            std::string game_id;
            std::string match_id;
            std::string join_secret;
            bool is_approval{false};
            bool accept{true};
        };

        // Rides the poll body. v1 stores it server-side and returns it to nobody; it's the v2 hook.
        struct session_snapshot
        {
            bool valid{false}; // false => no session object in the poll body
            std::string game;
            std::string match_id;
            std::string mode;
            std::string map;
            std::string gametype;
            bool joinable{false};
            bool direct_join{false};
            bool openable{false};
            int players{0};
            int max_players{0};
            int privacy_gap{0}; // linked, Discord-online friends whose in_launcher is false
        };

        using message_callback = std::function<void(const message&)>;
        using snapshot_provider = std::function<session_snapshot()>;
        using outcome_callback = std::function<void(outcome)>;

        relay_client();
        ~relay_client();

        relay_client(const relay_client&) = delete;
        relay_client& operator=(const relay_client&) = delete;

        // Idempotent: a second call while running only refreshes the Discord access token.
        // The callbacks fire on the poll thread / on detached send threads.
        void start(const std::string& access_token, snapshot_provider snapshot, message_callback on_message);
        void stop();

        // relayEnabled from /v1/session/start; false => every caller stays on the SDK path.
        bool enabled() const;

        void send_invite_async(const std::string& to, const std::string& kind, const std::string& game,
                               const std::string& match_id, const std::string& join_secret,
                               outcome_callback on_result);
        void send_reply_async(const std::string& to, const std::string& reply_to, bool accept,
                              const std::string& game, const std::string& match_id,
                              const std::string& join_secret, outcome_callback on_result);

    private:
        std::shared_ptr<relay_client_state> state_;
        std::thread thread_{};
    };
}
