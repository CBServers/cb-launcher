#include "std_include.hpp"
#include "discord_service.hpp"
#include "discord_constants.hpp"
#include "link_registry.hpp"
#include "token_store.hpp"

#include <utils/concurrency.hpp>
#include <utils/logger.hpp>
#include <utils/nt.hpp>
#include <utils/properties.hpp>
#include <utils/property_keys.hpp>

#pragma warning(push, 0)
#define DISCORDPP_IMPLEMENTATION
#include <discordpp.h>
#pragma warning(pop)

#include <cstdio>
#include <ctime>
#include <deque>
#include <map>
#include <unordered_set>

namespace discord
{
    namespace
    {
        constexpr auto REGISTRY_REFRESH_INTERVAL = 5min;
        constexpr auto CONNECT_RETRY_INITIAL = 30s;
        constexpr auto CONNECT_RETRY_MAX = 10min;
        constexpr auto TICK_INTERVAL = 16ms;

        // Party Id prefix marks a joinable match; the secret is hidden, so the exposed party Id carries the join signal + direct-vs-request.
        constexpr auto PARTY_JOIN_DIRECT_PREFIX = "joind-";  // public/dedicated server => "Join", no approval
        constexpr auto PARTY_JOIN_REQUEST_PREFIX = "joinr-"; // private host (nat) => "Ask to Join", host approves

        // Window after asking to join in which the host's incoming Join invite counts as approval of our request, not an unsolicited invite.
        constexpr auto JOIN_REQUEST_TTL = 2min;

        std::string map_status(const discordpp::StatusType status)
        {
            switch (status)
            {
            case discordpp::StatusType::Online:
            case discordpp::StatusType::Streaming:
                return "online";
            case discordpp::StatusType::Idle:
            case discordpp::StatusType::Dnd:
                return "idle";
            default:
                return "offline";
            }
        }

        std::string avatar_url_for(const discordpp::UserHandle& user)
        {
            if (!user.Avatar())
            {
                return {};
            }

            return user.AvatarUrl(discordpp::UserHandle::AvatarType::Png, discordpp::UserHandle::AvatarType::Png);
        }

        std::string mode_display_name(const std::string& mode)
        {
            if (mode == "mp") return "Multiplayer";
            if (mode == "zm") return "Zombies";
            if (mode == "sp") return "Campaign";
            if (mode == "sv") return "Survival";
            return {};
        }

        std::string presence_art_url(const std::string& game_id)
        {
            return std::string(PRESENCE_ART_BASE) + game_id + ".png";
        }

        // Discord caps details/state at 128 bytes.
        std::string clamp_field(std::string value)
        {
            if (value.size() > 128)
            {
                value.resize(128);
            }
            return value;
        }

        // "<Game> - <gametype> on <map>"; just "<Game>" in menus (empty map).
        std::string build_rich_details(const std::string& display_name, const std::string& gametype,
                                       const std::string& map_display)
        {
            if (map_display.empty())
            {
                return display_name;
            }

            const auto context = gametype.empty() ? map_display : (gametype + " on " + map_display);
            return display_name + " - " + context;
        }

        // Server name on a public server; "Campaign" in SP; "Private Match" in-game otherwise; "In Menu" in menus.
        std::string build_rich_state(const std::string& mode, const std::string& map_display,
                                     const std::string& server_name)
        {
            if (map_display.empty())
            {
                return "In Menu";
            }
            if (!server_name.empty())
            {
                return server_name;
            }
            return mode == "sp" ? "Campaign" : "Private Match";
        }
    }

    std::string link_status_to_string(const link_status status)
    {
        switch (status)
        {
        case link_status::unlinked:
            return "unlinked";
        case link_status::linking:
            return "linking";
        case link_status::connecting:
            return "connecting";
        case link_status::linked:
            return "linked";
        case link_status::error:
            return "error";
        default:
            return "unavailable";
        }
    }

    struct shared_state
    {
        link_status status{link_status::unavailable};
        std::optional<own_profile> profile{};
        std::vector<friend_entry> friends{};
        std::unordered_set<std::string> linked_ids{};
        bool registry_succeeded{false};
        std::string last_error{};
        std::string access_token{};
        std::vector<invite_entry> invites{}; // pending invites/join-requests
        bool joinable{false};                // local game is publishing a joinable presence
    };

    using state_container = utils::concurrency::container<shared_state>;

    struct discord_service::impl
    {
        std::shared_ptr<state_container> state = std::make_shared<state_container>();
        utils::concurrency::container<std::deque<std::function<void()>>> tasks{};
        std::thread thread{};
        std::atomic<bool> running{false};
        std::shared_ptr<std::atomic<bool>> registry_inflight = std::make_shared<std::atomic<bool>>(false);

        // Touched from the discord thread only
        std::shared_ptr<discordpp::Client> client{};
        bool have_tokens{false};
        bool unlinking{false};

        struct game_activity
        {
            std::string game_id;
            std::string display_name;
            std::string mode;
            int64_t start_time{0};

            // Live enrichment; rich==false is the baseline (game + mode only).
            bool rich{false};
            std::string map_display;
            std::string gametype;
            std::string server_name;
            int players{0};
            int max_players{0};
            std::string join_secret; // unified cbl: secret; empty => not joinable
            bool direct_join{false}; // joinable on a public/dedicated server (vs nat/private host)
        };

        std::optional<game_activity> current_activity{};

        // Ownership signal (discord thread only).
        std::function<void(bool)> ownership_cb{};
        bool last_owns{false};

        // Invites (discord thread only).
        std::function<void(std::string)> join_secret_cb{};
        std::map<std::string, discordpp::ActivityInvite> invite_objs{};
        std::map<uint64_t, std::chrono::steady_clock::time_point> pending_join_requests{}; // hosts we asked to join
        bool launch_command_registered{false}; // Discord cold-launch handler (registered once on ready)

        std::chrono::steady_clock::duration connect_backoff{CONNECT_RETRY_INITIAL};
        std::chrono::steady_clock::time_point next_connect_retry{};
        std::chrono::steady_clock::time_point next_registry_refresh{};

        void post(std::function<void()> task)
        {
            tasks.access([&task](std::deque<std::function<void()>>& queue)
            {
                queue.push_back(std::move(task));
            });
        }

        void set_status(const link_status status, const std::string& error = {})
        {
            state->access([&](shared_state& s)
            {
                s.status = status;
                s.last_error = error;
            });
            this->update_joinable();
        }

        link_status current_status() const
        {
            return state->access<link_status>([](const shared_state& s)
            {
                return s.status;
            });
        }

        // Mirrors "can we invite right now" into shared state for the frontend.
        void update_joinable()
        {
            const bool joinable = this->current_activity && this->current_activity->rich
                && !this->current_activity->join_secret.empty()
                && this->current_status() == link_status::linked;

            this->state->access([joinable](shared_state& s)
            {
                s.joinable = joinable;
            });
        }

        // Republishes the current game activity (on set and on reconnect) so presence survives SDK reconnects.
        void publish_activity()
        {
            this->update_joinable();

            if (!this->client || this->current_status() != link_status::linked || !this->current_activity)
            {
                return;
            }

            const auto& a = *this->current_activity;

            discordpp::Activity activity{};
            activity.SetType(discordpp::ActivityTypes::Playing);

            if (a.rich)
            {
                activity.SetDetails(clamp_field(build_rich_details(a.display_name, a.gametype, a.map_display)));
                activity.SetState(clamp_field(build_rich_state(a.mode, a.map_display, a.server_name)));

                const bool joinable = !a.join_secret.empty();
                if (a.max_players > 0 || joinable)
                {
                    const int size = a.players > 0 ? a.players : 1;
                    int max = a.max_players > 0 ? a.max_players : size;
                    if (joinable && max <= size)
                    {
                        max = size + 1; // a joinable party must have room for the invitee
                    }

                    // Id is unique per host; when joinable its prefix encodes direct (public => "Join") vs nat (private => "Ask to Join").
                    const auto uid = this->own_user_id();
                    const auto party_base = (uid != 0 ? std::to_string(uid) : std::string("cbl")) + "-" + a.game_id;

                    discordpp::ActivityParty party{};
                    if (joinable)
                    {
                        const auto* prefix = a.direct_join ? PARTY_JOIN_DIRECT_PREFIX : PARTY_JOIN_REQUEST_PREFIX;
                        party.SetId(prefix + party_base);
                        // Public => Discord shows "Join"; private stays Private => "Ask to Join" (host approves).
                        party.SetPrivacy(a.direct_join ? discordpp::ActivityPartyPrivacy::Public
                                                       : discordpp::ActivityPartyPrivacy::Private);
                    }
                    else
                    {
                        party.SetId(party_base);
                    }
                    party.SetCurrentSize(size);
                    party.SetMaxSize(max);
                    activity.SetParty(std::move(party));
                }

                if (joinable)
                {
                    discordpp::ActivitySecrets secrets{};
                    secrets.SetJoin(a.join_secret);
                    activity.SetSecrets(std::move(secrets));
                }
            }
            else
            {
                activity.SetDetails(a.display_name);

                if (const auto mode_name = mode_display_name(a.mode); !mode_name.empty())
                {
                    activity.SetState(mode_name);
                }
            }

            discordpp::ActivityAssets assets{};
            assets.SetLargeImage(presence_art_url(a.game_id));
            assets.SetLargeText(a.display_name);
            activity.SetAssets(assets);

            discordpp::ActivityTimestamps timestamps{};
            timestamps.SetStart(static_cast<uint64_t>(a.start_time));
            activity.SetTimestamps(timestamps);

            this->client->UpdateRichPresence(std::move(activity), [](const discordpp::ClientResult&)
            {
            });
        }

        void apply_clear_activity()
        {
            this->current_activity.reset();
            if (this->client && this->current_status() == link_status::linked)
            {
                this->client->ClearRichPresence();
            }
            this->update_joinable();
        }

        void fail_with_retry(const std::string& error)
        {
            utils::logger::write("Discord connection error: {}", error);
            this->set_status(link_status::error, error);
            this->next_connect_retry = std::chrono::steady_clock::now() + this->connect_backoff;
            this->connect_backoff =
                std::min<std::chrono::steady_clock::duration>(this->connect_backoff * 2, CONNECT_RETRY_MAX);
        }

        bool load_sdk() const
        {
            if constexpr (APPLICATION_ID == 0)
            {
                return false;
            }
            else
            {
                const auto path = utils::properties::get_appdata_path() / "data" / "discord";
                utils::nt::library::add_dll_directory(path);

                return utils::nt::library::load(path / "discord_partner_sdk.dll")
                    && utils::nt::library::delay_load("discord_partner_sdk.dll"s);
            }
        }

        void setup_callbacks()
        {
            this->client->SetStatusChangedCallback(
                [this](const discordpp::Client::Status status, discordpp::Client::Error, int32_t)
                {
                    this->on_connection_status(status);
                });

            this->client->SetRelationshipCreatedCallback([this](uint64_t, bool)
            {
                this->rebuild_friends();
                this->next_registry_refresh = std::chrono::steady_clock::now();
            });

            this->client->SetRelationshipDeletedCallback([this](uint64_t, bool)
            {
                this->rebuild_friends();
            });

            this->client->SetUserUpdatedCallback([this](uint64_t)
            {
                this->rebuild_friends();
            });

            this->client->SetActivityInviteCreatedCallback([this](const discordpp::ActivityInvite& invite)
            {
                this->on_invite(invite);
            });

            this->client->SetActivityInviteUpdatedCallback([this](const discordpp::ActivityInvite& invite)
            {
                // The only mutable field is validity; drop invites that expired or whose sender stopped playing.
                if (!invite.IsValid())
                {
                    printf("[cbl-invite] invite from %llu invalidated; dropping\n",
                           static_cast<unsigned long long>(invite.SenderId()));
                    fflush(stdout);
                    this->remove_invite(std::to_string(invite.SenderId()));
                }
            });

            // Fired when the user accepts via the Discord client (DM "Join"); routes the same cbl: secret as the in-launcher accept path.
            this->client->SetActivityJoinCallback([this](const std::string& secret)
            {
                printf("[cbl-invite] SetActivityJoinCallback (Discord DM accept) secret='%s'\n", secret.data());
                fflush(stdout);
                if (this->join_secret_cb && !secret.empty())
                {
                    this->join_secret_cb(secret);
                }
            });
        }

        uint64_t own_user_id() const
        {
            if (const auto self = this->client->GetCurrentUserV2())
            {
                return self->Id();
            }
            return 0;
        }

        // True when our match is a public/dedicated server: join requests need no approval (auto-approved, not prompted).
        bool hosting_public_match() const
        {
            return this->current_activity && this->current_activity->rich
                && !this->current_activity->join_secret.empty()
                && this->current_activity->direct_join;
        }

        // Accept an invite addressed to us and route the resulting join secret into the game.
        void accept_join_invite(const discordpp::ActivityInvite& invite)
        {
            this->client->AcceptActivityInvite(invite,
                [i = this](const discordpp::ClientResult& result, const std::string& secret)
                {
                    printf("[cbl-invite] AcceptActivityInvite: %s, secret='%s'\n",
                           result.Successful() ? "ok" : result.ToString().data(), secret.data());
                    fflush(stdout);
                    if (result.Successful() && i->join_secret_cb && !secret.empty())
                    {
                        i->join_secret_cb(secret);
                    }
                });
        }

        void on_invite(const discordpp::ActivityInvite& invite)
        {
            const auto sender = invite.SenderId();
            const bool is_request = invite.Type() == discordpp::ActivityActionTypes::JoinRequest;
            const auto own = this->own_user_id();

            printf("[cbl-invite] on_invite sender=%llu own=%llu type=%s valid=%d\n",
                   static_cast<unsigned long long>(sender), static_cast<unsigned long long>(own),
                   is_request ? "join-request" : "invite", invite.IsValid() ? 1 : 0);
            fflush(stdout);

            if (!invite.IsValid())
            {
                return;
            }

            // The created callback also fires on the sender's own client; only surface invites addressed to us.
            if (own != 0 && sender == own)
            {
                printf("[cbl-invite] ignoring our own outgoing invite\n");
                fflush(stdout);
                return;
            }

            // A host approving a join we asked for (within the TTL) prompts as an approval, not auto-join.
            bool is_approval = false;
            if (!is_request)
            {
                const auto it = this->pending_join_requests.find(sender);
                if (it != this->pending_join_requests.end())
                {
                    is_approval = (std::chrono::steady_clock::now() - it->second) < JOIN_REQUEST_TTL;
                    this->pending_join_requests.erase(it);
                }
            }

            // Public/dedicated server: approve join requests immediately (private host matches still queue for approval below).
            if (is_request && this->hosting_public_match())
            {
                printf("[cbl-invite] auto-approving join-request from %llu (public match)\n",
                       static_cast<unsigned long long>(sender));
                fflush(stdout);
                this->client->SendActivityJoinRequestReply(invite, [sender](const discordpp::ClientResult& result)
                {
                    printf("[cbl-invite] auto join-request reply to %llu: %s\n",
                           static_cast<unsigned long long>(sender),
                           result.Successful() ? "ok" : result.ToString().data());
                    fflush(stdout);
                });
                return;
            }

            const auto sender_id = std::to_string(sender);
            this->invite_objs[sender_id] = invite;

            this->state->access([&](shared_state& s)
            {
                invite_entry entry{};
                entry.id = sender_id;
                entry.sender_id = sender_id;
                entry.is_request = is_request;
                entry.is_approval = is_approval;

                // Resolve a friendly name/avatar from the friends cache if we have it.
                for (const auto& f : s.friends)
                {
                    if (f.id == sender_id)
                    {
                        entry.sender_name = f.display_name;
                        entry.sender_avatar = f.avatar_url;
                        break;
                    }
                }

                std::erase_if(s.invites, [&](const invite_entry& e) { return e.id == sender_id; });
                s.invites.push_back(std::move(entry));
            });

            printf("[cbl-invite] queued incoming %s from %s for the in-launcher prompt\n",
                   is_request ? "join-request" : (is_approval ? "request-approval" : "invite"), sender_id.data());
            fflush(stdout);
        }

        void remove_invite(const std::string& id)
        {
            this->invite_objs.erase(id);
            this->state->access([&id](shared_state& s)
            {
                std::erase_if(s.invites, [&id](const invite_entry& e) { return e.id == id; });
            });
        }

        void on_connection_status(const discordpp::Client::Status status)
        {
            if (status == discordpp::Client::Status::Ready)
            {
                this->connect_backoff = CONNECT_RETRY_INITIAL;
                this->on_ready();
                return;
            }

            if (status == discordpp::Client::Status::Disconnected)
            {
                if (this->unlinking)
                {
                    this->unlinking = false;
                    this->set_status(link_status::unlinked);
                }
                else if (this->have_tokens)
                {
                    this->fail_with_retry("Disconnected from Discord");
                }
            }
        }

        void try_silent_connect()
        {
            const auto tokens = token_store::load();
            if (!tokens)
            {
                this->have_tokens = false;
                this->set_status(link_status::unlinked);
                return;
            }

            this->have_tokens = true;
            this->set_status(link_status::connecting);

            // Access tokens expire after ~7 days; refresh unconditionally on startup rather than tracking expiry.
            this->client->RefreshToken(
                APPLICATION_ID, tokens->refresh_token,
                [this](const discordpp::ClientResult& result, std::string access_token, std::string refresh_token,
                       discordpp::AuthorizationTokenType, const int32_t expires_in, std::string)
                {
                    this->handle_token_exchange(result, access_token, refresh_token, expires_in, true);
                });
        }

        void begin_link_flow()
        {
            utils::logger::write("Discord link started");

            const auto verifier = this->client->CreateAuthorizationCodeVerifier();

            discordpp::AuthorizationArgs args{};
            args.SetClientId(APPLICATION_ID);
            args.SetScopes(discordpp::Client::GetDefaultPresenceScopes());
            args.SetCodeChallenge(verifier.Challenge());

            this->client->Authorize(
                args,
                [this, verifier](const discordpp::ClientResult& result, std::string code, std::string redirect_uri)
                {
                    if (!result.Successful())
                    {
                        const auto error = result.ToString();
                        utils::logger::write("Discord authorize failed: {}", error);
                        this->set_status(link_status::unlinked, error);
                        return;
                    }

                    utils::logger::write("Discord authorize ok, exchanging code");

                    this->client->GetToken(
                        APPLICATION_ID, code, verifier.Verifier(), redirect_uri,
                        [this](const discordpp::ClientResult& token_result, std::string access_token,
                               std::string refresh_token, discordpp::AuthorizationTokenType, const int32_t expires_in,
                               std::string)
                        {
                            this->handle_token_exchange(token_result, access_token, refresh_token, expires_in, false);
                        });
                });
        }

        void handle_token_exchange(const discordpp::ClientResult& result, const std::string& access_token,
                                   const std::string& refresh_token, const int32_t expires_in, const bool from_refresh)
        {
            if (!result.Successful())
            {
                const auto error = result.ToString();
                const auto retryable = result.Type() == discordpp::ErrorType::NetworkError || result.Retryable();
                if (from_refresh && retryable)
                {
                    this->fail_with_retry(error);
                }
                else
                {
                    utils::logger::write("Discord token exchange failed: {}", error);
                    token_store::clear();
                    this->have_tokens = false;
                    this->set_status(link_status::unlinked, error);
                }

                return;
            }

            utils::logger::write("Discord token exchange ok, connecting");

            token_store::tokens tokens{};
            tokens.access_token = access_token;
            tokens.refresh_token = refresh_token;
            tokens.expires_at = static_cast<int64_t>(std::time(nullptr)) + expires_in;
            token_store::save(tokens);
            this->have_tokens = true;

            this->state->access([&access_token](shared_state& s)
            {
                s.access_token = access_token;
            });

            this->set_status(link_status::connecting);

            this->client->UpdateToken(discordpp::AuthorizationTokenType::Bearer, access_token,
                                      [this](const discordpp::ClientResult& update_result)
                                      {
                                          if (!update_result.Successful())
                                          {
                                              this->fail_with_retry(update_result.ToString());
                                              return;
                                          }

                                          this->client->Connect();
                                      });
        }

        void on_ready()
        {
            std::optional<own_profile> profile{};

            const auto user = this->client->GetCurrentUserV2();
            if (user)
            {
                own_profile p{};
                p.id = std::to_string(user->Id());
                p.display_name = user->DisplayName();
                p.avatar_url = avatar_url_for(*user);
                profile = std::move(p);

                const auto lock = utils::properties::lock();
                utils::properties::store(property_keys::DISCORD_USER_ID, profile->id);
                utils::properties::store(property_keys::DISCORD_DISPLAY_NAME, profile->display_name);
            }

            utils::logger::write("Discord connected as {}", profile ? profile->display_name : "<unknown>");

            // Register cold-launch so Discord can start us on invite-accept while closed (empty => current exe); the join arrives via SetActivityJoinCallback on reconnect.
            if (!this->launch_command_registered)
            {
                const bool ok = this->client->RegisterLaunchCommand(APPLICATION_ID, "");
                this->launch_command_registered = ok;
                printf("[cbl-invite] RegisterLaunchCommand: %s\n", ok ? "ok" : "failed");
                fflush(stdout);
            }

            std::string access_token{};
            this->state->access([&](shared_state& s)
            {
                s.status = link_status::linked;
                s.last_error.clear();
                s.profile = profile;
                access_token = s.access_token;
            });

            this->rebuild_friends();

            // Republish presence if a game was launched before/while connecting.
            this->publish_activity();

            if (!access_token.empty())
            {
                std::thread([access_token]()
                {
                    link_registry::register_link(access_token);
                }).detach();
            }

            this->next_registry_refresh = std::chrono::steady_clock::now();
        }

        void rebuild_friends()
        {
            if (!this->client)
            {
                return;
            }

            std::unordered_set<uint64_t> in_launcher{};
            for (const auto& relationship :
                 this->client->GetRelationshipsByGroup(discordpp::RelationshipGroupType::OnlinePlayingGame))
            {
                const auto user = relationship.User();
                if (user)
                {
                    in_launcher.insert(user->Id());
                }
            }

            std::vector<friend_entry> friends{};
            for (const auto& relationship : this->client->GetRelationships())
            {
                if (relationship.DiscordRelationshipType() != discordpp::RelationshipType::Friend)
                {
                    continue;
                }

                const auto user = relationship.User();
                if (!user)
                {
                    continue;
                }

                friend_entry entry{};
                entry.id = std::to_string(user->Id());
                entry.display_name = user->DisplayName();
                entry.avatar_url = avatar_url_for(*user);
                entry.status = map_status(user->Status());
                entry.in_launcher = in_launcher.contains(user->Id());

                // GameActivity() only exposes presence under our app id (friends playing through the launcher).
                if (const auto activity = user->GameActivity())
                {
                    entry.activity_details = activity->Details().value_or("");
                    entry.activity_state = activity->State().value_or("");

                    // Joinable => party Id carries a join prefix and there is room; the prefix also encodes direct ("Join") vs request ("Ask to Join").
                    if (const auto party = activity->Party())
                    {
                        const auto party_id = party->Id();
                        const bool direct = party_id.rfind(PARTY_JOIN_DIRECT_PREFIX, 0) == 0;
                        const bool request = party_id.rfind(PARTY_JOIN_REQUEST_PREFIX, 0) == 0;
                        const bool has_room = party->CurrentSize() < party->MaxSize();
                        entry.joinable = (direct || request) && has_room;
                        entry.direct_join = direct && has_room;
                    }
                }

                friends.push_back(std::move(entry));
            }

            this->state->access([&friends](shared_state& s)
            {
                for (auto& entry : friends)
                {
                    entry.linked = s.linked_ids.contains(entry.id);
                }

                s.friends = std::move(friends);
            });
        }

        void start_registry_refresh()
        {
            auto expected = false;
            if (!this->registry_inflight->compare_exchange_strong(expected, true))
            {
                return;
            }

            std::string access_token{};
            std::vector<std::string> ids{};
            this->state->access([&](const shared_state& s)
            {
                access_token = s.access_token;
                ids.reserve(s.friends.size());
                for (const auto& entry : s.friends)
                {
                    ids.push_back(entry.id);
                }
            });

            if (access_token.empty())
            {
                this->registry_inflight->store(false);
                return;
            }

            // Shared ownership keeps the state alive for the worker thread
            auto state_ref = this->state;
            auto inflight = this->registry_inflight;

            std::thread([state_ref, inflight, access_token = std::move(access_token), ids = std::move(ids)]()
            {
                const auto linked = link_registry::intersect(access_token, ids);

                state_ref->access([&linked](shared_state& s)
                {
                    if (linked)
                    {
                        s.linked_ids.clear();
                        s.linked_ids.insert(linked->begin(), linked->end());
                        s.registry_succeeded = true;

                        for (auto& entry : s.friends)
                        {
                            entry.linked = s.linked_ids.contains(entry.id);
                        }
                    }
                    // On failure the previous cache (if any) is kept
                });

                inflight->store(false);
            }).detach();
        }

        void unlink_flow()
        {
            const auto tokens = token_store::load();

            token_store::clear();
            this->have_tokens = false;
            this->unlinking = true;

            {
                const auto lock = utils::properties::lock();
                utils::properties::store(property_keys::DISCORD_USER_ID, "");
                utils::properties::store(property_keys::DISCORD_DISPLAY_NAME, "");
            }

            this->invite_objs.clear();
            this->state->access([](shared_state& s)
            {
                s.status = link_status::unlinked;
                s.last_error.clear();
                s.profile.reset();
                s.friends.clear();
                s.linked_ids.clear();
                s.access_token.clear();
                s.registry_succeeded = false;
                s.invites.clear();
                s.joinable = false;
            });

            if (tokens)
            {
                const auto access_token = tokens->access_token;
                const auto refresh_token = tokens->refresh_token;

                this->client->RevokeToken(APPLICATION_ID, refresh_token, [](const discordpp::ClientResult&)
                {
                });
                this->client->Disconnect();

                // Token-only capture so this worker cannot outlive the service impl.
                std::thread([access_token]()
                {
                    link_registry::unregister_link(access_token);
                }).detach();
            }
            else
            {
                this->client->Disconnect();
            }
        }

        void run()
        {
            if (!this->load_sdk())
            {
                this->set_status(link_status::unavailable);
                return;
            }

            this->client = std::make_shared<discordpp::Client>();
            this->setup_callbacks();
            this->try_silent_connect();

            while (this->running)
            {
                std::deque<std::function<void()>> pending{};
                this->tasks.access([&pending](std::deque<std::function<void()>>& queue)
                {
                    pending.swap(queue);
                });

                for (auto& task : pending)
                {
                    task();
                }

                discordpp::RunCallbacks();

                const auto now = std::chrono::steady_clock::now();
                const auto status = this->current_status();

                if (status == link_status::error && this->have_tokens && now >= this->next_connect_retry)
                {
                    this->try_silent_connect();
                }

                if (status == link_status::linked && now >= this->next_registry_refresh)
                {
                    this->next_registry_refresh = now + REGISTRY_REFRESH_INTERVAL;
                    this->start_registry_refresh();
                }

                // Notify on ownership change so the IPC server can hand presence to/from the fork.
                const bool owns = (status == link_status::linked);
                if (owns != this->last_owns)
                {
                    this->last_owns = owns;
                    if (this->ownership_cb)
                    {
                        this->ownership_cb(owns);
                    }
                }

                std::this_thread::sleep_for(TICK_INTERVAL);
            }

            this->client.reset();
        }
    };

    discord_service& discord_service::instance()
    {
        static discord_service service{};
        return service;
    }

    discord_service::discord_service()
        : impl_(std::make_unique<impl>())
    {
    }

    discord_service::~discord_service()
    {
        this->stop();
    }

    void discord_service::start()
    {
        if (this->impl_->running.exchange(true))
        {
            return;
        }

        this->impl_->thread = std::thread([this]()
        {
            this->impl_->run();
        });
    }

    void discord_service::stop()
    {
        if (!this->impl_->running.exchange(false))
        {
            return;
        }

        if (this->impl_->thread.joinable())
        {
            this->impl_->thread.join();
        }
    }

    void discord_service::begin_link()
    {
        // Flip synchronously so the frontend's next status poll is not racing the queued flow.
        auto accepted = false;
        this->impl_->state->access([&accepted](shared_state& s)
        {
            if (s.status == link_status::unlinked || s.status == link_status::error)
            {
                s.status = link_status::linking;
                s.last_error.clear();
                accepted = true;
            }
        });

        if (!accepted)
        {
            return;
        }

        this->impl_->post([i = this->impl_.get()]()
        {
            i->begin_link_flow();
        });
    }

    void discord_service::unlink()
    {
        this->impl_->post([i = this->impl_.get()]()
        {
            i->unlink_flow();
        });
    }

    void discord_service::set_game_activity(const std::string& game_id, const std::string& display_name,
                                            const std::string& mode)
    {
        impl::game_activity activity{};
        activity.game_id = game_id;
        activity.display_name = display_name;
        activity.mode = mode;
        activity.start_time = static_cast<int64_t>(std::time(nullptr));

        this->impl_->post([i = this->impl_.get(), activity = std::move(activity)]() mutable
        {
            i->current_activity = std::move(activity);
            i->publish_activity();
        });
    }

    void discord_service::clear_activity()
    {
        this->impl_->post([i = this->impl_.get()]()
        {
            i->apply_clear_activity();
        });
    }

    void discord_service::set_rich_game_activity(const std::string& game_id, const std::string& display_name,
                                                 const std::string& mode, const rich_presence_info& info)
    {
        impl::game_activity activity{};
        activity.game_id = game_id;
        activity.display_name = display_name;
        activity.mode = mode;
        activity.rich = true;
        activity.map_display = info.map_display;
        activity.gametype = info.gametype;
        activity.server_name = info.server_name;
        activity.players = info.players;
        activity.max_players = info.max_players;
        activity.join_secret = info.join_secret;
        activity.direct_join = info.direct_join;

        this->impl_->post([i = this->impl_.get(), activity = std::move(activity)]() mutable
        {
            // Preserve the elapsed timer across presence updates for the same game.
            if (i->current_activity && i->current_activity->game_id == activity.game_id &&
                i->current_activity->start_time != 0)
            {
                activity.start_time = i->current_activity->start_time;
            }
            else
            {
                activity.start_time = static_cast<int64_t>(std::time(nullptr));
            }

            i->current_activity = std::move(activity);
            i->publish_activity();
        });
    }

    void discord_service::clear_rich_activity()
    {
        this->impl_->post([i = this->impl_.get()]()
        {
            if (!i->current_activity)
            {
                return;
            }

            auto& a = *i->current_activity;
            a.rich = false;
            a.map_display.clear();
            a.gametype.clear();
            a.server_name.clear();
            a.players = 0;
            a.max_players = 0;
            a.join_secret.clear();

            i->publish_activity();
        });
    }

    bool discord_service::owns_presence() const
    {
        return this->impl_->state->access<bool>([](const shared_state& s)
        {
            return s.status == link_status::linked;
        });
    }

    void discord_service::set_presence_owner_callback(std::function<void(bool)> callback)
    {
        this->impl_->post([i = this->impl_.get(), callback = std::move(callback)]() mutable
        {
            i->ownership_cb = std::move(callback);

            // Sync the listener with the current state immediately.
            i->last_owns = (i->current_status() == link_status::linked);
            if (i->ownership_cb)
            {
                i->ownership_cb(i->last_owns);
            }
        });
    }

    bool discord_service::is_joinable() const
    {
        return this->impl_->state->access<bool>([](const shared_state& s)
        {
            return s.joinable;
        });
    }

    void discord_service::send_invite(const std::string& user_id)
    {
        this->impl_->post([i = this->impl_.get(), user_id]()
        {
            if (!i->client || i->current_status() != link_status::linked)
            {
                return;
            }

            const auto uid = std::strtoull(user_id.data(), nullptr, 10);
            if (uid == 0)
            {
                printf("[cbl-invite] send_invite: bad user id '%s'\n", user_id.data());
                fflush(stdout);
                return;
            }

            printf("[cbl-invite] send_invite -> %llu\n", static_cast<unsigned long long>(uid));
            fflush(stdout);

            i->client->SendActivityInvite(uid, "Join my game on CB Servers",
                                          [uid](const discordpp::ClientResult& result)
            {
                printf("[cbl-invite] SendActivityInvite to %llu: %s\n",
                       static_cast<unsigned long long>(uid),
                       result.Successful() ? "ok" : result.ToString().data());
                fflush(stdout);
            });
        });
    }

    void discord_service::request_join(const std::string& user_id)
    {
        this->impl_->post([i = this->impl_.get(), user_id]()
        {
            if (!i->client || i->current_status() != link_status::linked)
            {
                return;
            }

            const auto uid = std::strtoull(user_id.data(), nullptr, 10);
            if (uid == 0)
            {
                printf("[cbl-invite] request_join: bad user id '%s'\n", user_id.data());
                fflush(stdout);
                return;
            }

            printf("[cbl-invite] request_join -> %llu\n", static_cast<unsigned long long>(uid));
            fflush(stdout);

            // Remember we asked so the host's approval (an incoming Join invite) prompts as an approval, not an unsolicited invite.
            i->pending_join_requests[uid] = std::chrono::steady_clock::now();

            i->client->SendActivityJoinRequest(uid, [uid](const discordpp::ClientResult& result)
            {
                printf("[cbl-invite] SendActivityJoinRequest to %llu: %s\n",
                       static_cast<unsigned long long>(uid),
                       result.Successful() ? "ok" : result.ToString().data());
                fflush(stdout);
            });
        });
    }

    std::vector<invite_entry> discord_service::get_invites() const
    {
        return this->impl_->state->access<std::vector<invite_entry>>([](const shared_state& s)
        {
            return s.invites;
        });
    }

    void discord_service::accept_invite(const std::string& id)
    {
        this->impl_->post([i = this->impl_.get(), id]()
        {
            const auto it = i->invite_objs.find(id);
            if (it == i->invite_objs.end() || !i->client)
            {
                printf("[cbl-invite] accept_invite: no pending invite for id '%s'\n", id.data());
                fflush(stdout);
                return;
            }

            const auto invite = it->second;

            // Their request to join us => approve it; their invite to us => accept and route the secret.
            if (invite.Type() == discordpp::ActivityActionTypes::JoinRequest)
            {
                printf("[cbl-invite] accept_invite: approving join-request from %s\n", id.data());
                fflush(stdout);
                i->client->SendActivityJoinRequestReply(invite, [id](const discordpp::ClientResult& result)
                {
                    printf("[cbl-invite] join-request reply to %s: %s\n", id.data(),
                           result.Successful() ? "ok" : result.ToString().data());
                    fflush(stdout);
                });
            }
            else
            {
                printf("[cbl-invite] accept_invite: accepting invite from %s\n", id.data());
                fflush(stdout);
                i->accept_join_invite(invite);
            }

            i->remove_invite(id);
        });
    }

    void discord_service::decline_invite(const std::string& id)
    {
        this->impl_->post([i = this->impl_.get(), id]()
        {
            i->remove_invite(id);
        });
    }

    void discord_service::set_join_secret_callback(std::function<void(std::string)> callback)
    {
        this->impl_->post([i = this->impl_.get(), callback = std::move(callback)]() mutable
        {
            i->join_secret_cb = std::move(callback);
        });
    }

    link_status discord_service::get_status() const
    {
        return this->impl_->state->access<link_status>([](const shared_state& s)
        {
            return s.status;
        });
    }

    std::optional<own_profile> discord_service::get_profile() const
    {
        return this->impl_->state->access<std::optional<own_profile>>([](const shared_state& s)
        {
            return s.profile;
        });
    }

    std::string discord_service::get_last_error() const
    {
        return this->impl_->state->access<std::string>([](const shared_state& s)
        {
            return s.last_error;
        });
    }

    std::vector<friend_entry> discord_service::get_friends() const
    {
        return this->impl_->state->access<std::vector<friend_entry>>([](const shared_state& s)
        {
            return s.friends;
        });
    }

    bool discord_service::registry_ok() const
    {
        return this->impl_->state->access<bool>([](const shared_state& s)
        {
            return s.registry_succeeded;
        });
    }
}
