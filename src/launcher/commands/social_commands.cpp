#include "std_include.hpp"
#include "social_commands.hpp"
#include "invite_notification.hpp"
#include "cef/cef_ui.hpp"
#include "social/cbfriends_service.hpp"

namespace commands::social_commands
{
    namespace
    {
        void add_string(rapidjson::Value& target, const char* key, const std::string& value,
                        rapidjson::Document::AllocatorType& allocator)
        {
            rapidjson::Value str;
            str.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
            target.AddMember(rapidjson::StringRef(key), str, allocator);
        }

        std::string read_string(const rapidjson::Value& value, const char* key)
        {
            if (value.IsObject() && value.HasMember(key) && value[key].IsString())
            {
                return value[key].GetString();
            }
            return {};
        }

        // Builds the JSON shape for one person; add_person pushes it into an array.
        rapidjson::Value person_value(const social::cb_person& person,
                                      rapidjson::Document::AllocatorType& allocator)
        {
            rapidjson::Value obj(rapidjson::kObjectType);
            add_string(obj, "cbId", person.cb_id, allocator);
            add_string(obj, "handle", person.handle, allocator);
            add_string(obj, "displayName", person.display_name, allocator);
            add_string(obj, "avatarUrl", person.avatar_url, allocator);
            obj.AddMember("online", person.online, allocator);
            add_string(obj, "game", person.game, allocator);
            add_string(obj, "mode", person.mode, allocator);
            add_string(obj, "status", person.status, allocator);
            add_string(obj, "bio", person.bio, allocator);
            add_string(obj, "accent", person.accent, allocator);
            add_string(obj, "favoriteGame", person.favorite_game, allocator);
            obj.AddMember("createdAt", person.created_at, allocator);
            obj.AddMember("lastSeen", person.last_seen, allocator);
            rapidjson::Value playtime(rapidjson::kObjectType);
            for (const auto& [game, seconds] : person.playtime)
            {
                rapidjson::Value key;
                key.SetString(game.data(), static_cast<rapidjson::SizeType>(game.size()), allocator);
                playtime.AddMember(key, seconds, allocator);
            }
            obj.AddMember("playtime", playtime, allocator);
            add_string(obj, "relation", person.relation, allocator);
            add_string(obj, "note", person.note, allocator);
            obj.AddMember("slots", person.slots, allocator);
            obj.AddMember("joined", person.joined, allocator);
            obj.AddMember("iJoined", person.i_joined, allocator);
            rapidjson::Value joiners(rapidjson::kArrayType);
            for (const auto& j : person.joiners)
            {
                rapidjson::Value row(rapidjson::kObjectType);
                add_string(row, "cbId", j.cb_id, allocator);
                add_string(row, "handle", j.handle, allocator);
                add_string(row, "displayName", j.display_name, allocator);
                add_string(row, "avatarUrl", j.avatar_url, allocator);
                add_string(row, "accent", j.accent, allocator);
                joiners.PushBack(row, allocator);
            }
            obj.AddMember("joiners", joiners, allocator);
            obj.AddMember("joinable", person.joinable, allocator);
            obj.AddMember("directJoin", person.direct_join, allocator);
            obj.AddMember("openable", person.openable, allocator);
            obj.AddMember("sameMatch", person.same_match, allocator);
            return obj;
        }

        void add_person(rapidjson::Value& array, const social::cb_person& person,
                        rapidjson::Document::AllocatorType& allocator)
        {
            array.PushBack(person_value(person, allocator), allocator);
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("cbfriends-get-status", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& service = social::cbfriends_service::instance();

            add_string(response, "state", social::profile_state_to_string(service.get_state()), allocator);

            const auto profile = service.get_profile();
            if (profile)
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "cbId", profile->cb_id, allocator);
                add_string(obj, "handle", profile->handle, allocator);
                add_string(obj, "displayName", profile->display_name, allocator);
                add_string(obj, "avatarUrl", profile->avatar_url, allocator);
                add_string(obj, "bio", profile->bio, allocator);
                add_string(obj, "accent", profile->accent, allocator);
                add_string(obj, "favoriteGame", profile->favorite_game, allocator);
                response.AddMember("profile", obj, allocator);
            }
            else
            {
                response.AddMember("profile", rapidjson::Value(rapidjson::kNullType), allocator);
            }

            const auto error = service.get_last_error();
            if (error.empty())
            {
                response.AddMember("error", rapidjson::Value(rapidjson::kNullType), allocator);
            }
            else
            {
                add_string(response, "error", error, allocator);
            }

            response.AddMember("hasRecoveryCode", service.has_recovery_code(), allocator);
            // Gates the Invite button.
            response.AddMember("joinable", service.is_joinable(), allocator);
        });

        cef_ui.add_command("cbfriends-create-profile", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto handle = read_string(value, "handle");
            const auto display_name = read_string(value, "displayName");

            // A handle is required to create; the display name falls back to it on the client.
            const bool ok = !handle.empty();
            if (ok)
            {
                social::cbfriends_service::instance().begin_create_profile(handle, display_name);
            }
            response.AddMember("started", ok, allocator);
        });

        cef_ui.add_command("cbfriends-get-recovery-code", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto code = social::cbfriends_service::instance().get_recovery_code();
            if (code.empty())
            {
                response.AddMember("code", rapidjson::Value(rapidjson::kNullType), allocator);
            }
            else
            {
                add_string(response, "code", code, allocator);
            }
        });

        cef_ui.add_command("cbfriends-update-profile", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto display_name = read_string(value, "displayName");
            const auto handle = read_string(value, "handle");
            const auto bio = read_string(value, "bio");
            const auto accent = read_string(value, "accent");
            const auto favorite_game = read_string(value, "favoriteGame");
            const auto avatar_url = read_string(value, "avatarUrl");
            const bool ok = !display_name.empty() || !handle.empty();
            if (ok)
            {
                social::cbfriends_service::instance().begin_update_profile(display_name, handle, bio,
                                                                          accent, favorite_game, avatar_url);
            }
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-set-activity", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().set_activity(read_string(value, "game"));
        });

        cef_ui.add_command("cbfriends-request-profile", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().request_profile(read_string(value, "cbId"));
        });

        cef_ui.add_command("cbfriends-get-viewed-profile", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto person = social::cbfriends_service::instance().get_viewed_profile();
            if (!person)
            {
                response.AddMember("profile", rapidjson::Value(rapidjson::kNullType), allocator);
                return;
            }

            response.AddMember("profile", person_value(*person, allocator), allocator);
        });

        cef_ui.add_command("cbfriends-get-friends", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto snapshot = social::cbfriends_service::instance().get_friends();

            rapidjson::Value friends(rapidjson::kArrayType);
            rapidjson::Value incoming(rapidjson::kArrayType);
            rapidjson::Value outgoing(rapidjson::kArrayType);
            for (const auto& p : snapshot.friends) add_person(friends, p, allocator);
            for (const auto& p : snapshot.incoming) add_person(incoming, p, allocator);
            for (const auto& p : snapshot.outgoing) add_person(outgoing, p, allocator);

            response.AddMember("friends", friends, allocator);
            response.AddMember("incoming", incoming, allocator);
            response.AddMember("outgoing", outgoing, allocator);
        });

        cef_ui.add_command("cbfriends-add-friend", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto handle = read_string(value, "handle");
            const bool ok = !handle.empty();
            if (ok)
            {
                social::cbfriends_service::instance().add_friend(handle);
            }
            response.AddMember("ok", ok, allocator);
        });

        // These all take a target cbId.
        const auto friend_action = [&cef_ui](const char* name, void (social::cbfriends_service::*method)(const std::string&))
        {
            cef_ui.add_command(name, [method](const rapidjson::Value& value, rapidjson::Document& response)
            {
                response.SetObject();
                auto& allocator = response.GetAllocator();

                const auto cb_id = read_string(value, "cbId");
                const bool ok = !cb_id.empty();
                if (ok)
                {
                    (social::cbfriends_service::instance().*method)(cb_id);
                }
                response.AddMember("ok", ok, allocator);
            });
        };

        friend_action("cbfriends-accept", &social::cbfriends_service::accept_friend);
        friend_action("cbfriends-decline", &social::cbfriends_service::decline_friend);
        friend_action("cbfriends-cancel", &social::cbfriends_service::cancel_request);
        friend_action("cbfriends-remove", &social::cbfriends_service::remove_friend);

        friend_action("cbfriends-invite-friend", &social::cbfriends_service::send_invite);
        friend_action("cbfriends-request-join", &social::cbfriends_service::request_join);

        cef_ui.add_command("cbfriends-get-invites", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value invites(rapidjson::kArrayType);
            for (const auto& inv : social::cbfriends_service::instance().get_invites())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "id", inv.id, allocator);
                add_string(obj, "senderId", inv.sender_cb_id, allocator);
                add_string(obj, "senderName", inv.sender_name, allocator);
                add_string(obj, "senderAvatar", inv.sender_avatar, allocator);
                add_string(obj, "gameId", inv.game, allocator);
                obj.AddMember("isRequest", inv.is_request, allocator);
                obj.AddMember("isApproval", inv.is_approval, allocator);
                obj.AddMember("needsOpen", inv.needs_open, allocator);
                invites.PushBack(obj, allocator);
            }
            response.AddMember("invites", invites, allocator);
        });

        cef_ui.add_command("cbfriends-accept-invite", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            const auto id = read_string(value, "id");
            const bool ok = !id.empty();
            if (ok) social::cbfriends_service::instance().accept_invite(id);
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-decline-invite", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            const auto id = read_string(value, "id");
            const bool ok = !id.empty();
            if (ok) social::cbfriends_service::instance().decline_invite(id);
            response.AddMember("ok", ok, allocator);
        });

        // Mirrors the Discord path: the frontend supplies only the id and the localized strings, and
        // the sender's art is resolved here from our own state.
        cef_ui.add_command("cbfriends-show-invite-notification", [&cef_ui](const rapidjson::Value& value,
                                                                          rapidjson::Document& response)
        {
            response.SetObject();

            if (!invite_notification::wanted(cef_ui))
            {
                return;
            }

            const auto id = read_string(value, "id");
            const auto title = read_string(value, "title");
            const auto body = read_string(value, "body");
            if (id.empty() || title.empty())
            {
                return;
            }

            for (const auto& inv : social::cbfriends_service::instance().get_invites())
            {
                if (inv.id == id)
                {
                    invite_notification::show(cef_ui, id, title, body, inv.sender_avatar, inv.game);
                    return;
                }
            }
        });

        cef_ui.add_command("cbfriends-dismiss-invite-notification", [](const rapidjson::Value& value,
                                                                      rapidjson::Document&)
        {
            const auto id = read_string(value, "id");
            if (!id.empty())
            {
                invite_notification::dismiss(id);
            }
        });

        cef_ui.add_command("cbfriends-get-played-with", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value people(rapidjson::kArrayType);
            for (const auto& p : social::cbfriends_service::instance().get_played_with())
            {
                add_person(people, p, allocator);
            }
            response.AddMember("people", people, allocator);
        });

        // Toast for a friend request or an unread message. As with invites, the frontend supplies
        // only the id and the localized strings; the sender's art is resolved here from our state.
        cef_ui.add_command("cbfriends-show-person-notification", [&cef_ui](const rapidjson::Value& value,
                                                                          rapidjson::Document& response)
        {
            response.SetObject();

            if (!invite_notification::wanted(cef_ui))
            {
                return;
            }

            const auto cb_id = read_string(value, "cbId");
            const auto title = read_string(value, "title");
            const auto body = read_string(value, "body");
            if (cb_id.empty() || title.empty())
            {
                return;
            }

            const auto person = social::cbfriends_service::instance().find_person(cb_id);
            invite_notification::show(cef_ui, cb_id, title, body,
                                      person ? person->avatar_url : std::string{}, {});
        });

        // Direct messages.
        cef_ui.add_command("cbfriends-set-dm-peer", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().set_dm_peer(read_string(value, "cbId"));
        });

        cef_ui.add_command("cbfriends-send-dm", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            const auto cb_id = read_string(value, "cbId");
            const auto text = read_string(value, "text");
            const bool ok = !cb_id.empty() && !text.empty();
            if (ok) social::cbfriends_service::instance().send_dm(cb_id, text);
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-get-dm", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            auto& service = social::cbfriends_service::instance();

            add_string(response, "peer", service.get_dm_peer(), allocator);
            rapidjson::Value messages(rapidjson::kArrayType);
            for (const auto& m : service.get_dm_messages())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                obj.AddMember("id", m.id, allocator);
                obj.AddMember("at", m.at, allocator);
                add_string(obj, "cbId", m.cb_id, allocator);
                add_string(obj, "handle", m.handle, allocator);
                add_string(obj, "displayName", m.display_name, allocator);
                add_string(obj, "accent", m.accent, allocator);
                add_string(obj, "text", m.text, allocator);
                messages.PushBack(obj, allocator);
            }
            response.AddMember("messages", messages, allocator);
        });

        cef_ui.add_command("cbfriends-get-chat-heads", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value rooms(rapidjson::kObjectType);
            for (const auto& [room, id] : social::cbfriends_service::instance().get_chat_heads())
            {
                rapidjson::Value key;
                key.SetString(room.data(), static_cast<rapidjson::SizeType>(room.size()), allocator);
                rooms.AddMember(key, id, allocator);
            }
            response.AddMember("rooms", rooms, allocator);
        });

        cef_ui.add_command("cbfriends-get-dm-list", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            auto& service = social::cbfriends_service::instance();

            rapidjson::Value conversations(rapidjson::kArrayType);
            for (const auto& c : service.get_dm_conversations())
            {
                auto obj = person_value(c.person, allocator);
                add_string(obj, "preview", c.preview, allocator);
                obj.AddMember("lastAt", c.last_at, allocator);
                obj.AddMember("unread", c.unread, allocator);
                conversations.PushBack(obj, allocator);
            }
            response.AddMember("conversations", conversations, allocator);
            response.AddMember("unread", service.get_dm_unread(), allocator);
        });

        // Moderation. The role shown here only decides what to draw; the worker re-checks authority
        // on every one of these calls, so a forged role buys nothing.
        cef_ui.add_command("cbfriends-mod-status", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();
            add_string(response, "role", social::cbfriends_service::instance().get_mod_role(), allocator);
        });

        cef_ui.add_command("cbfriends-set-mod-active", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            const auto active = value.IsObject() && value.HasMember("active") && value["active"].IsBool()
                && value["active"].GetBool();
            social::cbfriends_service::instance().set_mod_active(active);
        });

        cef_ui.add_command("cbfriends-mod-get-reports", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value reports(rapidjson::kArrayType);
            for (const auto& r : social::cbfriends_service::instance().get_mod_reports())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "id", r.id, allocator);
                add_string(obj, "reason", r.reason, allocator);
                add_string(obj, "context", r.context, allocator);
                add_string(obj, "status", r.status, allocator);
                obj.AddMember("at", r.at, allocator);
                obj.AddMember("reporter", person_value(r.reporter, allocator), allocator);
                obj.AddMember("target", person_value(r.target, allocator), allocator);
                reports.PushBack(obj, allocator);
            }
            response.AddMember("reports", reports, allocator);
        });

        cef_ui.add_command("cbfriends-mod-get-log", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value entries(rapidjson::kArrayType);
            for (const auto& e : social::cbfriends_service::instance().get_mod_log())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "action", e.action, allocator);
                add_string(obj, "detail", e.detail, allocator);
                obj.AddMember("at", e.at, allocator);
                obj.AddMember("by", person_value(e.by, allocator), allocator);
                obj.AddMember("target", person_value(e.target, allocator), allocator);
                entries.PushBack(obj, allocator);
            }
            response.AddMember("entries", entries, allocator);
        });

        cef_ui.add_command("cbfriends-mod-lookup", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().mod_lookup(read_string(value, "handle"));
        });

        cef_ui.add_command("cbfriends-mod-get-lookup", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto found = social::cbfriends_service::instance().get_mod_lookup();
            if (!found)
            {
                response.AddMember("account", rapidjson::Value(rapidjson::kNullType), allocator);
                return;
            }

            rapidjson::Value obj(rapidjson::kObjectType);
            obj.AddMember("person", person_value(found->person, allocator), allocator);
            add_string(obj, "role", found->role, allocator);
            add_string(obj, "muteReason", found->mute_reason, allocator);
            obj.AddMember("mutedUntil", found->muted_until, allocator);
            obj.AddMember("createdAt", found->created_at, allocator);
            obj.AddMember("deviceCount", found->device_count, allocator);
            response.AddMember("account", obj, allocator);
        });

        cef_ui.add_command("cbfriends-mod-resolve", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().mod_resolve(read_string(value, "id"));
        });

        cef_ui.add_command("cbfriends-mod-mute", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            const auto minutes = (value.IsObject() && value.HasMember("minutes") && value["minutes"].IsInt())
                ? value["minutes"].GetInt() : 0;
            social::cbfriends_service::instance().mod_mute(read_string(value, "cbId"), minutes,
                                                           read_string(value, "reason"));
        });

        cef_ui.add_command("cbfriends-mod-set-role", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().mod_set_role(read_string(value, "cbId"),
                                                               read_string(value, "role"));
        });

        cef_ui.add_command("cbfriends-set-community-active", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            const auto active = value.IsObject() && value.HasMember("active") && value["active"].IsBool()
                && value["active"].GetBool();
            social::cbfriends_service::instance().set_community_active(active);
        });

        cef_ui.add_command("cbfriends-get-lfg", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value posts(rapidjson::kArrayType);
            for (const auto& p : social::cbfriends_service::instance().get_lfg())
            {
                add_person(posts, p, allocator);
            }
            response.AddMember("posts", posts, allocator);
        });

        cef_ui.add_command("cbfriends-post-lfg", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto game = read_string(value, "game");
            const auto mode = read_string(value, "mode");
            const auto note = read_string(value, "note");
            const int slots = (value.IsObject() && value.HasMember("slots") && value["slots"].IsInt())
                ? value["slots"].GetInt() : 0;
            const bool ok = !game.empty();
            if (ok)
            {
                social::cbfriends_service::instance().post_lfg(game, mode, note, slots);
            }
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-clear-lfg", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().clear_lfg();
        });

        cef_ui.add_command("cbfriends-set-lfg-filter", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().set_lfg_filter(read_string(value, "game"));
        });

        cef_ui.add_command("cbfriends-set-chat-room", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().set_chat_room(read_string(value, "room"));
        });

        cef_ui.add_command("cbfriends-get-chat", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value messages(rapidjson::kArrayType);
            for (const auto& m : social::cbfriends_service::instance().get_chat())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                obj.AddMember("id", m.id, allocator);
                obj.AddMember("at", m.at, allocator);
                add_string(obj, "cbId", m.cb_id, allocator);
                add_string(obj, "handle", m.handle, allocator);
                add_string(obj, "displayName", m.display_name, allocator);
                add_string(obj, "accent", m.accent, allocator);
                add_string(obj, "text", m.text, allocator);
                messages.PushBack(obj, allocator);
            }
            response.AddMember("messages", messages, allocator);
            response.AddMember("hasMore", social::cbfriends_service::instance().has_more_chat(), allocator);
        });

        cef_ui.add_command("cbfriends-send-chat", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto room = read_string(value, "room");
            const auto text = read_string(value, "text");
            const bool ok = !room.empty() && !text.empty();
            if (ok)
            {
                social::cbfriends_service::instance().send_chat(room, text);
            }
            response.AddMember("ok", ok, allocator);
        });

        friend_action("cbfriends-block", &social::cbfriends_service::block_user);
        friend_action("cbfriends-unblock", &social::cbfriends_service::unblock_user);

        cef_ui.add_command("cbfriends-get-blocked", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value blocked(rapidjson::kArrayType);
            for (const auto& p : social::cbfriends_service::instance().get_blocked())
            {
                add_person(blocked, p, allocator);
            }
            response.AddMember("blocked", blocked, allocator);
        });

        cef_ui.add_command("cbfriends-report", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto cb_id = read_string(value, "cbId");
            const bool ok = !cb_id.empty();
            if (ok)
            {
                social::cbfriends_service::instance().report_user(cb_id, read_string(value, "reason"));
            }
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-get-security-events", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value events(rapidjson::kArrayType);
            for (const auto& e : social::cbfriends_service::instance().get_security_events())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "kind", e.kind, allocator);
                add_string(obj, "via", e.via, allocator);
                obj.AddMember("at", e.at, allocator);
                events.PushBack(obj, allocator);
            }
            response.AddMember("events", events, allocator);
        });

        cef_ui.add_command("cbfriends-load-older-chat", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().load_older_chat();
        });

        cef_ui.add_command("cbfriends-get-broadcast", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto state = social::cbfriends_service::instance().get_broadcast();
            response.AddMember("on", state.on, allocator);
            add_string(response, "game", state.game, allocator);
            add_string(response, "note", state.note, allocator);
            response.AddMember("slots", state.slots, allocator);
        });

        cef_ui.add_command("cbfriends-set-broadcast", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const bool on = value.IsObject() && value.HasMember("on") && value["on"].IsBool() && value["on"].GetBool();
            const auto game = read_string(value, "game");
            const auto note = read_string(value, "note");
            const int slots = (value.IsObject() && value.HasMember("slots") && value["slots"].IsInt())
                ? value["slots"].GetInt() : 0;

            social::cbfriends_service::instance().set_broadcast(on, game, note, slots);
            response.AddMember("ok", true, allocator);
        });

        cef_ui.add_command("cbfriends-lfg-join", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto cb_id = read_string(value, "cbId");
            const bool ok = !cb_id.empty();
            if (ok)
            {
                social::cbfriends_service::instance().lfg_join(cb_id);
            }
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("cbfriends-lfg-leave", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            social::cbfriends_service::instance().lfg_leave();
        });
    }
}
