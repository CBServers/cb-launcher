#pragma once

#include <functional>
#include <memory>
#include <string>
#include <thread>

namespace social
{
    struct inbox_state;

    // One held poll per launcher against the cbfriends invite inbox, carrying both the CB address
    // (once a profile exists) and the Discord address (once linked). Signed by the device key, so it
    // runs with or without either; each service registers a handler for its own sender namespace.
    class inbox_client
    {
    public:
        static inbox_client& instance();

        inbox_client(const inbox_client&) = delete;
        inbox_client& operator=(const inbox_client&) = delete;

        // Retry hint for a throttle; the inbox refills one token every couple of seconds.
        static constexpr float throttle_retry_seconds = 20.0f;

        enum class outcome
        {
            delivered,
            offline,   // recipient holds no live poll => CB reports it, Discord falls back to the SDK
            throttled, // server-side limit => report rate_limited, never fall back
            blocked,   // the server refused the pair => nothing more to do
            failed,    // transport error / no binding => Discord falls back to the SDK
        };

        struct message
        {
            std::string id;
            std::string sender; // cb_ id or Discord snowflake, per source
            std::string source; // "cb" | "discord"
            std::string kind;   // "invite" | "join-request"
            std::string game_id;
            std::string match_id;
            std::string join_secret;
            std::string reply_to;
            bool is_approval{false};
            bool accept{true};
        };

        using message_callback = std::function<void(const message&)>;
        using outcome_callback = std::function<void(outcome)>;

        // Handlers fire on the poll thread; a service that needs its own thread posts from there.
        void set_cb_handler(message_callback callback);
        void set_discord_handler(message_callback callback);

        void start();
        void stop();

        // Binding changes: each cuts the held poll short and attaches again. Flag-and-wake only,
        // so they are safe from any thread, including under a service's own lock.
        void attach_discord(const std::string& access_token);
        void detach_discord();
        void reattach();

        bool connected() const;
        // The server's relayEnabled switch, a bound Discord address and a live poll; anything
        // missing keeps Discord invites on the SDK path.
        bool discord_enabled() const;

        void send_async(const std::string& to, const std::string& kind, const std::string& game,
                        const std::string& match_id, const std::string& join_secret,
                        outcome_callback on_result);
        void reply_async(const std::string& to, const std::string& reply_to, bool accept,
                         const std::string& game, const std::string& match_id,
                         const std::string& join_secret, outcome_callback on_result);

    private:
        inbox_client();
        ~inbox_client();

        std::shared_ptr<inbox_state> state_;
        std::thread thread_{};
    };
}
