#include "std_include.hpp"
#include "discord_commands.hpp"
#include "cef/cef_ui.hpp"
#include "discord/discord_service.hpp"

namespace commands::discord_commands
{
    namespace
    {
        void add_string(rapidjson::Value& target, const char* key, const std::string& value,
                        rapidjson::Document::AllocatorType& allocator)
        {
            rapidjson::Value str_value;
            str_value.SetString(value.data(), static_cast<rapidjson::SizeType>(value.size()), allocator);
            target.AddMember(rapidjson::StringRef(key), str_value, allocator);
        }
    }

    void register_commands(cef::cef_ui& cef_ui, command_context&)
    {
        cef_ui.add_command("discord-get-status", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& service = discord::discord_service::instance();

            add_string(response, "status", discord::link_status_to_string(service.get_status()), allocator);

            const auto profile = service.get_profile();
            if (profile)
            {
                rapidjson::Value profile_obj(rapidjson::kObjectType);
                add_string(profile_obj, "id", profile->id, allocator);
                add_string(profile_obj, "displayName", profile->display_name, allocator);
                add_string(profile_obj, "avatarUrl", profile->avatar_url, allocator);
                response.AddMember("profile", profile_obj, allocator);
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

            // True when the local game is publishing a joinable presence: gates the Invite button.
            response.AddMember("joinable", service.is_joinable(), allocator);
        });

        cef_ui.add_command("discord-link", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& service = discord::discord_service::instance();
            const auto status = service.get_status();
            const auto can_link = status == discord::link_status::unlinked || status == discord::link_status::error;

            if (can_link)
            {
                service.begin_link();
            }

            response.AddMember("started", can_link, allocator);
        });

        cef_ui.add_command("discord-unlink", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& service = discord::discord_service::instance();
            const auto status = service.get_status();
            const auto can_unlink = status == discord::link_status::linked ||
                status == discord::link_status::connecting || status == discord::link_status::error;

            if (can_unlink)
            {
                service.unlink();
            }

            response.AddMember("started", can_unlink, allocator);
        });

        cef_ui.add_command("discord-get-friends", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            auto& service = discord::discord_service::instance();
            const auto status = service.get_status();
            const auto registry_ok = service.registry_ok();

            response.AddMember("available", status == discord::link_status::linked, allocator);
            response.AddMember("registryOk", registry_ok, allocator);

            rapidjson::Value friends_array(rapidjson::kArrayType);

            if (status == discord::link_status::linked)
            {
                for (const auto& entry : service.get_friends())
                {
                    // Only friends that linked the launcher are shown. Without
                    // registry data, fall back to friends provably in the
                    // launcher right now via Discord presence.
                    const auto show = registry_ok ? entry.linked : entry.in_launcher;
                    if (!show)
                    {
                        continue;
                    }

                    rapidjson::Value friend_obj(rapidjson::kObjectType);
                    add_string(friend_obj, "id", entry.id, allocator);
                    add_string(friend_obj, "displayName", entry.display_name, allocator);
                    add_string(friend_obj, "avatarUrl", entry.avatar_url, allocator);
                    add_string(friend_obj, "status", entry.status, allocator);
                    friend_obj.AddMember("inLauncher", entry.in_launcher, allocator);
                    friend_obj.AddMember("joinable", entry.joinable, allocator);
                    friend_obj.AddMember("directJoin", entry.direct_join, allocator);
                    add_string(friend_obj, "activityDetails", entry.activity_details, allocator);
                    add_string(friend_obj, "activityState", entry.activity_state, allocator);
                    friends_array.PushBack(friend_obj, allocator);
                }
            }

            response.AddMember("friends", friends_array, allocator);
        });

        cef_ui.add_command("discord-invite-friend", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto user_id = value.HasMember("userId") && value["userId"].IsString()
                ? std::string{value["userId"].GetString()} : std::string{};

            const bool ok = !user_id.empty();
            if (ok)
            {
                discord::discord_service::instance().send_invite(user_id);
            }
            response.AddMember("sent", ok, allocator);
        });

        cef_ui.add_command("discord-request-join", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto user_id = value.HasMember("userId") && value["userId"].IsString()
                ? std::string{value["userId"].GetString()} : std::string{};

            const bool ok = !user_id.empty();
            if (ok)
            {
                discord::discord_service::instance().request_join(user_id);
            }
            response.AddMember("sent", ok, allocator);
        });

        cef_ui.add_command("discord-get-invites", [](const rapidjson::Value&, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            rapidjson::Value invites_array(rapidjson::kArrayType);
            for (const auto& invite : discord::discord_service::instance().get_invites())
            {
                rapidjson::Value obj(rapidjson::kObjectType);
                add_string(obj, "id", invite.id, allocator);
                add_string(obj, "senderId", invite.sender_id, allocator);
                add_string(obj, "senderName", invite.sender_name, allocator);
                add_string(obj, "senderAvatar", invite.sender_avatar, allocator);
                obj.AddMember("isRequest", invite.is_request, allocator);
                obj.AddMember("isApproval", invite.is_approval, allocator);
                invites_array.PushBack(obj, allocator);
            }
            response.AddMember("invites", invites_array, allocator);
        });

        cef_ui.add_command("discord-accept-invite", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto id = value.HasMember("id") && value["id"].IsString()
                ? std::string{value["id"].GetString()} : std::string{};

            const bool ok = !id.empty();
            if (ok)
            {
                discord::discord_service::instance().accept_invite(id);
            }
            response.AddMember("ok", ok, allocator);
        });

        cef_ui.add_command("discord-decline-invite", [](const rapidjson::Value& value, rapidjson::Document& response)
        {
            response.SetObject();
            auto& allocator = response.GetAllocator();

            const auto id = value.HasMember("id") && value["id"].IsString()
                ? std::string{value["id"].GetString()} : std::string{};

            const bool ok = !id.empty();
            if (ok)
            {
                discord::discord_service::instance().decline_invite(id);
            }
            response.AddMember("ok", ok, allocator);
        });
    }
}
