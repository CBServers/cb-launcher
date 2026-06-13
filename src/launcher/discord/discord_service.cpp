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

#include <ctime>
#include <deque>
#include <unordered_set>

namespace discord
{
    namespace
    {
        constexpr auto REGISTRY_REFRESH_INTERVAL = 5min;
        constexpr auto CONNECT_RETRY_INITIAL = 30s;
        constexpr auto CONNECT_RETRY_MAX = 10min;
        constexpr auto TICK_INTERVAL = 16ms;

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
        }

        link_status current_status() const
        {
            return state->access<link_status>([](const shared_state& s)
            {
                return s.status;
            });
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

            // Access tokens expire after ~7 days; unconditionally refreshing
            // on startup is simpler than tracking expiry.
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

            std::string access_token{};
            this->state->access([&](shared_state& s)
            {
                s.status = link_status::linked;
                s.last_error.clear();
                s.profile = profile;
                access_token = s.access_token;
            });

            this->rebuild_friends();

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

            this->state->access([](shared_state& s)
            {
                s.status = link_status::unlinked;
                s.last_error.clear();
                s.profile.reset();
                s.friends.clear();
                s.linked_ids.clear();
                s.access_token.clear();
                s.registry_succeeded = false;
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
