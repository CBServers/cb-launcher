#include "std_include.hpp"
#include "relay_client.hpp"
#include "discord_constants.hpp"

#include <utils/flags.hpp>
#include <utils/http.hpp>
#include <utils/logger.hpp>

#include <condition_variable>
#include <cstdlib>
#include <random>

namespace discord
{
    namespace
    {
        constexpr int POLL_TIMEOUT_SECONDS = 40; // the relay holds a poll for ~25s
        constexpr int SEND_TIMEOUT_SECONDS = 10;
        constexpr long CONNECT_TIMEOUT_SECONDS = 15;
        constexpr auto BACKOFF_INITIAL = 1s;
        constexpr auto BACKOFF_MAX = 30s;
        constexpr double JITTER_MAX_MS = 5000.0; // a relay restart drops every hold at once
        constexpr auto IDLE_WAIT = 2s;           // no Discord access token yet
        constexpr size_t MAX_ACK = 64;           // matches the relay's own cap

        std::string resolve_base_url()
        {
            // Dev override: -relay-url http://127.0.0.1:8091 points the client at a local relay.
            if (const auto value = utils::flags::get_flag_value("relay-url"); value && !value->empty())
            {
                auto url = *value;
                while (!url.empty() && url.back() == '/')
                {
                    url.pop_back();
                }
                return url;
            }

            return RELAY_URL;
        }

        void add_string(rapidjson::Value& object, const char* key, const std::string& value,
                        rapidjson::Document::AllocatorType& allocator)
        {
            rapidjson::Value member{};
            member.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
            object.AddMember(rapidjson::StringRef(key), member, allocator);
        }

        std::string to_json(const rapidjson::Document& document)
        {
            rapidjson::StringBuffer buffer{};
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            document.Accept(writer);
            return buffer.GetString();
        }

        std::string member_string(const rapidjson::Value& object, const char* key)
        {
            const auto it = object.FindMember(key);
            if (it == object.MemberEnd() || !it->value.IsString())
            {
                return {};
            }
            return it->value.GetString();
        }

        bool member_bool(const rapidjson::Value& object, const char* key, const bool fallback)
        {
            const auto it = object.FindMember(key);
            if (it == object.MemberEnd() || !it->value.IsBool())
            {
                return fallback;
            }
            return it->value.GetBool();
        }

        // Both a 200 body and a 429 body name the reason; the launcher must read it before
        // classifying, or a throttle would trigger the Discord fallback it exists to prevent.
        relay_client::outcome outcome_from_reason(const std::string& reason)
        {
            if (reason == "delivered") return relay_client::outcome::delivered;
            if (reason == "offline") return relay_client::outcome::offline;
            if (reason == "throttled") return relay_client::outcome::throttled;
            if (reason == "blocked") return relay_client::outcome::blocked;
            return relay_client::outcome::failed;
        }

        relay_client::outcome classify_send(const std::optional<utils::http::result>& result)
        {
            if (!result || result->code != CURLE_OK)
            {
                return relay_client::outcome::failed;
            }

            rapidjson::Document body{};
            body.Parse(result->buffer);
            const auto reason = !body.HasParseError() && body.IsObject() ? member_string(body, "reason") : std::string{};

            if (result->response_code == 429)
            {
                return reason == "throttled" ? relay_client::outcome::throttled : relay_client::outcome::failed;
            }

            if (result->response_code < 200 || result->response_code >= 300)
            {
                return relay_client::outcome::failed;
            }

            return outcome_from_reason(reason);
        }

        size_t poll_write_callback(void* contents, const size_t size, const size_t nmemb, void* userp)
        {
            const auto total = size * nmemb;
            static_cast<std::string*>(userp)->append(static_cast<char*>(contents), total);
            return total;
        }
    }

    struct relay_client_state
    {
        std::string base_url{resolve_base_url()};
        std::mutex mutex{};
        std::condition_variable cv{};
        std::string access_token{}; // Discord bearer, only used to mint a relay session
        std::string relay_token{};
        relay_client::snapshot_provider snapshot{};
        relay_client::message_callback on_message{};
        std::atomic<bool> running{false};
        std::atomic<bool> server_enabled{false}; // relayEnabled kill switch from /v1/session/start
        std::atomic<bool> connected{false};      // last poll round trip succeeded
        std::atomic<bool> alive{true};           // false once the owner is going away; gates detached senders
    };

    namespace
    {
        using state_ptr = std::shared_ptr<relay_client_state>;

        std::string relay_token_of(const state_ptr& s)
        {
            std::lock_guard lock(s->mutex);
            return s->relay_token;
        }

        void clear_relay_token(const state_ptr& s, const std::string& expected)
        {
            std::lock_guard lock(s->mutex);
            if (expected.empty() || s->relay_token == expected)
            {
                s->relay_token.clear();
            }
        }

        void wait_interruptible(const state_ptr& s, const std::chrono::milliseconds delay)
        {
            std::unique_lock lock(s->mutex);
            s->cv.wait_for(lock, delay, [&s] { return !s->running; });
        }

        std::chrono::milliseconds next_backoff(std::chrono::milliseconds& backoff)
        {
            static thread_local std::mt19937 rng{std::random_device{}()};
            std::uniform_real_distribution<double> unit(0.0, 1.0);

            const auto delay = backoff.count() * (0.5 + unit(rng)) + unit(rng) * JITTER_MAX_MS;
            backoff = std::min<std::chrono::milliseconds>(backoff * 2, BACKOFF_MAX);
            return std::chrono::milliseconds(static_cast<int64_t>(delay));
        }

        utils::http::headers send_headers(const std::string& token)
        {
            return {
                {"Authorization", "Bearer " + token},
                {"Content-Type", "application/json"},
            };
        }

        // Exchanges the Discord bearer for a relay token; also carries the relayEnabled kill switch.
        bool mint_session(const state_ptr& s, const std::string& access_token)
        {
            const auto result = utils::http::get_data(s->base_url + "/v1/session/start", "{}",
                                                     send_headers(access_token),
                                                     [&s](size_t, size_t, size_t) { return s->running.load(); },
                                                     SEND_TIMEOUT_SECONDS, 0);
            if (!result || result->code != CURLE_OK || result->response_code != 200)
            {
                utils::logger::write("[cbl-relay] session/start failed (code {}, http {})",
                                     result ? static_cast<int>(result->code) : -1,
                                     result ? result->response_code : 0u);
                return false;
            }

            rapidjson::Document body{};
            body.Parse(result->buffer);
            if (body.HasParseError() || !body.IsObject())
            {
                return false;
            }

            const auto token = member_string(body, "relayToken");
            if (token.empty())
            {
                return false;
            }

            {
                std::lock_guard lock(s->mutex);
                s->relay_token = token;
            }
            s->server_enabled = member_bool(body, "relayEnabled", false);
            s->connected = true;

            utils::logger::write("[cbl-relay] session started (relayEnabled {})", s->server_enabled.load());
            return true;
        }

        std::string build_poll_body(const state_ptr& s, const std::vector<std::string>& ack)
        {
            rapidjson::Document request{rapidjson::kObjectType};
            auto& allocator = request.GetAllocator();

            rapidjson::Value ids(rapidjson::kArrayType);
            for (const auto& id : ack)
            {
                rapidjson::Value value{};
                value.SetString(id.data(), static_cast<rapidjson::SizeType>(id.size()), allocator);
                ids.PushBack(value, allocator);
            }
            request.AddMember("ack", ids, allocator);

            relay_client::session_snapshot snapshot{};
            if (s->snapshot)
            {
                snapshot = s->snapshot();
            }

            if (snapshot.valid)
            {
                rapidjson::Value session(rapidjson::kObjectType);
                add_string(session, "game", snapshot.game, allocator);
                add_string(session, "matchId", snapshot.match_id, allocator);
                add_string(session, "mode", snapshot.mode, allocator);
                add_string(session, "map", snapshot.map, allocator);
                add_string(session, "gametype", snapshot.gametype, allocator);
                session.AddMember("joinable", snapshot.joinable, allocator);
                session.AddMember("directJoin", snapshot.direct_join, allocator);
                session.AddMember("openable", snapshot.openable, allocator);
                session.AddMember("players", snapshot.players, allocator);
                session.AddMember("maxPlayers", snapshot.max_players, allocator);
                request.AddMember("session", session, allocator);
            }

            request.AddMember("activityPrivacyGap", snapshot.privacy_gap, allocator);

            return to_json(request);
        }

        // Dispatches everything the poll returned and stages their ids for the next ack. Acking on
        // receipt (not on outcome) is what stops the relay redelivering messages we already handled.
        void dispatch_invites(const state_ptr& s, const std::string& response, std::vector<std::string>& ack)
        {
            rapidjson::Document body{};
            body.Parse(response);
            if (body.HasParseError() || !body.IsObject() || !body.HasMember("invites") || !body["invites"].IsArray())
            {
                return;
            }

            for (const auto& entry : body["invites"].GetArray())
            {
                if (!entry.IsObject())
                {
                    continue;
                }

                relay_client::message message{};
                message.id = member_string(entry, "id");
                message.sender_id = std::strtoull(member_string(entry, "from").data(), nullptr, 10);
                message.kind = member_string(entry, "kind");
                message.game_id = member_string(entry, "game");
                message.match_id = member_string(entry, "matchId");
                message.join_secret = member_string(entry, "joinSecret");
                message.is_approval = member_bool(entry, "isApproval", false);
                message.accept = member_bool(entry, "accept", true);

                if (!message.id.empty() && std::ranges::find(ack, message.id) == ack.end())
                {
                    ack.push_back(message.id);
                }

                if (message.sender_id != 0 && s->on_message)
                {
                    s->on_message(message);
                }
            }

            while (ack.size() > MAX_ACK)
            {
                ack.erase(ack.begin());
            }
        }

        // One persistent easy handle, reused across holds so the connection (and TLS session) survives.
        void run_poll_loop(const state_ptr& s)
        {
            auto* curl = curl_easy_init();
            if (!curl)
            {
                utils::logger::write("[cbl-relay] curl_easy_init failed; relay disabled");
                s->connected = false;
                return;
            }

            std::vector<std::string> ack{};
            auto backoff = std::chrono::duration_cast<std::chrono::milliseconds>(BACKOFF_INITIAL);
            auto unauthorized_streak = 0;

            while (s->running)
            {
                std::string access_token{};
                std::string relay_token{};
                {
                    std::lock_guard lock(s->mutex);
                    access_token = s->access_token;
                    relay_token = s->relay_token;
                }

                if (access_token.empty())
                {
                    s->connected = false;
                    wait_interruptible(s, std::chrono::duration_cast<std::chrono::milliseconds>(IDLE_WAIT));
                    continue;
                }

                if (relay_token.empty())
                {
                    if (!mint_session(s, access_token))
                    {
                        s->connected = false;
                        wait_interruptible(s, next_backoff(backoff));
                        continue;
                    }

                    backoff = std::chrono::duration_cast<std::chrono::milliseconds>(BACKOFF_INITIAL);
                    continue;
                }

                const auto body = build_poll_body(s, ack);
                const auto url = s->base_url + "/v1/poll";
                std::string response{};

                curl_slist* headers = nullptr;
                auto authorization = "Authorization: Bearer " + relay_token;
                headers = curl_slist_append(headers, authorization.data());
                headers = curl_slist_append(headers, "Content-Type: application/json");

                curl_easy_reset(curl);
                curl_easy_setopt(curl, CURLOPT_URL, url.data());
                curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
                curl_easy_setopt(curl, CURLOPT_POST, 1L);
                curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data());
                curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
                curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, poll_write_callback);
                curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
                curl_easy_setopt(curl, CURLOPT_TIMEOUT, POLL_TIMEOUT_SECONDS);
                curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, CONNECT_TIMEOUT_SECONDS);
                curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
                curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
                curl_easy_setopt(curl, CURLOPT_XFERINFODATA, s.get());
                // Aborts the held poll on stop(), so shutdown never waits out the hold.
                curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION,
                                 +[](void* clientp, curl_off_t, curl_off_t, curl_off_t, curl_off_t)
                                 {
                                     return static_cast<relay_client_state*>(clientp)->running ? 0 : 1;
                                 });

                const auto code = curl_easy_perform(curl);
                long http_code = 0;
                curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
                curl_slist_free_all(headers);

                if (!s->running)
                {
                    break;
                }

                if (code != CURLE_OK)
                {
                    utils::logger::write("[cbl-relay] poll failed (code {})", static_cast<int>(code));
                    s->connected = false;
                    wait_interruptible(s, next_backoff(backoff));
                    continue;
                }

                if (http_code == 401)
                {
                    clear_relay_token(s, relay_token);
                    s->connected = false;
                    ++unauthorized_streak;
                    // A re-mint that immediately 401s again would hot-loop; only the first is free.
                    if (unauthorized_streak > 1)
                    {
                        wait_interruptible(s, next_backoff(backoff));
                    }
                    continue;
                }

                unauthorized_streak = 0;

                if (http_code != 200)
                {
                    utils::logger::write("[cbl-relay] poll http {}", http_code);
                    wait_interruptible(s, next_backoff(backoff));
                    continue;
                }

                backoff = std::chrono::duration_cast<std::chrono::milliseconds>(BACKOFF_INITIAL);
                s->connected = true;
                ack.clear(); // the acks we just sent were accepted
                dispatch_invites(s, response, ack);
            }

            curl_easy_cleanup(curl);
        }

        void post_send(const state_ptr& s, const std::string& path, const std::string& body,
                       relay_client::outcome_callback on_result)
        {
            std::thread([s, path, body, on_result = std::move(on_result)]
            {
                auto result = relay_client::outcome::failed;

                if (const auto token = relay_token_of(s); !token.empty())
                {
                    const auto response = utils::http::get_data(s->base_url + path, body, send_headers(token), {},
                                                               SEND_TIMEOUT_SECONDS, 0);
                    result = classify_send(response);

                    if (response && response->response_code == 401)
                    {
                        clear_relay_token(s, token); // the poll thread re-mints
                        s->connected = false;
                    }
                }

                if (s->alive && on_result)
                {
                    on_result(result);
                }
            }).detach();
        }
    }

    relay_client::relay_client()
        : state_(std::make_shared<relay_client_state>())
    {
    }

    relay_client::~relay_client()
    {
        this->state_->alive = false;
        this->stop();
    }

    void relay_client::start(const std::string& access_token, snapshot_provider snapshot, message_callback on_message)
    {
        {
            std::lock_guard lock(this->state_->mutex);
            this->state_->access_token = access_token;

            if (this->state_->running)
            {
                this->state_->cv.notify_all(); // a loop idling on a missing token picks it up now
                return;
            }

            this->state_->snapshot = std::move(snapshot);
            this->state_->on_message = std::move(on_message);
            this->state_->running = true;
        }

        if (this->thread_.joinable())
        {
            this->thread_.join();
        }

        this->thread_ = std::thread([s = this->state_] { run_poll_loop(s); });
    }

    void relay_client::stop()
    {
        {
            std::lock_guard lock(this->state_->mutex);
            this->state_->running = false;
            this->state_->cv.notify_all();
        }

        this->state_->connected = false;

        if (this->thread_.joinable())
        {
            this->thread_.join();
        }

        std::lock_guard lock(this->state_->mutex);
        this->state_->relay_token.clear();
        this->state_->access_token.clear();
    }

    bool relay_client::enabled() const
    {
        // Server kill switch AND a live session; either missing puts every caller back on the SDK.
        return this->state_->server_enabled && this->state_->connected;
    }

    void relay_client::send_invite_async(const std::string& to, const std::string& kind, const std::string& game,
                                         const std::string& match_id, const std::string& join_secret,
                                         outcome_callback on_result)
    {
        rapidjson::Document request{rapidjson::kObjectType};
        auto& allocator = request.GetAllocator();
        add_string(request, "to", to, allocator);
        add_string(request, "kind", kind, allocator);
        add_string(request, "game", game, allocator);
        add_string(request, "matchId", match_id, allocator);
        if (!join_secret.empty())
        {
            add_string(request, "joinSecret", join_secret, allocator);
        }

        post_send(this->state_, "/v1/invite", to_json(request), std::move(on_result));
    }

    void relay_client::send_reply_async(const std::string& to, const std::string& reply_to, const bool accept,
                                        const std::string& game, const std::string& match_id,
                                        const std::string& join_secret, outcome_callback on_result)
    {
        rapidjson::Document request{rapidjson::kObjectType};
        auto& allocator = request.GetAllocator();
        add_string(request, "to", to, allocator);
        add_string(request, "inviteId", reply_to, allocator);
        request.AddMember("accept", accept, allocator);
        add_string(request, "game", game, allocator);
        add_string(request, "matchId", match_id, allocator);
        if (accept && !join_secret.empty())
        {
            add_string(request, "joinSecret", join_secret, allocator);
        }

        post_send(this->state_, "/v1/invite/reply", to_json(request), std::move(on_result));
    }
}
