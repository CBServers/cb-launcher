#include "std_include.hpp"
#include "cbfriends_service.hpp"
#include "identity.hpp"
#include "hwid.hpp"
#include "social_constants.hpp"

#include "discord/token_store.hpp"

#include <utils/cryptography.hpp>
#include <utils/flags.hpp>
#include <utils/http.hpp>
#include <utils/logger.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

#include <rapidjson/writer.h>

#include <chrono>
#include <cstdlib>
#include <ctime>
#include <thread>

namespace social
{
    namespace
    {
        constexpr int CHAT_HOLD_TIMEOUT_SECONDS = 40; // the room holds a poll for ~25s

        std::string json_get(const rapidjson::Value& value, const char* key)
        {
            if (value.IsObject() && value.HasMember(key) && value[key].IsString())
            {
                return value[key].GetString();
            }
            return {};
        }

        void add_string(rapidjson::Document& doc, const char* key, const std::string& value)
        {
            rapidjson::Value v;
            v.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), doc.GetAllocator());
            doc.AddMember(rapidjson::StringRef(key), v, doc.GetAllocator());
        }

        std::string serialize(const rapidjson::Document& doc)
        {
            rapidjson::StringBuffer buffer;
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            doc.Accept(writer);
            return std::string(buffer.GetString(), buffer.GetSize());
        }

        // Signs the exact bytes sent; the worker verifies over the same string.
        std::optional<utils::http::result> post_signed(const std::string& url, const std::string& body,
                                                       int timeout = 30,
                                                       std::function<bool(size_t, size_t, size_t)> abort = {})
        {
            auto& id = identity::instance();
            const auto key_b64 = utils::cryptography::base64::encode(id.public_key());
            const auto sig_b64 = id.sign(body);
            if (key_b64.empty() || sig_b64.empty())
            {
                return std::nullopt;
            }

            const utils::http::headers headers = {
                {"Content-Type", "application/json"},
                {"X-CB-Key", key_b64},
                {"X-CB-Sig", sig_b64},
            };

            return utils::http::get_data(url, body, headers, std::move(abort), timeout, 1);
        }

        std::string discord_access_token()
        {
            const auto tokens = discord::token_store::load();
            return tokens ? tokens->access_token : std::string{};
        }

        // POSTs a signed body, returning the parsed 200 response or nullopt.
        std::optional<rapidjson::Document> post_json(const std::string& url, const std::string& body,
                                                     int timeout = 30,
                                                     std::function<bool(size_t, size_t, size_t)> abort = {})
        {
            const auto resp = post_signed(url, body, timeout, std::move(abort));
            if (!resp)
            {
                return std::nullopt;
            }

            rapidjson::Document doc;
            doc.Parse(resp->buffer.c_str());
            if (resp->response_code != 200 || doc.HasParseError() || !doc.IsObject())
            {
                return std::nullopt;
            }
            return doc;
        }

        cb_person parse_person(const rapidjson::Value& v)
        {
            cb_person p;
            p.cb_id = json_get(v, "cbId");
            p.handle = json_get(v, "handle");
            p.display_name = json_get(v, "displayName");
            p.avatar_url = json_get(v, "avatarUrl");
            p.online = v.IsObject() && v.HasMember("online") && v["online"].IsBool() && v["online"].GetBool();
            p.game = json_get(v, "game");
            p.mode = json_get(v, "mode");
            p.status = json_get(v, "status");
            p.bio = json_get(v, "bio");
            p.accent = json_get(v, "accent");
            p.favorite_game = json_get(v, "favoriteGame");
            p.created_at = (v.IsObject() && v.HasMember("createdAt") && v["createdAt"].IsInt64())
                ? v["createdAt"].GetInt64() : 0;
            p.last_seen = (v.IsObject() && v.HasMember("lastSeen") && v["lastSeen"].IsInt64())
                ? v["lastSeen"].GetInt64() : 0;
            // Member iterators, not GetObject(): that name collides with the wingdi macro.
            if (v.IsObject() && v.HasMember("playtime") && v["playtime"].IsObject())
            {
                const auto& played = v["playtime"];
                for (auto it = played.MemberBegin(); it != played.MemberEnd(); ++it)
                {
                    if (it->value.IsInt64())
                    {
                        p.playtime.emplace_back(it->name.GetString(), it->value.GetInt64());
                    }
                }
            }
            p.relation = json_get(v, "relation");
            p.note = json_get(v, "note");
            p.slots = (v.IsObject() && v.HasMember("slots") && v["slots"].IsInt()) ? v["slots"].GetInt() : 0;
            p.joined = (v.IsObject() && v.HasMember("joined") && v["joined"].IsInt()) ? v["joined"].GetInt() : 0;
            p.i_joined = v.IsObject() && v.HasMember("iJoined") && v["iJoined"].IsBool() && v["iJoined"].GetBool();
            if (v.IsObject() && v.HasMember("joiners") && v["joiners"].IsArray())
            {
                for (const auto& j : v["joiners"].GetArray())
                {
                    if (!j.IsObject()) continue;
                    p.joiners.push_back({ json_get(j, "cbId"), json_get(j, "handle"),
                                          json_get(j, "displayName"), json_get(j, "avatarUrl"),
                                          json_get(j, "accent") });
                }
            }
            p.joinable = v.IsObject() && v.HasMember("joinable") && v["joinable"].IsBool() && v["joinable"].GetBool();
            p.direct_join = v.IsObject() && v.HasMember("directJoin") && v["directJoin"].IsBool() && v["directJoin"].GetBool();
            p.openable = v.IsObject() && v.HasMember("openable") && v["openable"].IsBool() && v["openable"].GetBool();
            p.match_id = json_get(v, "matchId");
            return p;
        }

        std::vector<cb_person> parse_people(const rapidjson::Value& arr)
        {
            std::vector<cb_person> out;
            if (arr.IsArray())
            {
                for (const auto& e : arr.GetArray())
                {
                    out.push_back(parse_person(e));
                }
            }
            return out;
        }

        std::string ts_body()
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            return serialize(body);
        }

        std::string cbid_body(const std::string& cb_id)
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            add_string(body, "cbId", cb_id);
            return serialize(body);
        }
    }

    std::string profile_state_to_string(const profile_state state)
    {
        switch (state)
        {
        case profile_state::none:
            return "none";
        case profile_state::creating:
            return "creating";
        case profile_state::ready:
            return "ready";
        default:
            return "error";
        }
    }

    cbfriends_service& cbfriends_service::instance()
    {
        static cbfriends_service instance;
        return instance;
    }

    std::string cbfriends_service::base_url() const
    {
        std::string url = utils::flags::get_flag_value("cbfriends-url").value_or(CBFRIENDS_URL);
        while (!url.empty() && url.back() == '/')
        {
            url.pop_back();
        }
        return url;
    }

    void cbfriends_service::start()
    {
        std::string account_id;
        std::optional<std::string> profile_json;
        {
            const auto guard = utils::properties::lock();
            account_id = utils::properties::load(property_keys::CB_ACCOUNT_ID).value_or("");
            profile_json = utils::properties::load(property_keys::CB_PROFILE);
        }

        if (account_id.empty() || !profile_json || profile_json->empty())
        {
            return;
        }

        // The worker needs the keypair loaded to sign this session's requests.
        identity::instance().ensure();

        rapidjson::Document doc;
        doc.Parse(profile_json->c_str());
        if (doc.HasParseError() || !doc.IsObject())
        {
            return;
        }

        cb_profile profile;
        profile.cb_id = account_id;
        profile.handle = json_get(doc, "handle");
        profile.display_name = json_get(doc, "displayName");
        profile.avatar_url = json_get(doc, "avatarUrl");
        profile.bio = json_get(doc, "bio");
        profile.accent = json_get(doc, "accent");
        profile.favorite_game = json_get(doc, "favoriteGame");

        {
            std::lock_guard lock(mutex_);
            profile_ = std::move(profile);
            state_ = profile_state::ready;
        }
        ensure_worker();
        load_broadcast();
        sync_discord(); // keeps the avatar in step with Discord
    }

    profile_state cbfriends_service::get_state() const
    {
        std::lock_guard lock(mutex_);
        return state_;
    }

    std::optional<cb_profile> cbfriends_service::get_profile() const
    {
        std::lock_guard lock(mutex_);
        return profile_;
    }

    std::string cbfriends_service::get_last_error() const
    {
        std::lock_guard lock(mutex_);
        return last_error_;
    }

    bool cbfriends_service::has_recovery_code() const
    {
        const auto guard = utils::properties::lock();
        const auto stored = utils::properties::load(property_keys::CB_RECOVERY_CODE);
        return stored && !stored->empty();
    }

    std::string cbfriends_service::get_recovery_code() const
    {
        std::optional<std::string> stored;
        {
            const auto guard = utils::properties::lock();
            stored = utils::properties::load(property_keys::CB_RECOVERY_CODE);
        }
        if (!stored || stored->empty())
        {
            return {};
        }

        const auto blob = utils::cryptography::base64::decode(*stored);
        if (blob.empty())
        {
            return {};
        }

        return utils::cryptography::dpapi::unprotect(blob).value_or("");
    }

    void cbfriends_service::begin_create_profile(const std::string& handle, const std::string& display_name)
    {
        {
            std::lock_guard lock(mutex_);
            if (state_ == profile_state::creating || state_ == profile_state::ready)
            {
                return;
            }
            state_ = profile_state::creating;
            last_error_.clear();
        }

        std::thread(&cbfriends_service::do_create_profile, this, handle, display_name).detach();
    }

    void cbfriends_service::do_create_profile(std::string handle, std::string display_name)
    {
        const auto fail = [this](const std::string& error)
        {
            std::lock_guard lock(mutex_);
            state_ = profile_state::error;
            last_error_ = error;
        };

        auto& id = identity::instance();
        if (!id.ensure())
        {
            return fail("identity unavailable");
        }

        const auto hwid = hwid::compute();
        const auto token = discord_access_token();
        const auto base = base_url();

        // Seeded from the linked Discord account when there is one.
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "hwidHash", hwid);
        if (!handle.empty()) add_string(body, "handle", handle);
        if (!display_name.empty()) add_string(body, "displayName", display_name);
        if (!token.empty()) add_string(body, "discordToken", token);

        const auto response = post_signed(base + "/v1/account/bootstrap", serialize(body));
        if (!response)
        {
            return fail("network error");
        }

        rapidjson::Document doc;
        doc.Parse(response->buffer.c_str());
        const bool parsed = !doc.HasParseError() && doc.IsObject();

        if (response->response_code == 200 && parsed)
        {
            return store_from_response(doc);
        }

        // This machine already owns an account: adopt it instead of minting a duplicate.
        if (response->response_code == 409 && parsed && doc.HasMember("recoverable") &&
            doc["recoverable"].IsBool() && doc["recoverable"].GetBool())
        {
            std::string via;
            if (doc.HasMember("via") && doc["via"].IsArray())
            {
                for (const auto& entry : doc["via"].GetArray())
                {
                    if (entry.IsString() && via.empty()) via = entry.GetString();
                }
            }
            return recover_and_store(via, hwid, token);
        }

        const auto error = parsed ? json_get(doc, "error") : std::string{"request failed"};
        return fail(error.empty() ? "profile creation failed" : error);
    }

    void cbfriends_service::recover_and_store(const std::string& via, const std::string& hwid,
                                              const std::string& token)
    {
        const auto fail = [this](const std::string& error)
        {
            std::lock_guard lock(mutex_);
            state_ = profile_state::error;
            last_error_ = error;
        };

        const auto base = base_url();
        std::string endpoint;
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());

        if (via == "discord" && !token.empty())
        {
            endpoint = "/v1/recover/discord";
            add_string(body, "discordToken", token);
        }
        else
        {
            endpoint = "/v1/recover/hwid";
            add_string(body, "hwidHash", hwid);
        }

        const auto response = post_signed(base + endpoint, serialize(body));
        if (!response)
        {
            return fail("network error");
        }

        rapidjson::Document doc;
        doc.Parse(response->buffer.c_str());
        if (response->response_code != 200 || doc.HasParseError() || !doc.IsObject())
        {
            const auto error = (!doc.HasParseError() && doc.IsObject()) ? json_get(doc, "error") : std::string{};
            return fail(error.empty() ? "recovery failed" : error);
        }

        store_from_response(doc);
    }

    void cbfriends_service::store_from_response(const rapidjson::Value& doc)
    {
        cb_profile profile;
        profile.cb_id = json_get(doc, "cbId");
        if (doc.HasMember("profile") && doc["profile"].IsObject())
        {
            const auto& p = doc["profile"];
            profile.handle = json_get(p, "handle");
            profile.display_name = json_get(p, "displayName");
            profile.avatar_url = json_get(p, "avatarUrl");
            profile.bio = json_get(p, "bio");
            profile.accent = json_get(p, "accent");
            profile.favorite_game = json_get(p, "favoriteGame");
        }

        if (profile.cb_id.empty())
        {
            std::lock_guard lock(mutex_);
            state_ = profile_state::error;
            last_error_ = "malformed response";
            return;
        }

        // Cache the profile for offline status; the recovery code is returned only once.
        rapidjson::Document profile_doc;
        profile_doc.SetObject();
        add_string(profile_doc, "handle", profile.handle);
        add_string(profile_doc, "displayName", profile.display_name);
        add_string(profile_doc, "avatarUrl", profile.avatar_url);
        add_string(profile_doc, "bio", profile.bio);
        add_string(profile_doc, "accent", profile.accent);
        add_string(profile_doc, "favoriteGame", profile.favorite_game);

        const auto recovery_code = json_get(doc, "recoveryCode");

        {
            const auto guard = utils::properties::lock();
            utils::properties::store(property_keys::CB_ACCOUNT_ID, profile.cb_id);
            utils::properties::store(property_keys::CB_PROFILE, serialize(profile_doc));
            if (!recovery_code.empty())
            {
                const auto blob = utils::cryptography::dpapi::protect(recovery_code);
                if (blob)
                {
                    utils::properties::store(property_keys::CB_RECOVERY_CODE,
                                             utils::cryptography::base64::encode(*blob));
                }
            }
        }

        {
            std::lock_guard lock(mutex_);
            profile_ = std::move(profile);
            state_ = profile_state::ready;
            last_error_.clear();
        }
        ensure_worker();
    }

    void cbfriends_service::begin_update_profile(const std::string& display_name, const std::string& handle,
                                                 const std::string& bio, const std::string& accent,
                                                 const std::string& favorite_game,
                                                 const std::string& avatar_url)
    {
        {
            std::lock_guard lock(mutex_);
            if (state_ != profile_state::ready)
            {
                return;
            }
            last_error_.clear();
        }
        std::thread(&cbfriends_service::do_update_profile, this, display_name, handle, bio, accent,
                    favorite_game, avatar_url).detach();
    }

    void cbfriends_service::do_update_profile(std::string display_name, std::string handle, std::string bio,
                                              std::string accent, std::string favorite_game,
                                              std::string avatar_url)
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        if (!display_name.empty()) add_string(body, "displayName", display_name);
        if (!handle.empty()) add_string(body, "handle", handle);
        // Bio and accent are sent even when blank so they can be cleared.
        add_string(body, "bio", bio);
        add_string(body, "accent", accent);
        add_string(body, "favoriteGame", favorite_game);
        add_string(body, "avatarUrl", avatar_url);

        const auto resp = post_signed(base_url() + "/v1/account/profile", serialize(body));
        if (!resp)
        {
            std::lock_guard lock(mutex_);
            last_error_ = "network error";
            return;
        }

        rapidjson::Document doc;
        doc.Parse(resp->buffer.c_str());
        if (resp->response_code == 200 && !doc.HasParseError() && doc.IsObject())
        {
            store_from_response(doc); // updates the cached profile + properties
            return;
        }

        const auto error = (!doc.HasParseError() && doc.IsObject()) ? json_get(doc, "error") : std::string{};
        std::lock_guard lock(mutex_);
        last_error_ = error.empty() ? "profile update failed" : error;
    }

    void cbfriends_service::ensure_worker()
    {
        bool expected = false;
        if (running_.compare_exchange_strong(expected, true))
        {
            worker_ = std::thread(&cbfriends_service::worker_loop, this);
        }
    }

    void cbfriends_service::stop()
    {
        {
            std::lock_guard lifecycle(chat_worker_mutex_);
            stop_chat_worker();
        }
        {
            std::lock_guard lifecycle(dm_worker_mutex_);
            stop_dm_worker();
        }
        running_ = false;
        if (worker_.joinable())
        {
            worker_.join();
        }
    }

    void cbfriends_service::worker_loop()
    {
        using namespace std::chrono_literals;
        while (running_)
        {
            if (get_state() == profile_state::ready)
            {
                const auto now = static_cast<int64_t>(std::time(nullptr));
                if (now - last_presence_.load() >= 30)
                {
                    last_presence_ = now;
                    send_presence();
                    if (broadcasting_)
                    {
                        send_broadcast_keepalive();
                    }
                }
                refresh_friends();
                poll_invites();
                // An incoming message on a 15s tick reads as arriving late, so this is on the
                // main tick; room chat heads only drive a dot, so they stay slower.
                refresh_dm_list();
                if (now - last_dm_.load() >= 15)
                {
                    last_dm_ = now;
                    refresh_chat_heads();
                }
                if (now - last_slow_.load() >= 60)
                {
                    last_slow_ = now;
                    refresh_blocked();
                    refresh_security();
                    refresh_mod_role();
                    refresh_played_with();
                    // Keeps the Community badge honest while its tab is closed.
                    if (!community_active_) refresh_lfg();
                }
                if (community_active_)
                {
                    refresh_lfg();
                }
                if (mod_active_)
                {
                    refresh_mod_queue();
                }
            }

            // Interruptible sleep so stop() returns promptly.
            for (int i = 0; i < 10 && running_; ++i)
            {
                std::this_thread::sleep_for(500ms);
            }
        }
    }

    void cbfriends_service::send_presence()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        std::string game, match;
        bool joinable, direct, openable;
        {
            std::lock_guard lock(mutex_);
            game = current_game_.empty() ? activity_game_ : current_game_;
            joinable = !activity_secret_.empty();
            direct = activity_direct_;
            openable = activity_openable_;
            match = activity_match_;
        }

        rapidjson::Document body;
        body.SetObject();
        auto& allocator = body.GetAllocator();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), allocator);
        if (!game.empty()) add_string(body, "game", game);
        // Flags only; the secret rides the invite mailbox.
        body.AddMember("joinable", joinable, allocator);
        body.AddMember("directJoin", direct, allocator);
        body.AddMember("openable", openable, allocator);
        if (!match.empty()) add_string(body, "matchId", match);
        post_signed(base_url() + "/v1/presence", serialize(body));
    }

    void cbfriends_service::set_activity(const std::string& game)
    {
        {
            std::lock_guard lock(mutex_);
            if (current_game_ == game)
            {
                return;
            }
            current_game_ = game;
        }
        std::thread(&cbfriends_service::send_presence, this).detach();
    }

    void cbfriends_service::set_friends_changed_callback(std::function<void()> callback)
    {
        std::lock_guard lock(mutex_);
        friends_changed_cb_ = std::move(callback);
    }

    void cbfriends_service::set_rich_activity(const std::string& game, const std::string& join_secret,
                                              const bool direct_join, const bool openable,
                                              const std::string& match_id)
    {
        {
            std::lock_guard lock(mutex_);
            activity_game_ = game;
            activity_secret_ = join_secret;
            activity_direct_ = direct_join;
            activity_openable_ = openable;
            activity_match_ = match_id;
        }
        std::thread(&cbfriends_service::send_presence, this).detach();
    }

    void cbfriends_service::clear_rich_activity()
    {
        {
            std::lock_guard lock(mutex_);
            activity_game_.clear();
            activity_secret_.clear();
            activity_direct_ = false;
            activity_openable_ = false;
            activity_match_.clear();
        }
        std::thread(&cbfriends_service::send_presence, this).detach();
    }

    bool cbfriends_service::is_joinable() const
    {
        std::lock_guard lock(mutex_);
        return !activity_secret_.empty();
    }

    bool cbfriends_service::is_same_match(const std::string& game, const std::string& match_id) const
    {
        std::lock_guard lock(mutex_);
        return !match_id.empty() && !activity_match_.empty() && match_id == activity_match_ &&
            game == activity_game_;
    }

    // Searches every list we already hold, so a notification never needs the UI to supply an avatar.
    std::optional<cb_person> cbfriends_service::find_person(const std::string& cb_id) const
    {
        std::lock_guard lock(mutex_);
        for (const auto* list : { &friends_.friends, &friends_.incoming, &friends_.outgoing, &lfg_ })
        {
            for (const auto& p : *list)
            {
                if (p.cb_id == cb_id) return p;
            }
        }
        for (const auto& c : dm_list_)
        {
            if (c.person.cb_id == cb_id) return c.person;
        }
        return std::nullopt;
    }

    std::optional<cb_person> cbfriends_service::find_friend(const std::string& cb_id) const
    {
        std::lock_guard lock(mutex_);
        for (const auto& f : friends_.friends)
        {
            if (f.cb_id == cb_id) return f;
        }
        return std::nullopt;
    }

    void cbfriends_service::send_invite(const std::string& cb_id)
    {
        std::string game, match, secret;
        {
            std::lock_guard lock(mutex_);
            game = activity_game_.empty() ? current_game_ : activity_game_;
            match = activity_match_;
            secret = activity_secret_;
        }
        if (secret.empty())
        {
            // Silent until now, which hid a fork publishing a transport the launcher couldn't read.
            utils::logger::write("[cbl-invite] -> drop invite to {}: no join secret for '{}'", cb_id, game);
            return;
        }

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "to", cb_id);
        add_string(body, "kind", std::string{"invite"});
        add_string(body, "game", game);
        if (!match.empty()) add_string(body, "matchId", match);
        add_string(body, "joinSecret", secret);
        utils::logger::write("[cbl-invite] -> invite {} ({})", cb_id, game);
        post_action("/v1/invite/send", serialize(body), {});
    }

    void cbfriends_service::request_join(const std::string& cb_id)
    {
        std::string game, match;
        if (const auto f = find_friend(cb_id))
        {
            game = f->game;
            match = f->match_id;
        }

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "to", cb_id);
        add_string(body, "kind", std::string{"join-request"});
        if (!game.empty()) add_string(body, "game", game);
        if (!match.empty()) add_string(body, "matchId", match);
        post_action("/v1/invite/send", serialize(body), {});
    }

    void cbfriends_service::send_reply(const std::string& to, const std::string& reply_to,
                                       const std::string& game, const std::string& match,
                                       const std::string& secret)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "to", to);
        add_string(body, "kind", std::string{"invite"});
        body.AddMember("isApproval", true, body.GetAllocator());
        add_string(body, "replyTo", reply_to);
        if (!game.empty()) add_string(body, "game", game);
        if (!match.empty()) add_string(body, "matchId", match);
        add_string(body, "joinSecret", secret);
        post_action("/v1/invite/send", serialize(body), {});
    }

    void cbfriends_service::poll_invites()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }
        auto doc = post_json(base_url() + "/v1/invite/poll", ts_body());
        if (!doc || !doc->HasMember("messages") || !(*doc)["messages"].IsArray())
        {
            return;
        }
        for (const auto& m : (*doc)["messages"].GetArray())
        {
            process_message(m);
        }
    }

    void cbfriends_service::process_message(const rapidjson::Value& message)
    {
        const auto id = json_get(message, "id");
        const auto sender = json_get(message, "sender");
        const auto kind = json_get(message, "kind");
        const auto game = json_get(message, "game");
        const auto match = json_get(message, "matchId");
        const auto secret = json_get(message, "joinSecret");
        const bool is_approval = message.IsObject() && message.HasMember("isApproval") &&
            message["isApproval"].IsBool() && message["isApproval"].GetBool();

        // A host approved our join request, so connect right away.
        if (is_approval)
        {
            std::function<void(std::string)> cb;
            {
                std::lock_guard lock(mutex_);
                cb = join_secret_cb_;
            }
            if (cb && !secret.empty()) cb(secret);
            return;
        }

        // A knock on a public server needs no approval, so reply with our secret.
        if (kind == "join-request")
        {
            std::string my_game, my_match, my_secret;
            bool direct;
            {
                std::lock_guard lock(mutex_);
                my_game = activity_game_.empty() ? current_game_ : activity_game_;
                my_match = activity_match_;
                my_secret = activity_secret_;
                direct = activity_direct_;
            }
            if (direct && !my_secret.empty())
            {
                send_reply(sender, id, my_game, my_match, my_secret);
                return;
            }
        }

        // Otherwise queue it for the user to answer.
        cb_person friend_info;
        if (const auto f = find_friend(sender)) friend_info = *f;

        cb_invite invite;
        invite.id = id;
        invite.sender_cb_id = sender;
        invite.sender_name = friend_info.display_name.empty() ? friend_info.handle : friend_info.display_name;
        invite.sender_avatar = friend_info.avatar_url;
        invite.game = game;
        invite.match_id = match;
        invite.is_request = (kind == "join-request");
        invite.is_approval = false;
        invite.join_secret = secret; // for a plain invite, the secret to connect with

        std::lock_guard lock(mutex_);
        invite.needs_open = invite.is_request && activity_openable_;
        for (const auto& existing : invites_)
        {
            if (existing.id == invite.id) return; // de-dupe
        }
        invites_.push_back(std::move(invite));
    }

    std::vector<cb_invite> cbfriends_service::get_invites() const
    {
        std::lock_guard lock(mutex_);
        return invites_;
    }

    void cbfriends_service::accept_invite(const std::string& id)
    {
        cb_invite invite;
        bool found = false;
        {
            std::lock_guard lock(mutex_);
            for (auto it = invites_.begin(); it != invites_.end(); ++it)
            {
                if (it->id == id)
                {
                    invite = *it;
                    invites_.erase(it);
                    found = true;
                    break;
                }
            }
        }
        if (!found) return;

        if (invite.is_request)
        {
            // Open our match if needed, then reply with our secret.
            std::function<void()> open_cb;
            std::string my_game, my_match, my_secret;
            {
                std::lock_guard lock(mutex_);
                open_cb = invite.needs_open ? open_match_cb_ : nullptr;
                my_game = activity_game_.empty() ? current_game_ : activity_game_;
                my_match = activity_match_;
                my_secret = activity_secret_;
            }
            if (open_cb) open_cb();
            if (!my_secret.empty())
            {
                send_reply(invite.sender_cb_id, invite.id, my_game, my_match, my_secret);
            }
        }
        else
        {
            std::function<void(std::string)> cb;
            {
                std::lock_guard lock(mutex_);
                cb = join_secret_cb_;
            }
            if (cb && !invite.join_secret.empty()) cb(invite.join_secret);
        }
    }

    void cbfriends_service::decline_invite(const std::string& id)
    {
        std::lock_guard lock(mutex_);
        for (auto it = invites_.begin(); it != invites_.end(); ++it)
        {
            if (it->id == id)
            {
                invites_.erase(it);
                return;
            }
        }
    }

    void cbfriends_service::set_join_secret_callback(std::function<void(std::string)> callback)
    {
        std::lock_guard lock(mutex_);
        join_secret_cb_ = std::move(callback);
    }

    void cbfriends_service::set_open_match_callback(std::function<void()> callback)
    {
        std::lock_guard lock(mutex_);
        open_match_cb_ = std::move(callback);
    }

    void cbfriends_service::refresh_friends()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        auto doc = post_json(base_url() + "/v1/friends/list", ts_body());
        if (!doc)
        {
            return;
        }

        friends_snapshot snap;
        if (doc->HasMember("friends")) snap.friends = parse_people((*doc)["friends"]);
        if (doc->HasMember("incoming")) snap.incoming = parse_people((*doc)["incoming"]);
        if (doc->HasMember("outgoing")) snap.outgoing = parse_people((*doc)["outgoing"]);

        // Flag friends already in our match, where inviting is a no-op.
        std::string my_game, my_match;
        {
            std::lock_guard lock(mutex_);
            my_game = activity_game_;
            my_match = activity_match_;
        }
        for (auto& f : snap.friends)
        {
            f.same_match = !my_match.empty() && !f.match_id.empty() && f.match_id == my_match && f.game == my_game;
        }

        std::function<void()> notify;
        {
            std::lock_guard lock(mutex_);
            friends_ = std::move(snap);
            notify = friends_changed_cb_;
        }
        // Re-push to a connected fork; the IPC layer dedupes unchanged snapshots.
        if (notify)
        {
            notify();
        }
    }

    void cbfriends_service::refresh_lfg()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        std::string game;
        {
            std::lock_guard lock(mutex_);
            game = lfg_filter_game_;
        }

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        if (!game.empty()) add_string(body, "game", game);

        auto doc = post_json(base_url() + "/v1/lfg/list", serialize(body));
        if (!doc)
        {
            return;
        }

        std::vector<cb_person> posts;
        if (doc->HasMember("posts")) posts = parse_people((*doc)["posts"]);

        std::lock_guard lock(mutex_);
        lfg_ = std::move(posts);
    }

    void cbfriends_service::post_action(std::string endpoint, std::string body, std::function<void()> after)
    {
        const auto url = base_url() + endpoint;
        std::thread([url, body = std::move(body), after = std::move(after)]
        {
            post_signed(url, body);
            if (after) after();
        }).detach();
    }

    friends_snapshot cbfriends_service::get_friends() const
    {
        std::lock_guard lock(mutex_);
        return friends_;
    }

    void cbfriends_service::add_friend(const std::string& handle)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "handle", handle);
        post_action("/v1/friends/add", serialize(body), [this] { refresh_friends(); });
    }

    void cbfriends_service::accept_friend(const std::string& cb_id)
    {
        post_action("/v1/friends/accept", cbid_body(cb_id), [this] { refresh_friends(); });
    }

    void cbfriends_service::decline_friend(const std::string& cb_id)
    {
        post_action("/v1/friends/decline", cbid_body(cb_id), [this] { refresh_friends(); });
    }

    void cbfriends_service::cancel_request(const std::string& cb_id)
    {
        post_action("/v1/friends/cancel", cbid_body(cb_id), [this] { refresh_friends(); });
    }

    void cbfriends_service::remove_friend(const std::string& cb_id)
    {
        post_action("/v1/friends/remove", cbid_body(cb_id), [this] { refresh_friends(); });
    }

    void cbfriends_service::set_community_active(const bool active)
    {
        community_active_ = active;
        if (active && get_state() == profile_state::ready)
        {
            std::thread(&cbfriends_service::refresh_lfg, this).detach();
        }
    }

    std::vector<cb_person> cbfriends_service::get_lfg() const
    {
        std::lock_guard lock(mutex_);
        return lfg_;
    }

    void cbfriends_service::set_lfg_filter(const std::string& game)
    {
        {
            std::lock_guard lock(mutex_);
            lfg_filter_game_ = game;
        }
        if (get_state() == profile_state::ready)
        {
            std::thread(&cbfriends_service::refresh_lfg, this).detach();
        }
    }

    void cbfriends_service::post_lfg(const std::string& game, const std::string& mode, const std::string& note,
                                     const int slots)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "game", game);
        if (!mode.empty()) add_string(body, "mode", mode);
        if (!note.empty()) add_string(body, "note", note);
        if (slots > 0) body.AddMember("slots", slots, body.GetAllocator());
        post_action("/v1/lfg/post", serialize(body), [this] { refresh_lfg(); });
    }

    void cbfriends_service::clear_lfg()
    {
        post_action("/v1/lfg/clear", ts_body(), [this] { refresh_lfg(); });
    }

    void cbfriends_service::lfg_join(const std::string& poster_cb_id)
    {
        post_action("/v1/lfg/join", cbid_body(poster_cb_id), [this]
        {
            refresh_lfg();
            refresh_friends();
        });
    }

    void cbfriends_service::sync_discord()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        const auto token = discord_access_token();
        if (token.empty())
        {
            return;
        }

        std::thread([this, token]
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            add_string(body, "discordToken", token);

            if (auto doc = post_json(base_url() + "/v1/account/sync-discord", serialize(body)))
            {
                store_from_response(*doc);
            }
        }).detach();
    }

    void cbfriends_service::request_profile(const std::string& cb_id)
    {
        {
            std::lock_guard lock(mutex_);
            viewed_profile_.reset();
        }
        if (!cb_id.empty() && get_state() == profile_state::ready)
        {
            std::thread(&cbfriends_service::do_request_profile, this, cb_id).detach();
        }
    }

    void cbfriends_service::do_request_profile(std::string cb_id)
    {
        auto doc = post_json(base_url() + "/v1/profile/get", cbid_body(cb_id));
        if (!doc)
        {
            return;
        }

        auto person = parse_person(*doc);
        std::lock_guard lock(mutex_);
        viewed_profile_ = std::move(person);
    }

    std::optional<cb_person> cbfriends_service::get_viewed_profile() const
    {
        std::lock_guard lock(mutex_);
        return viewed_profile_;
    }

    void cbfriends_service::set_chat_room(const std::string& room)
    {
        {
            std::lock_guard lock(mutex_);
            if (chat_room_ == room)
            {
                return;
            }
            chat_room_ = room;
            chat_.clear();
            chat_after_ = 0;
            chat_oldest_ = 0;
            chat_more_ = true;
        }

        // Stopping the old poll waits on a held request, and this runs on the UI thread, so the
        // swap is handed off; doing it here froze the UI on every room change.
        std::thread(&cbfriends_service::restart_chat_worker, this).detach();
    }

    void cbfriends_service::restart_chat_worker()
    {
        std::lock_guard lifecycle(chat_worker_mutex_);
        stop_chat_worker();

        std::string room;
        {
            std::lock_guard lock(mutex_);
            room = chat_room_;
        }
        if (room.empty() || !running_ || get_state() != profile_state::ready) return;

        // Unheld first, so a room's history is on screen as soon as the network allows.
        poll_chat(false);

        chat_running_ = true;
        chat_worker_ = std::thread(&cbfriends_service::chat_loop, this);
    }

    void cbfriends_service::stop_chat_worker()
    {
        chat_running_ = false;
        if (chat_worker_.joinable())
        {
            chat_worker_.join();
        }
    }

    // Holds a poll open on its own thread, so a message lands the moment it is sent.
    void cbfriends_service::chat_loop()
    {
        using namespace std::chrono_literals;
        while (chat_running_)
        {
            poll_chat(true);

            // Only reached when the hold expired or the request failed; a short rest bounds retries.
            for (int i = 0; i < 4 && chat_running_; ++i)
            {
                std::this_thread::sleep_for(250ms);
            }
        }
    }

    std::vector<chat_message> cbfriends_service::get_chat() const
    {
        std::lock_guard lock(mutex_);
        return chat_;
    }

    void cbfriends_service::send_chat(const std::string& room, const std::string& text)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "room", room);
        add_string(body, "text", text);
        // The room wakes every held poll on delivery, including ours, so there is nothing to chase.
        post_action("/v1/chat/send", serialize(body), {});
    }

    void cbfriends_service::poll_chat(const bool hold)
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        std::string room;
        int64_t after;
        {
            std::lock_guard lock(mutex_);
            room = chat_room_;
            after = chat_after_;
        }
        if (room.empty())
        {
            return;
        }

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "room", room);
        body.AddMember("after", after, body.GetAllocator());
        if (hold) body.AddMember("hold", true, body.GetAllocator());

        // Read timeout outlives the server's hold; the abort drops it the moment the room closes.
        auto doc = hold
            ? post_json(base_url() + "/v1/chat/poll", serialize(body), CHAT_HOLD_TIMEOUT_SECONDS,
                        [this](size_t, size_t, size_t) { return chat_running_.load(); })
            : post_json(base_url() + "/v1/chat/poll", serialize(body));
        if (!doc || !doc->HasMember("messages") || !(*doc)["messages"].IsArray())
        {
            return;
        }

        std::lock_guard lock(mutex_);
        if (chat_room_ != room)
        {
            return; // the user switched rooms while the request was in flight
        }

        // Counts messages the server filtered out, so a room of blocked chatter can't spin us.
        if (doc->HasMember("cursor") && (*doc)["cursor"].IsInt64())
        {
            chat_after_ = (std::max)(chat_after_, (*doc)["cursor"].GetInt64());
        }
        for (const auto& m : (*doc)["messages"].GetArray())
        {
            chat_message message;
            message.id = (m.IsObject() && m.HasMember("id") && m["id"].IsInt64()) ? m["id"].GetInt64() : 0;
            message.at = (m.IsObject() && m.HasMember("at") && m["at"].IsInt64()) ? m["at"].GetInt64() : 0;
            message.cb_id = json_get(m, "cbId");
            message.handle = json_get(m, "handle");
            message.display_name = json_get(m, "displayName");
            message.accent = json_get(m, "accent");
            message.text = json_get(m, "text");
            chat_.push_back(std::move(message));
            chat_after_ = (std::max)(chat_after_, chat_.back().id);
            if (chat_oldest_ == 0) chat_oldest_ = chat_.front().id;
        }
        if (chat_.size() > 200)
        {
            chat_.erase(chat_.begin(), chat_.begin() + (chat_.size() - 200));
        }
    }

    void cbfriends_service::load_older_chat()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }

        std::string room;
        int64_t before;
        {
            std::lock_guard lock(mutex_);
            room = chat_room_;
            before = chat_oldest_;
            if (room.empty() || !chat_more_ || before <= 1) return;
        }

        std::thread([this, room, before]
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            add_string(body, "room", room);
            body.AddMember("before", before, body.GetAllocator());

            auto doc = post_json(base_url() + "/v1/chat/poll", serialize(body));
            if (!doc || !doc->HasMember("messages") || !(*doc)["messages"].IsArray()) return;

            std::vector<chat_message> older;
            for (const auto& m : (*doc)["messages"].GetArray())
            {
                chat_message msg;
                msg.id = (m.IsObject() && m.HasMember("id") && m["id"].IsInt64()) ? m["id"].GetInt64() : 0;
            msg.at = (m.IsObject() && m.HasMember("at") && m["at"].IsInt64()) ? m["at"].GetInt64() : 0;
                msg.cb_id = json_get(m, "cbId");
                msg.handle = json_get(m, "handle");
                msg.display_name = json_get(m, "displayName");
                msg.accent = json_get(m, "accent");
                msg.text = json_get(m, "text");
                older.push_back(std::move(msg));
            }

            std::lock_guard lock(mutex_);
            if (chat_room_ != room) return;
            if (older.empty())
            {
                chat_more_ = false;
                return;
            }
            chat_oldest_ = older.front().id;
            chat_.insert(chat_.begin(), older.begin(), older.end());
        }).detach();
    }

    bool cbfriends_service::has_more_chat() const
    {
        std::lock_guard lock(mutex_);
        return chat_more_ && chat_oldest_ > 1;
    }

    void cbfriends_service::block_user(const std::string& cb_id)
    {
        post_action("/v1/block/add", cbid_body(cb_id), [this]
        {
            refresh_blocked();
            refresh_friends();
        });
    }

    void cbfriends_service::unblock_user(const std::string& cb_id)
    {
        post_action("/v1/block/remove", cbid_body(cb_id), [this] { refresh_blocked(); });
    }

    std::vector<cb_person> cbfriends_service::get_blocked() const
    {
        std::lock_guard lock(mutex_);
        return blocked_;
    }

    void cbfriends_service::report_user(const std::string& cb_id, const std::string& reason)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "cbId", cb_id);
        add_string(body, "reason", reason);
        post_action("/v1/report", serialize(body), {});
    }

    void cbfriends_service::refresh_blocked()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/block/list", ts_body());
        if (!doc || !doc->HasMember("blocked")) return;

        auto people = parse_people((*doc)["blocked"]);
        std::lock_guard lock(mutex_);
        blocked_ = std::move(people);
    }

    std::vector<security_event> cbfriends_service::get_security_events() const
    {
        std::lock_guard lock(mutex_);
        return security_;
    }

    std::vector<std::pair<std::string, int64_t>> cbfriends_service::get_chat_heads() const
    {
        std::lock_guard lock(mutex_);
        return chat_heads_;
    }

    void cbfriends_service::refresh_chat_heads()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/chat/heads", ts_body());
        if (!doc || !doc->HasMember("rooms") || !(*doc)["rooms"].IsObject()) return;

        std::vector<std::pair<std::string, int64_t>> heads;
        const auto& rooms = (*doc)["rooms"];
        for (auto it = rooms.MemberBegin(); it != rooms.MemberEnd(); ++it)
        {
            if (it->value.IsObject() && it->value.HasMember("id") && it->value["id"].IsInt64())
            {
                heads.emplace_back(it->name.GetString(), it->value["id"].GetInt64());
            }
        }

        std::lock_guard lock(mutex_);
        chat_heads_ = std::move(heads);
    }

    std::vector<cb_person> cbfriends_service::get_played_with() const
    {
        std::lock_guard lock(mutex_);
        return played_with_;
    }

    void cbfriends_service::refresh_played_with()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/played-with", ts_body());
        if (!doc || !doc->HasMember("people") || !(*doc)["people"].IsArray()) return;

        auto people = parse_people((*doc)["people"]);
        std::lock_guard lock(mutex_);
        played_with_ = std::move(people);
    }

    // Direct messages. One held poll per open conversation, mirroring the room chat above.

    void cbfriends_service::set_dm_peer(const std::string& cb_id)
    {
        {
            std::lock_guard lock(mutex_);
            if (dm_peer_ == cb_id) return;
            dm_peer_ = cb_id;
            dm_.clear();
            dm_after_ = 0;
        }

        // Stopping the old poll waits on a request that may still be in flight, and this runs on
        // the UI thread, so hand the swap off.
        std::thread(&cbfriends_service::restart_dm_worker, this).detach();
    }

    void cbfriends_service::restart_dm_worker()
    {
        std::lock_guard lifecycle(dm_worker_mutex_);
        stop_dm_worker();

        std::string peer;
        {
            std::lock_guard lock(mutex_);
            peer = dm_peer_;
        }
        if (peer.empty() || !running_ || get_state() != profile_state::ready) return;

        // One unheld poll first, so history is on screen as soon as the network allows rather than
        // after the UI's next tick.
        poll_dm(false);

        dm_running_ = true;
        dm_worker_ = std::thread(&cbfriends_service::dm_loop, this);
    }

    void cbfriends_service::stop_dm_worker()
    {
        dm_running_ = false;
        if (dm_worker_.joinable())
        {
            dm_worker_.join();
        }
    }

    void cbfriends_service::dm_loop()
    {
        using namespace std::chrono_literals;
        while (dm_running_)
        {
            poll_dm(true);
            for (int i = 0; i < 4 && dm_running_; ++i)
            {
                std::this_thread::sleep_for(250ms);
            }
        }
    }

    std::string cbfriends_service::get_dm_peer() const
    {
        std::lock_guard lock(mutex_);
        return dm_peer_;
    }

    std::vector<chat_message> cbfriends_service::get_dm_messages() const
    {
        std::lock_guard lock(mutex_);
        return dm_;
    }

    std::vector<dm_conversation> cbfriends_service::get_dm_conversations() const
    {
        std::lock_guard lock(mutex_);
        return dm_list_;
    }

    int cbfriends_service::get_dm_unread() const
    {
        std::lock_guard lock(mutex_);
        return dm_unread_;
    }

    void cbfriends_service::send_dm(const std::string& cb_id, const std::string& text)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "to", cb_id);
        add_string(body, "text", text);
        // The room wakes our own held poll for the message itself; the conversation list is separate
        // state, so refresh it or a brand new conversation waits for the next tick to show up.
        post_action("/v1/dm/send", serialize(body), [this] { refresh_dm_list(); });
    }

    void cbfriends_service::poll_dm(const bool hold)
    {
        if (get_state() != profile_state::ready) return;

        std::string peer;
        int64_t after;
        {
            std::lock_guard lock(mutex_);
            peer = dm_peer_;
            after = dm_after_;
        }
        if (peer.empty()) return;

        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "with", peer);
        body.AddMember("after", after, body.GetAllocator());
        if (hold) body.AddMember("hold", true, body.GetAllocator());

        auto doc = hold
            ? post_json(base_url() + "/v1/dm/poll", serialize(body), CHAT_HOLD_TIMEOUT_SECONDS,
                        [this](size_t, size_t, size_t) { return dm_running_.load(); })
            : post_json(base_url() + "/v1/dm/poll", serialize(body));
        if (!doc || !doc->HasMember("messages") || !(*doc)["messages"].IsArray()) return;

        std::lock_guard lock(mutex_);
        if (dm_peer_ != peer) return; // the user switched conversations mid-request

        for (const auto& m : (*doc)["messages"].GetArray())
        {
            chat_message message;
            message.id = (m.IsObject() && m.HasMember("id") && m["id"].IsInt64()) ? m["id"].GetInt64() : 0;
            message.at = (m.IsObject() && m.HasMember("at") && m["at"].IsInt64()) ? m["at"].GetInt64() : 0;
            message.cb_id = json_get(m, "cbId");
            message.handle = json_get(m, "handle");
            message.display_name = json_get(m, "displayName");
            message.accent = json_get(m, "accent");
            message.text = json_get(m, "text");
            dm_.push_back(std::move(message));
            dm_after_ = (std::max)(dm_after_, dm_.back().id);
        }
        if (dm_.size() > 200)
        {
            dm_.erase(dm_.begin(), dm_.begin() + (dm_.size() - 200));
        }
    }

    void cbfriends_service::refresh_dm_list()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/dm/list", ts_body());
        if (!doc || !doc->HasMember("conversations") || !(*doc)["conversations"].IsArray()) return;

        std::vector<dm_conversation> list;
        for (const auto& c : (*doc)["conversations"].GetArray())
        {
            dm_conversation row;
            row.person = parse_person(c);
            row.preview = json_get(c, "preview");
            row.last_at = (c.IsObject() && c.HasMember("lastAt") && c["lastAt"].IsInt64())
                ? c["lastAt"].GetInt64() : 0;
            row.unread = (c.IsObject() && c.HasMember("unread") && c["unread"].IsInt())
                ? c["unread"].GetInt() : 0;
            list.push_back(std::move(row));
        }

        std::lock_guard lock(mutex_);
        dm_list_ = std::move(list);
        dm_unread_ = (doc->HasMember("unread") && (*doc)["unread"].IsInt()) ? (*doc)["unread"].GetInt() : 0;
    }

    // Moderation. Every endpoint re-checks authority server-side; nothing here is a permission.

    std::string cbfriends_service::get_mod_role() const
    {
        std::lock_guard lock(mutex_);
        return mod_role_;
    }

    void cbfriends_service::set_mod_active(const bool active)
    {
        mod_active_ = active;
        if (active && get_state() == profile_state::ready)
        {
            std::thread(&cbfriends_service::refresh_mod_queue, this).detach();
        }
    }

    std::vector<mod_report> cbfriends_service::get_mod_reports() const
    {
        std::lock_guard lock(mutex_);
        return mod_reports_;
    }

    std::vector<mod_log_entry> cbfriends_service::get_mod_log() const
    {
        std::lock_guard lock(mutex_);
        return mod_log_;
    }

    std::optional<mod_account> cbfriends_service::get_mod_lookup() const
    {
        std::lock_guard lock(mutex_);
        return mod_lookup_;
    }

    void cbfriends_service::refresh_mod_role()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/mod/status", ts_body());
        if (!doc) return;

        std::lock_guard lock(mutex_);
        mod_role_ = json_get(*doc, "role");
    }

    void cbfriends_service::refresh_mod_queue()
    {
        if (get_state() != profile_state::ready) return;

        std::vector<mod_report> reports;
        if (auto doc = post_json(base_url() + "/v1/mod/reports", ts_body());
            doc && doc->HasMember("reports") && (*doc)["reports"].IsArray())
        {
            for (const auto& r : (*doc)["reports"].GetArray())
            {
                mod_report rep;
                rep.id = json_get(r, "id");
                rep.reason = json_get(r, "reason");
                rep.context = json_get(r, "context");
                rep.status = json_get(r, "status");
                rep.at = (r.IsObject() && r.HasMember("at") && r["at"].IsInt64()) ? r["at"].GetInt64() : 0;
                if (r.IsObject() && r.HasMember("reporterProfile")) rep.reporter = parse_person(r["reporterProfile"]);
                if (r.IsObject() && r.HasMember("targetProfile")) rep.target = parse_person(r["targetProfile"]);
                reports.push_back(std::move(rep));
            }
        }

        std::vector<mod_log_entry> log;
        if (auto doc = post_json(base_url() + "/v1/mod/log", ts_body());
            doc && doc->HasMember("entries") && (*doc)["entries"].IsArray())
        {
            for (const auto& e : (*doc)["entries"].GetArray())
            {
                mod_log_entry entry;
                entry.action = json_get(e, "action");
                entry.detail = json_get(e, "detail");
                entry.at = (e.IsObject() && e.HasMember("at") && e["at"].IsInt64()) ? e["at"].GetInt64() : 0;
                if (e.IsObject() && e.HasMember("byProfile")) entry.by = parse_person(e["byProfile"]);
                if (e.IsObject() && e.HasMember("targetProfile")) entry.target = parse_person(e["targetProfile"]);
                log.push_back(std::move(entry));
            }
        }

        std::lock_guard lock(mutex_);
        mod_reports_ = std::move(reports);
        mod_log_ = std::move(log);
    }

    void cbfriends_service::mod_lookup(const std::string& handle)
    {
        {
            std::lock_guard lock(mutex_);
            mod_lookup_.reset();
        }
        if (handle.empty() || get_state() != profile_state::ready) return;

        std::thread([this, handle]
        {
            rapidjson::Document body;
            body.SetObject();
            body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
            add_string(body, "handle", handle);

            auto doc = post_json(base_url() + "/v1/mod/lookup", serialize(body));
            if (!doc) return;

            mod_account account;
            if (doc->HasMember("person")) account.person = parse_person((*doc)["person"]);
            account.role = json_get(*doc, "role");
            account.created_at = (doc->HasMember("createdAt") && (*doc)["createdAt"].IsInt64())
                ? (*doc)["createdAt"].GetInt64() : 0;
            account.device_count = (doc->HasMember("deviceCount") && (*doc)["deviceCount"].IsInt())
                ? (*doc)["deviceCount"].GetInt() : 0;
            if (doc->HasMember("mute") && (*doc)["mute"].IsObject())
            {
                const auto& mute = (*doc)["mute"];
                account.mute_reason = json_get(mute, "reason");
                account.muted_until = (mute.HasMember("until") && mute["until"].IsInt64())
                    ? mute["until"].GetInt64() : 0;
            }

            std::lock_guard lock(mutex_);
            mod_lookup_ = std::move(account);
        }).detach();
    }

    void cbfriends_service::mod_resolve(const std::string& report_id)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "id", report_id);
        post_action("/v1/mod/resolve", serialize(body), [this] { refresh_mod_queue(); });
    }

    void cbfriends_service::mod_mute(const std::string& cb_id, const int minutes, const std::string& reason)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "cbId", cb_id);
        body.AddMember("minutes", minutes, body.GetAllocator());
        add_string(body, "reason", reason);
        post_action("/v1/mod/mute", serialize(body), [this] { refresh_mod_queue(); });
    }

    void cbfriends_service::mod_set_role(const std::string& cb_id, const std::string& role)
    {
        rapidjson::Document body;
        body.SetObject();
        body.AddMember("ts", static_cast<int64_t>(std::time(nullptr)), body.GetAllocator());
        add_string(body, "cbId", cb_id);
        add_string(body, "role", role);
        post_action("/v1/mod/set-role", serialize(body), [this] { refresh_mod_queue(); });
    }

    void cbfriends_service::refresh_security()
    {
        if (get_state() != profile_state::ready) return;
        auto doc = post_json(base_url() + "/v1/security/events", ts_body());
        if (!doc || !doc->HasMember("events") || !(*doc)["events"].IsArray()) return;

        std::vector<security_event> events;
        for (const auto& e : (*doc)["events"].GetArray())
        {
            security_event ev;
            ev.kind = json_get(e, "kind");
            ev.via = json_get(e, "via");
            ev.at = (e.IsObject() && e.HasMember("at") && e["at"].IsInt64()) ? e["at"].GetInt64() : 0;
            events.push_back(std::move(ev));
        }

        std::lock_guard lock(mutex_);
        security_ = std::move(events);
    }

    broadcast_state cbfriends_service::get_broadcast() const
    {
        std::lock_guard lock(mutex_);
        return {broadcast_on_, broadcast_game_, broadcast_note_, broadcast_slots_};
    }

    void cbfriends_service::set_broadcast(const bool on, const std::string& game, const std::string& note,
                                          const int slots)
    {
        const bool active = on && !game.empty();
        {
            std::lock_guard lock(mutex_);
            broadcast_on_ = active;
            broadcast_game_ = game;
            broadcast_note_ = note;
            broadcast_slots_ = slots;
        }
        broadcasting_ = active;

        {
            const auto guard = utils::properties::lock();
            utils::properties::store(property_keys::CB_BROADCAST, active ? "true" : "false");
            utils::properties::store(property_keys::CB_BROADCAST_GAME, game);
            utils::properties::store(property_keys::CB_BROADCAST_NOTE, note);
            utils::properties::store(property_keys::CB_BROADCAST_SLOTS, std::to_string(slots));
        }

        if (active)
        {
            post_lfg(game, {}, note, slots);
        }
        else
        {
            clear_lfg();
        }
    }

    void cbfriends_service::send_broadcast_keepalive()
    {
        if (get_state() != profile_state::ready)
        {
            return;
        }
        post_signed(base_url() + "/v1/lfg/refresh", ts_body());
    }

    void cbfriends_service::load_broadcast()
    {
        std::string on, game, note, slots;
        {
            const auto guard = utils::properties::lock();
            on = utils::properties::load(property_keys::CB_BROADCAST).value_or("");
            game = utils::properties::load(property_keys::CB_BROADCAST_GAME).value_or("");
            note = utils::properties::load(property_keys::CB_BROADCAST_NOTE).value_or("");
            slots = utils::properties::load(property_keys::CB_BROADCAST_SLOTS).value_or("");
        }

        const bool active = on == "true" && !game.empty();
        const int slots_value = slots.empty() ? 0 : std::atoi(slots.c_str());
        {
            std::lock_guard lock(mutex_);
            broadcast_on_ = active;
            broadcast_game_ = game;
            broadcast_note_ = note;
            broadcast_slots_ = slots_value;
        }
        broadcasting_ = active;

        if (active)
        {
            post_lfg(game, {}, note, slots_value); // re-establish the broadcast on the backend
        }
    }
}
