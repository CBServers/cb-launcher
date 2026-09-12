#include "std_include.hpp"
#include "inbox_client.hpp"
#include "signed_http.hpp"
#include "discord/token_store.hpp"

#include <utils/logger.hpp>

#include <condition_variable>
#include <ctime>
#include <random>

namespace social
{
    namespace
    {
        constexpr int POLL_TIMEOUT_SECONDS = 40; // the inbox holds a poll for ~25s
        constexpr int SEND_TIMEOUT_SECONDS = 10;
        constexpr long CONNECT_TIMEOUT_SECONDS = 15;
        constexpr auto BACKOFF_INITIAL = 1s;
        constexpr auto BACKOFF_MAX = 30s;
        constexpr double JITTER_MAX_MS = 5000.0; // a worker restart drops every hold at once

        using signed_http::add_string;
        using signed_http::json_get;
        using signed_http::serialize;

        bool json_bool(const rapidjson::Value& value, const char* key, const bool fallback)
        {
            if (value.IsObject() && value.HasMember(key) && value[key].IsBool())
            {
                return value[key].GetBool();
            }
            return fallback;
        }

        int64_t json_int64(const rapidjson::Value& value, const char* key)
        {
            if (value.IsObject() && value.HasMember(key) && value[key].IsNumber())
            {
                return static_cast<int64_t>(value[key].GetDouble());
            }
            return 0;
        }

        rapidjson::Document ts_document()
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            return body;
        }

        // Both a 200 body and a 429 body name the reason; the launcher must read it before
        // classifying, or a throttle would trigger the Discord fallback it exists to prevent.
        inbox_client::outcome classify_send(const std::optional<utils::http::result>& result)
        {
            if (!result || result->code != CURLE_OK)
            {
                return inbox_client::outcome::failed;
            }

            rapidjson::Document body{};
            body.Parse(result->buffer.data());
            const auto reason = !body.HasParseError() && body.IsObject() ? json_get(body, "reason") : std::string{};

            if (result->response_code == 429)
            {
                return reason == "throttled" ? inbox_client::outcome::throttled : inbox_client::outcome::failed;
            }
            if (result->response_code == 403)
            {
                return inbox_client::outcome::blocked;
            }
            if (result->response_code < 200 || result->response_code >= 300)
            {
                return inbox_client::outcome::failed;
            }

            if (reason == "delivered") return inbox_client::outcome::delivered;
            if (reason == "offline") return inbox_client::outcome::offline;
            if (reason == "throttled") return inbox_client::outcome::throttled;
            return inbox_client::outcome::failed;
        }
    }

    struct inbox_state
    {
        std::string base_url{signed_http::base_url()};
        std::mutex mutex{};
        std::condition_variable cv{};
        std::string discord_token{}; // Discord bearer, presented at attach to bind the Discord address
        inbox_client::message_callback cb_handler{};
        inbox_client::message_callback discord_handler{};
        int64_t after{0}; // cursor acked on the next poll
        std::atomic<bool> running{false};
        std::atomic<bool> attached{false};           // the server holds our bindings
        std::atomic<bool> reattach_requested{false}; // a binding changed; cut the hold and attach again
        std::atomic<bool> relay_enabled{false};      // server kill switch for the Discord path
        std::atomic<bool> discord_bound{false};
        std::atomic<bool> connected{false}; // last round trip succeeded
        std::atomic<bool> alive{true};      // false once the owner is going away; gates detached senders
    };

    namespace
    {
        using state_ptr = std::shared_ptr<inbox_state>;

        void wait_interruptible(const state_ptr& s, const std::chrono::milliseconds delay)
        {
            std::unique_lock lock(s->mutex);
            s->cv.wait_for(lock, delay, [&s] { return !s->running || s->reattach_requested; });
        }

        std::chrono::milliseconds next_backoff(std::chrono::milliseconds& backoff)
        {
            static thread_local std::mt19937 rng{std::random_device{}()};
            std::uniform_real_distribution<double> unit(0.0, 1.0);

            const auto delay = backoff.count() * (0.5 + unit(rng)) + unit(rng) * JITTER_MAX_MS;
            backoff = std::min<std::chrono::milliseconds>(backoff * 2, BACKOFF_MAX);
            return std::chrono::milliseconds(static_cast<int64_t>(delay));
        }

        size_t write_callback(void* contents, const size_t size, const size_t nmemb, void* userp)
        {
            const auto total = size * nmemb;
            static_cast<std::string*>(userp)->append(static_cast<char*>(contents), total);
            return total;
        }

        struct request
        {
            CURLcode code{CURLE_FAILED_INIT};
            long http_code{0};
            std::string body{};
        };

        struct abort_context
        {
            inbox_state* state;
            bool on_reattach;
        };

        // One reused easy handle keeps the connection (and TLS session) across holds, so a
        // launcher costs one handshake per session rather than one every 25 seconds.
        request perform(CURL* curl, const state_ptr& s, const char* path, const std::string& body,
                        const int timeout, const bool abort_on_reattach)
        {
            request out{};
            const auto headers = signed_http::sign_headers(body);
            if (!headers)
            {
                return out;
            }

            curl_slist* list = nullptr;
            for (const auto& [key, value] : *headers)
            {
                list = curl_slist_append(list, (key + ": " + value).data());
            }

            const auto url = s->base_url + path;
            abort_context ctx{s.get(), abort_on_reattach};

            curl_easy_reset(curl);
            curl_easy_setopt(curl, CURLOPT_URL, url.data());
            curl_easy_setopt(curl, CURLOPT_HTTPHEADER, list);
            curl_easy_setopt(curl, CURLOPT_POST, 1L);
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data());
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
            curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
            curl_easy_setopt(curl, CURLOPT_WRITEDATA, &out.body);
            curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(timeout));
            curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, CONNECT_TIMEOUT_SECONDS);
            curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
            curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L);
            curl_easy_setopt(curl, CURLOPT_XFERINFODATA, &ctx);
            // Cuts a held poll short on stop() and, for the poll only, on a binding change.
            curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION,
                             +[](void* clientp, curl_off_t, curl_off_t, curl_off_t, curl_off_t) -> int
                             {
                                 const auto* c = static_cast<abort_context*>(clientp);
                                 if (!c->state->running) return 1;
                                 return c->on_reattach && c->state->reattach_requested ? 1 : 0;
                             });

            out.code = curl_easy_perform(curl);
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &out.http_code);
            curl_slist_free_all(list);
            return out;
        }

        bool attach(CURL* curl, const state_ptr& s)
        {
            std::string token;
            {
                std::lock_guard lock(s->mutex);
                token = s->discord_token;
            }

            auto body = ts_document();
            if (!token.empty()) add_string(body, "discordToken", token);

            const auto result = perform(curl, s, "/v1/inbox/attach", serialize(body), SEND_TIMEOUT_SECONDS, false);
            if (result.code != CURLE_OK || result.http_code != 200)
            {
                utils::logger::write("[cbl-relay] attach failed (code {}, http {})",
                                     static_cast<int>(result.code), result.http_code);
                return false;
            }

            rapidjson::Document doc{};
            doc.Parse(result.body.data());
            if (doc.HasParseError() || !doc.IsObject())
            {
                return false;
            }

            const auto cb_id = json_get(doc, "cbId");
            const auto discord_id = json_get(doc, "discordId");
            s->discord_bound = !discord_id.empty();
            s->relay_enabled = json_bool(doc, "relayEnabled", false);
            s->attached = true;
            s->connected = true;

            if (json_bool(doc, "discordError", false))
            {
                utils::logger::write("[cbl-relay] discord token rejected; Discord invites stay on the SDK until it refreshes");
            }
            utils::logger::write("[cbl-relay] attached (cb {}, discord {}, relayEnabled {})",
                                 cb_id.empty() ? "no" : "yes", discord_id.empty() ? "no" : "yes",
                                 s->relay_enabled.load());
            return true;
        }

        inbox_client::message parse_message(const rapidjson::Value& entry)
        {
            inbox_client::message message{};
            message.id = json_get(entry, "id");
            message.sender = json_get(entry, "from");
            message.source = json_get(entry, "source");
            message.kind = json_get(entry, "kind");
            message.game_id = json_get(entry, "game");
            message.match_id = json_get(entry, "matchId");
            message.join_secret = json_get(entry, "joinSecret");
            message.reply_to = json_get(entry, "replyTo");
            message.is_approval = json_bool(entry, "isApproval", false);
            message.accept = json_bool(entry, "accept", true);
            return message;
        }

        void dispatch(const state_ptr& s, const rapidjson::Document& doc)
        {
            const auto it = doc.FindMember("messages");
            if (it == doc.MemberEnd() || !it->value.IsArray())
            {
                return;
            }

            inbox_client::message_callback cb_handler, discord_handler;
            {
                std::lock_guard lock(s->mutex);
                cb_handler = s->cb_handler;
                discord_handler = s->discord_handler;
            }

            for (const auto& entry : it->value.GetArray())
            {
                if (!entry.IsObject()) continue;
                const auto message = parse_message(entry);
                if (message.sender.empty()) continue;

                const auto& handler = message.source == "discord" ? discord_handler : cb_handler;
                if (handler) handler(message);
            }
        }

        void run_loop(const state_ptr& s)
        {
            auto* curl = curl_easy_init();
            if (!curl)
            {
                utils::logger::write("[cbl-relay] curl_easy_init failed; inbox disabled");
                s->connected = false;
                return;
            }

            auto backoff = std::chrono::duration_cast<std::chrono::milliseconds>(BACKOFF_INITIAL);

            while (s->running)
            {
                if (!s->attached || s->reattach_requested)
                {
                    s->reattach_requested = false;
                    if (!attach(curl, s))
                    {
                        s->connected = false;
                        wait_interruptible(s, next_backoff(backoff));
                        continue;
                    }
                }

                auto body = ts_document();
                body.AddMember("after", s->after, body.GetAllocator());
                body.AddMember("hold", true, body.GetAllocator());

                const auto result = perform(curl, s, "/v1/inbox/poll", serialize(body), POLL_TIMEOUT_SECONDS, true);

                if (!s->running) break;
                if (s->reattach_requested) continue; // cut short on purpose

                if (result.code != CURLE_OK)
                {
                    utils::logger::write("[cbl-relay] poll failed (code {})", static_cast<int>(result.code));
                    s->connected = false;
                    wait_interruptible(s, next_backoff(backoff));
                    continue;
                }

                if (result.http_code != 200)
                {
                    utils::logger::write("[cbl-relay] poll http {}", result.http_code);
                    s->connected = false;
                    wait_interruptible(s, next_backoff(backoff));
                    continue;
                }

                rapidjson::Document doc{};
                doc.Parse(result.body.data());
                if (doc.HasParseError() || !doc.IsObject())
                {
                    s->connected = false;
                    wait_interruptible(s, next_backoff(backoff));
                    continue;
                }

                backoff = std::chrono::duration_cast<std::chrono::milliseconds>(BACKOFF_INITIAL);
                s->connected = true;
                s->after = json_int64(doc, "cursor");
                // The server lost our inbox (restart); the next pass attaches again before polling.
                s->attached = json_bool(doc, "attached", false);
                dispatch(s, doc);
            }

            curl_easy_cleanup(curl);
        }

        void post_send(const state_ptr& s, const std::string& body, inbox_client::outcome_callback on_result)
        {
            std::thread([s, body, on_result = std::move(on_result)]
            {
                const auto result = signed_http::post_signed(s->base_url + "/v1/invite/send", body, SEND_TIMEOUT_SECONDS);
                const auto out = classify_send(result);
                if (s->alive && on_result)
                {
                    on_result(out);
                }
            }).detach();
        }
    }

    inbox_client& inbox_client::instance()
    {
        static inbox_client client;
        return client;
    }

    inbox_client::inbox_client()
        : state_(std::make_shared<inbox_state>())
    {
    }

    inbox_client::~inbox_client()
    {
        this->state_->alive = false;
        this->stop();
    }

    void inbox_client::set_cb_handler(message_callback callback)
    {
        std::lock_guard lock(this->state_->mutex);
        this->state_->cb_handler = std::move(callback);
    }

    void inbox_client::set_discord_handler(message_callback callback)
    {
        std::lock_guard lock(this->state_->mutex);
        this->state_->discord_handler = std::move(callback);
    }

    void inbox_client::start()
    {
        {
            std::lock_guard lock(this->state_->mutex);
            if (this->state_->running)
            {
                return;
            }

            // A linked launcher binds its Discord address before the SDK finishes connecting; an
            // expired token only defers that until on_ready refreshes it.
            if (this->state_->discord_token.empty())
            {
                if (const auto tokens = discord::token_store::load())
                {
                    this->state_->discord_token = tokens->access_token;
                }
            }

            this->state_->attached = false;
            this->state_->running = true;
        }

        if (this->thread_.joinable())
        {
            this->thread_.join();
        }

        this->thread_ = std::thread([s = this->state_] { run_loop(s); });
    }

    void inbox_client::stop()
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
    }

    void inbox_client::attach_discord(const std::string& access_token)
    {
        {
            std::lock_guard lock(this->state_->mutex);
            if (this->state_->discord_token == access_token && this->state_->discord_bound)
            {
                return;
            }
            this->state_->discord_token = access_token;
        }
        this->reattach();
    }

    void inbox_client::detach_discord()
    {
        {
            std::lock_guard lock(this->state_->mutex);
            this->state_->discord_token.clear();
        }
        this->state_->discord_bound = false;
        this->reattach();
    }

    void inbox_client::reattach()
    {
        std::lock_guard lock(this->state_->mutex);
        this->state_->reattach_requested = true;
        this->state_->cv.notify_all();
    }

    bool inbox_client::connected() const
    {
        return this->state_->connected && this->state_->attached;
    }

    bool inbox_client::discord_enabled() const
    {
        return this->connected() && this->state_->relay_enabled && this->state_->discord_bound;
    }

    void inbox_client::send_async(const std::string& to, const std::string& kind, const std::string& game,
                                  const std::string& match_id, const std::string& join_secret,
                                  outcome_callback on_result)
    {
        auto body = ts_document();
        add_string(body, "to", to);
        add_string(body, "kind", kind);
        if (!game.empty()) add_string(body, "game", game);
        if (!match_id.empty()) add_string(body, "matchId", match_id);
        if (!join_secret.empty()) add_string(body, "joinSecret", join_secret);

        post_send(this->state_, serialize(body), std::move(on_result));
    }

    void inbox_client::reply_async(const std::string& to, const std::string& reply_to, const bool accept,
                                   const std::string& game, const std::string& match_id,
                                   const std::string& join_secret, outcome_callback on_result)
    {
        auto body = ts_document();
        add_string(body, "to", to);
        add_string(body, "kind", std::string{"invite"});
        body.AddMember("isApproval", true, body.GetAllocator());
        body.AddMember("accept", accept, body.GetAllocator());
        add_string(body, "replyTo", reply_to);
        if (!game.empty()) add_string(body, "game", game);
        if (!match_id.empty()) add_string(body, "matchId", match_id);
        if (accept && !join_secret.empty()) add_string(body, "joinSecret", join_secret);

        post_send(this->state_, serialize(body), std::move(on_result));
    }
}
