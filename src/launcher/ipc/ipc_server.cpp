#include "std_include.hpp"
#include "ipc_server.hpp"

#include "commands/game_commands.hpp"
#include "discord/discord_service.hpp"
#include "social/cbfriends_service.hpp"
#include "game_config.hpp"
#include "join_secret.hpp"
#include "pipe_listener.hpp"

#include <utils/concurrency.hpp>
#include <utils/logger.hpp>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <deque>
#include <optional>
#include <utility>

namespace ipc
{
    namespace
    {
        constexpr auto* PIPE_NAME = L"\\\\.\\pipe\\cbservers-launcher";
        constexpr int PROTOCOL_VERSION = 1;

        std::string json_string(const rapidjson::Value& value, const char* key)
        {
            if (value.HasMember(key) && value[key].IsString())
            {
                return value[key].GetString();
            }
            return {};
        }

        int json_int(const rapidjson::Value& value, const char* key)
        {
            if (value.HasMember(key) && value[key].IsInt())
            {
                return value[key].GetInt();
            }
            return 0;
        }

        bool json_bool(const rapidjson::Value& value, const char* key)
        {
            return value.HasMember(key) && value[key].IsBool() && value[key].GetBool();
        }

        // Serializes one JSON object via rapidjson (auto-escapes string values); caller adds the newline.
        template <typename F>
        std::string build_json_object(F&& fill)
        {
            rapidjson::StringBuffer buffer;
            rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
            writer.StartObject();
            fill(writer);
            writer.EndObject();
            return std::string(buffer.GetString(), buffer.GetSize());
        }

        // Reads a presence/connect transport object into a unified-secret transport. False => not joinable.
        bool parse_transport(const rapidjson::Value& parent, join_secret::transport& out)
        {
            if (!parent.HasMember("transport") || !parent["transport"].IsObject())
            {
                return false;
            }

            const auto& t = parent["transport"];
            const auto kind = json_string(t, "kind");
            if (kind == "direct")
            {
                out.kind = join_secret::transport::kind_t::direct;
                out.ip = json_string(t, "ip");
                out.port = json_int(t, "port");
                return !out.ip.empty() && out.port > 0;
            }
            if (kind == "session")
            {
                out.kind = join_secret::transport::kind_t::session;
                out.session_host = json_string(t, "host");
                out.session_key = json_string(t, "key");
                out.session_id = json_string(t, "id");
                // The fork's connect command takes these as arguments, so they ride the secret too.
                out.session_map = json_string(t, "map");
                out.session_gametype = json_string(t, "gametype");
                out.session_max_players = json_int(t, "maxPlayers");
                return !out.session_host.empty() && !out.session_key.empty() && !out.session_id.empty();
            }
            if (kind == "nat")
            {
                out.kind = join_secret::transport::kind_t::nat;
                out.token = json_string(t, "token");
                if (t.HasMember("rendezvous") && t["rendezvous"].IsObject())
                {
                    out.rendezvous_host = json_string(t["rendezvous"], "host");
                    out.rendezvous_port = json_int(t["rendezvous"], "port");
                }
                if (t.HasMember("fallback") && t["fallback"].IsObject())
                {
                    out.fallback_ip = json_string(t["fallback"], "ip");
                    out.fallback_port = json_int(t["fallback"], "port");
                }
                return !out.token.empty() && !out.rendezvous_host.empty() && out.rendezvous_port > 0;
            }
            return false;
        }
    }

    struct ipc_server::impl
    {
        pipe::listener listener{};

        // Outbound launcher->client messages (presence-owner, connect), drained on the serve thread.
        HANDLE outbound_event{nullptr};
        utils::concurrency::container<std::deque<std::string>> outbound{};

        // Per-connection state. The launch barrier guarantees one game (one client) at a time.
        unsigned long connection_pid{0};
        std::string connection_game_id{};
        unsigned long last_rejected_pid{0}; // throttles logging for a fork that redials every 2s after a rejected hello

        // Connected fork's id + fixed launch mode, captured at hello (cross-thread); empty mode => always connect in place.
        struct connected_state
        {
            std::string game;
            std::string launch_mode;
        };
        utils::concurrency::container<connected_state> connected{};

        // A join awaiting the target fork's hello; the deadline backstops a launch that never connects.
        struct pending_join_entry
        {
            std::string game_id;
            join_secret::transport t;
            std::string mode; // invite's play mode; checked against the hello mode of fixed-mode forks
            std::chrono::steady_clock::time_point deadline;
        };
        utils::concurrency::container<std::optional<pending_join_entry>> pending_join{};
        std::atomic<unsigned int> connect_seq{0};

        // Dedup the same accepted join when Discord delivers it via multiple SDK callbacks.
        struct recent_join_state
        {
            std::string secret;
            std::chrono::steady_clock::time_point when{};
        };
        utils::concurrency::container<recent_join_state> recent_join{};

        // Last friends snapshot sent this connection; skips redundant pushes (touched cross-thread).
        utils::concurrency::container<std::string> last_friends_line{};

        template <typename Writer>
        static void write_discord_game(Writer& w, const discord::friend_entry& entry)
        {
            w.Key("game");
            w.StartObject();
            w.Key("id");         w.String(entry.game_id.data());
            w.Key("mode");       w.String(entry.game_mode.data());
            w.Key("map");        w.String(entry.game_map.data());
            w.Key("gametype");   w.String(entry.game_gametype.data());
            w.Key("joinable");   w.Bool(entry.joinable);
            w.Key("directJoin"); w.Bool(entry.direct_join);
            w.Key("openable");   w.Bool(entry.openable);
            w.Key("sameMatch");  w.Bool(entry.same_match);
            w.EndObject();
        }

        template <typename Writer>
        static void write_cb_game(Writer& w, const social::cb_person& f)
        {
            w.Key("game");
            w.StartObject();
            w.Key("id");         w.String(f.game.data());
            w.Key("mode");       w.String(f.mode.data());
            w.Key("map");        w.String(f.map_display.data());
            w.Key("gametype");   w.String(f.gametype.data());
            // Mirrors the Discord entry so the fork's game.joinable gate works unchanged.
            w.Key("joinable");   w.Bool(f.joinable);
            w.Key("directJoin"); w.Bool(f.direct_join);
            w.Key("openable");   w.Bool(f.openable);
            w.Key("sameMatch");  w.Bool(f.same_match);
            w.EndObject();
        }

        // The launcher-linked friends snapshot for the connected fork (see ipc-protocol.md "friends").
        // Someone on both lists is written once; "id" picks the rail (cb_ while online on CB) since forks route on it.
        static std::string build_friends_line()
        {
            auto& service = discord::discord_service::instance();
            const bool linked = service.get_status() == discord::link_status::linked;
            const auto registry_ok = service.registry_ok();

            const auto cb_friends = social::cbfriends_service::instance().get_friends().friends;
            std::unordered_map<std::string, size_t> cb_by_discord;
            for (size_t i = 0; i < cb_friends.size(); ++i)
            {
                if (!cb_friends[i].discord_id.empty())
                {
                    cb_by_discord.emplace(cb_friends[i].discord_id, i);
                }
            }
            std::vector<bool> merged(cb_friends.size(), false);

            return build_json_object([&](auto& w)
            {
                w.Key("type"); w.String("friends");
                w.Key("friends");
                w.StartArray();

                if (linked)
                {
                    for (const auto& entry : service.get_friends())
                    {
                        // Same visibility rule as the launcher UI: linked friends, falling back to
                        // provably-in-launcher friends while the registry hasn't answered yet.
                        const auto show = registry_ok ? entry.linked : entry.in_launcher;
                        if (!show)
                        {
                            continue;
                        }

                        const social::cb_person* cb = nullptr;
                        if (const auto it = cb_by_discord.find(entry.id); it != cb_by_discord.end())
                        {
                            cb = &cb_friends[it->second];
                            merged[it->second] = true;
                        }

                        const bool cb_in_game = cb && cb->online && !cb->game.empty();
                        const bool cb_online = cb && cb->online;
                        const bool discord_online = entry.status == "online" || entry.status == "idle";

                        w.StartObject();
                        w.Key("id");         w.String(cb_online ? cb->cb_id.data() : entry.id.data());
                        w.Key("name");       w.String(entry.display_name.data());
                        if (cb)
                        {
                            w.Key("handle");    w.String(cb->handle.data());
                            w.Key("cbId");      w.String(cb->cb_id.data());
                            w.Key("discordId"); w.String(entry.id.data());
                        }
                        const bool in_game = cb_in_game || !entry.game_id.empty();
                        w.Key("status");     w.String(in_game ? "online" : (cb_online || discord_online ? "idle" : "offline"));
                        w.Key("inLauncher"); w.Bool(entry.in_launcher || cb_online);
                        w.Key("source");     w.String("discord");

                        if (cb_in_game)
                        {
                            write_cb_game(w, *cb);
                        }
                        else if (!entry.game_id.empty())
                        {
                            write_discord_game(w, entry);
                        }

                        w.EndObject();
                    }
                }

                // CB-only friends alongside the Discord ones, tagged so the fork can group them.
                for (size_t i = 0; i < cb_friends.size(); ++i)
                {
                    if (merged[i])
                    {
                        continue;
                    }
                    const auto& f = cb_friends[i];

                    w.StartObject();
                    w.Key("id");         w.String(f.cb_id.data());
                    w.Key("name");       w.String(f.display_name.data());
                    w.Key("handle");     w.String(f.handle.data());
                    w.Key("cbId");       w.String(f.cb_id.data());
                    w.Key("status");     w.String(f.online ? (f.game.empty() ? "idle" : "online") : "offline");
                    w.Key("inLauncher"); w.Bool(f.online);
                    w.Key("source");     w.String("cb");

                    if (!f.game.empty())
                    {
                        write_cb_game(w, f);
                    }

                    w.EndObject();
                }

                w.EndArray();
            });
        }

        // Push the current snapshot if it changed since the last push on this connection.
        void push_friends_update()
        {
            const auto line = build_friends_line();
            const bool changed = this->last_friends_line.access<bool>([&line](std::string& last)
            {
                if (last == line)
                {
                    return false;
                }
                last = line;
                return true;
            });

            if (changed)
            {
                this->push_outbound(line + "\n");
            }
        }

        void push_outbound(std::string line)
        {
            this->outbound.access([&line](std::deque<std::string>& queue)
            {
                queue.push_back(std::move(line));
            });

            if (this->outbound_event)
            {
                SetEvent(this->outbound_event);
            }
        }

        void push_presence_owner(const bool launcher_owns)
        {
            this->push_outbound(build_json_object([&](auto& w)
            {
                w.Key("type");          w.String("presence-owner");
                w.Key("presenceOwner"); w.String(launcher_owns ? "launcher" : "client");
            }) + "\n");
        }

        // Tells the connected fork to join a server (invite for an already-running game).
        void send_connect(const join_secret::transport& t)
        {
            const auto id = "c-" + std::to_string(++this->connect_seq);

            const auto line = build_json_object([&](auto& w)
            {
                w.Key("type"); w.String("connect");
                w.Key("id");   w.String(id.data());
                w.Key("transport");
                w.StartObject();
                if (t.kind == join_secret::transport::kind_t::session)
                {
                    w.Key("kind");       w.String("session");
                    w.Key("host");       w.String(t.session_host.data());
                    w.Key("key");        w.String(t.session_key.data());
                    w.Key("id");         w.String(t.session_id.data());
                    w.Key("map");        w.String(t.session_map.data());
                    w.Key("gametype");   w.String(t.session_gametype.data());
                    w.Key("maxPlayers"); w.Int(t.session_max_players);
                }
                else if (t.kind == join_secret::transport::kind_t::nat)
                {
                    w.Key("kind");  w.String("nat");
                    w.Key("token"); w.String(t.token.data());
                    w.Key("rendezvous");
                    w.StartObject();
                    w.Key("host"); w.String(t.rendezvous_host.data());
                    w.Key("port"); w.Int(t.rendezvous_port);
                    w.EndObject();
                    w.Key("fallback");
                    w.StartObject();
                    w.Key("ip");   w.String(t.fallback_ip.data());
                    w.Key("port"); w.Int(t.fallback_port);
                    w.EndObject();
                }
                else
                {
                    w.Key("kind"); w.String("direct");
                    w.Key("ip");   w.String(t.ip.data());
                    w.Key("port"); w.Int(t.port);
                }
                w.EndObject();
            });

            const auto* kind_name = t.kind == join_secret::transport::kind_t::session ? "session"
                : (t.kind == join_secret::transport::kind_t::nat ? "nat" : "direct");
            utils::logger::write("[cbl-join] -> connect {} ({})", id, kind_name);
            this->push_outbound(line + "\n");
        }

        void flush_outbound(const HANDLE pipe)
        {
            std::deque<std::string> pending{};
            this->outbound.access([&pending](std::deque<std::string>& queue)
            {
                pending.swap(queue);
            });

            for (const auto& line : pending)
            {
                this->write_line(pipe, line);
            }
        }

        // Tracked launcher launch: drop to baseline (the exit watchdog owns the full clear); else clear fully.
        void on_disconnect()
        {
            this->connected.access([](connected_state& c) { c = {}; });

            auto& service = discord::discord_service::instance();
            if (!this->connection_game_id.empty() &&
                commands::game_commands::is_tracked_game_pid(this->connection_pid, this->connection_game_id))
            {
                service.clear_rich_activity();
            }
            else
            {
                service.clear_activity();
            }
            // The CB beat falls back to the fork's game, so this must clear too.
            social::cbfriends_service::instance().clear_rich_activity();
        }

        void serve_connection(const HANDLE pipe)
        {
            if (!GetNamedPipeClientProcessId(pipe, &this->connection_pid))
            {
                return;
            }
            this->connection_game_id.clear();

            // Drop any presence-owner sends queued while no client was connected; hello-ack carries the truth.
            this->outbound.access([](std::deque<std::string>& queue) { queue.clear(); });
            ResetEvent(this->outbound_event);

            std::string buffer{};
            char chunk[4096];

            while (this->listener.running())
            {
                // The outbound event is serviced while the read stays pending.
                DWORD read = 0;
                const bool ok = this->listener.read(pipe, chunk, sizeof(chunk), read,
                                                    this->outbound_event, [this, pipe] { this->flush_outbound(pipe); });
                if (!ok || read == 0)
                {
                    return;
                }

                buffer.append(chunk, read);

                size_t newline;
                while ((newline = buffer.find('\n')) != std::string::npos)
                {
                    auto line = buffer.substr(0, newline);
                    buffer.erase(0, newline + 1);
                    if (!line.empty() && line.back() == '\r')
                    {
                        line.pop_back();
                    }
                    if (!line.empty() && !this->handle_line(pipe, line))
                    {
                        return;
                    }
                }
            }
        }

        bool write_line(const HANDLE pipe, const std::string& data)
        {
            DWORD written = 0;
            return this->listener.write(pipe, data.data(), static_cast<DWORD>(data.size()), written);
        }

        // Returns false to close the connection (failed handshake), true to keep serving.
        bool handle_line(const HANDLE pipe, const std::string& line)
        {
            rapidjson::Document doc;
            doc.Parse(line.data(), line.size());
            if (doc.HasParseError() || !doc.IsObject())
            {
                return true; // ignore malformed
            }

            const auto type = json_string(doc, "type");
            if (type == "hello")
            {
                return this->handle_hello(pipe, doc);
            }
            if (type == "presence")
            {
                this->handle_presence(doc);
            }
            else if (type == "connect-ack")
            {
                const auto id = json_string(doc, "id");
                const auto accepted = doc.HasMember("accepted") && doc["accepted"].IsBool() && doc["accepted"].GetBool();
                utils::logger::write("[cbl-join] <- connect-ack {} accepted={}", id, accepted);
            }
            else if (type == "open-match-ack")
            {
                const auto opened = json_bool(doc, "opened");
                utils::logger::write("[cbl-join] <- open-match-ack opened={}", opened);
            }
            else if (type == "join-friend")
            {
                // In-game JOIN: ask the friend's host to let us in; the approval auto-accepts while
                // fresh and routes back to this fork as a connect message.
                const auto friend_id = json_string(doc, "friendId");
                utils::logger::write("[cbl-join] <- join-friend {}", friend_id);
                if (!friend_id.empty())
                {
                    // CB friends carry an opaque cb_ id and route over the CB rails.
                    if (friend_id.starts_with("cb_"))
                    {
                        social::cbfriends_service::instance().request_join(friend_id);
                    }
                    else
                    {
                        discord::discord_service::instance().request_join(friend_id);
                    }
                }
            }
            else if (type == "invite")
            {
                const auto friend_id = json_string(doc, "friendId");
                utils::logger::write("[cbl-invite] <- invite {}", friend_id);
                if (!friend_id.empty())
                {
                    if (friend_id.starts_with("cb_"))
                    {
                        social::cbfriends_service::instance().send_invite(friend_id);
                    }
                    else
                    {
                        discord::discord_service::instance().send_invite(friend_id);
                    }
                }
            }
            return true; // unknown types ignored (forward-compat)
        }

        bool handle_hello(const HANDLE pipe, const rapidjson::Document& doc)
        {
            const auto protocol = json_int(doc, "protocolVersion");
            const auto game = json_string(doc, "game");

            if (protocol <= 0 || protocol > PROTOCOL_VERSION || game.empty())
            {
                utils::logger::write("[cbl-ipc] rejecting hello (protocol {}, game '{}')", protocol, game);
                return false;
            }

            // Not a launcher-launched PID: try to adopt it (launcher restart / manual start) before rejecting.
            if (!commands::game_commands::is_tracked_game_pid(this->connection_pid, game)
                && !commands::game_commands::try_adopt_running_game(this->connection_pid, game))
            {
                const bool repeat = this->last_rejected_pid == this->connection_pid;
                this->last_rejected_pid = this->connection_pid;
                if (!repeat)
                {
#ifndef _DEBUG
                    utils::logger::write("[cbl-ipc] rejecting hello: pid {} not tracked or adoptable for '{}'",
                                         this->connection_pid, game);
#else
                    utils::logger::write("[cbl-ipc] pid {} not tracked or adoptable for '{}'; accepting anyway (debug)",
                                         this->connection_pid, game);
#endif
                }
#ifndef _DEBUG
                return false;
#endif
            }
            this->last_rejected_pid = 0;

            // Fixed launch mode from hello drives the relaunch decision; omitted by runtime-switchable forks.
            const auto hello_mode = json_string(doc, "mode");
            this->connection_game_id = game;
            this->connected.access([&](connected_state& c) { c.game = game; c.launch_mode = hello_mode; });

            const auto* owner = discord::discord_service::instance().owns_presence() ? "launcher" : "client";
            utils::logger::write("[cbl-join] hello from '{}' (pid {}); presenceOwner={}", game, this->connection_pid, owner);
            const auto ack = build_json_object([&](auto& w)
            {
                w.Key("type");            w.String("hello-ack");
                w.Key("protocolVersion"); w.Int(PROTOCOL_VERSION);
                w.Key("presenceOwner");   w.String(owner);
            }) + "\n";
            if (!this->write_line(pipe, ack))
            {
                return false;
            }

            // Fresh connection gets the current friends snapshot regardless of what was sent before.
            this->last_friends_line.access([](std::string& last) { last.clear(); });
            this->push_friends_update();

            this->fire_pending_join(game, hello_mode);
            return true;
        }

        // If an accept queued a join for this game, send the connect now that it has dialed in.
        void fire_pending_join(const std::string& game, const std::string& hello_mode)
        {
            std::optional<pending_join_entry> entry;
            this->pending_join.access([&](std::optional<pending_join_entry>& pj)
            {
                if (!pj)
                {
                    return;
                }
                if (std::chrono::steady_clock::now() > pj->deadline)
                {
                    pj.reset(); // stale (the launch never connected in time); drop it
                    return;
                }
                if (pj->game_id == game)
                {
                    entry = *pj;
                    pj.reset();
                }
            });

            if (!entry)
            {
                return;
            }

            utils::logger::write("[cbl-join] firing pending join for '{}' (invite mode '{}', hello mode '{}')",
                                 game, entry->mode, hello_mode);

            // A fixed-mode fork that came up in the wrong mode can't take this connect; relaunch into the invite's mode.
            const auto config = game_config::get_game_config_by_id(game);
            const bool target_is_real_mode = config && !entry->mode.empty()
                && config->mode_arguments.contains(entry->mode);
            if (target_is_real_mode && !hello_mode.empty() && entry->mode != hello_mode)
            {
                utils::logger::write("[cbl-join] hello from '{}' in mode '{}' but queued join is '{}'; relaunching",
                                     game, hello_mode, entry->mode);
                const auto mode = entry->mode;
                entry->mode.clear(); // one mode-correcting relaunch max; the next hello connects regardless
                entry->deadline = std::chrono::steady_clock::now() + std::chrono::minutes(10);
                this->pending_join.access([&](std::optional<pending_join_entry>& pj)
                {
                    if (!pj) // a join accepted in the meantime wins over the re-stash
                    {
                        pj = *entry;
                    }
                });
                commands::game_commands::relaunch_for_join(game, mode);
                return;
            }

            this->send_connect(entry->t);
        }

        void handle_presence(const rapidjson::Document& doc)
        {
            if (this->connection_game_id.empty())
            {
                return; // presence before handshake
            }

            const auto config = game_config::get_game_config_by_id(this->connection_game_id);
            if (!config)
            {
                return;
            }

            discord::discord_service::rich_presence_info info{};
            info.map_display = json_string(doc, "mapDisplay");
            info.gametype = json_string(doc, "gametype");
            info.server_name = json_string(doc, "serverName");
            info.players = json_int(doc, "players");
            info.max_players = json_int(doc, "maxPlayers");
            info.map_raw = json_string(doc, "map");
            info.gametype_raw = json_string(doc, "gametypeRaw");
            info.openable = json_bool(doc, "openable");
            info.match_id = json_string(doc, "matchId");

            // Live presence mode feeds only the Discord card and join secret, never the relaunch decision.
            const auto mode = json_string(doc, "mode");

            if (join_secret::transport transport{}; parse_transport(doc, transport))
            {
                info.join_secret = join_secret::build(this->connection_game_id, transport, mode, info.match_id);
                // A session invite names one lobby and is only sent deliberately, so no approval step.
                info.direct_join = transport.kind != join_secret::transport::kind_t::nat;
            }

            // Discord caps the join secret, so an oversized one is dropped there but kept for CB.
            auto discord_info = info;
            if (discord_info.join_secret.size() > join_secret::DISCORD_MAX_SECRET_LEN)
            {
                discord_info.join_secret.clear();
                discord_info.direct_join = false;
            }
            discord::discord_service::instance().set_rich_game_activity(
                this->connection_game_id, config->display_name, mode, discord_info);

            // The CB service publishes the flags and match details and keeps the secret for outgoing invites.
            social::cb_rich_activity cb_info{};
            cb_info.game = this->connection_game_id;
            cb_info.join_secret = info.join_secret;
            cb_info.direct_join = info.direct_join;
            cb_info.openable = info.openable;
            cb_info.match_id = info.match_id;
            cb_info.mode = mode;
            cb_info.map_display = info.map_display;
            cb_info.gametype = info.gametype;
            cb_info.server_name = info.server_name;
            cb_info.players = info.players;
            cb_info.max_players = info.max_players;
            social::cbfriends_service::instance().set_rich_activity(cb_info);
        }

        // Accept flow: route a join secret to a running fork, or cold-launch then connect.
        void handle_join_secret(const std::string& secret)
        {
            // Ignore a repeat of the same secret within a short window so we launch/connect exactly once.
            constexpr auto dedup_window = std::chrono::seconds(5);
            const bool duplicate = this->recent_join.access<bool>([&](recent_join_state& rj)
            {
                const auto now = std::chrono::steady_clock::now();
                if (rj.secret == secret && now - rj.when < dedup_window)
                {
                    return true;
                }
                rj.secret = secret;
                rj.when = now;
                return false;
            });
            if (duplicate)
            {
                utils::logger::write("[cbl-join] ignoring duplicate join secret");
                return;
            }

            const auto parsed = join_secret::parse(secret);
            if (!parsed)
            {
                utils::logger::write("[cbl-join] ignoring malformed join secret");
                return;
            }

            // Accepting from Discord's own UI bypasses our button gating; joining the match we're
            // already in would just drop and rebuild the connection.
            if (discord::discord_service::instance().is_same_match(parsed->game_id, parsed->match_id))
            {
                utils::logger::write("[cbl-join] ignoring join for match '{}'; already in it", parsed->match_id);
                return;
            }

            // Stash the transport so the target fork's hello fires the connect; the deadline backstops a launch that never connects.
            const auto stash_pending_join = [&]
            {
                this->pending_join.access([&](std::optional<pending_join_entry>& pj)
                {
                    pj = pending_join_entry{ parsed->game_id, parsed->t, parsed->mode,
                        std::chrono::steady_clock::now() + std::chrono::minutes(10) };
                });
            };

            // `ipc` = the fork running AND on IPC (can take an in-place connect); `running_id` = whatever holds the barrier (authoritative).
            const auto ipc = this->connected.access<connected_state>([](const connected_state& c) { return c; });
            const auto running_id = commands::game_commands::tracked_game_id();

            // A: the invited fork is already running and on IPC.
            if (ipc.game == parsed->game_id)
            {
                // Different non-switchable mode => stop + relaunch; otherwise connect in place. launch_mode is set only for fixed-mode forks.
                const auto config = game_config::get_game_config_by_id(parsed->game_id);
                const bool target_is_real_mode = config && !parsed->mode.empty()
                    && config->mode_arguments.contains(parsed->mode);
                const bool mode_known = !ipc.launch_mode.empty();

                if (target_is_real_mode && mode_known && parsed->mode != ipc.launch_mode)
                {
                    utils::logger::write("[cbl-join] game '{}' running in mode '{}' but invite is '{}'; relaunching",
                                         parsed->game_id, ipc.launch_mode, parsed->mode);
                    stash_pending_join();
                    commands::game_commands::relaunch_for_join(parsed->game_id, parsed->mode);
                    return;
                }

                utils::logger::write("[cbl-join] game '{}' already running; sending connect over pipe", parsed->game_id);
                this->send_connect(parsed->t);
                return;
            }

            // A2: the invited game holds the barrier but isn't on IPC yet (booting or mid-update); queue and let its hello complete the join.
            if (running_id == parsed->game_id)
            {
                utils::logger::write("[cbl-join] game '{}' launching/running but not on IPC yet; queueing connect",
                                     parsed->game_id);
                stash_pending_join();
                return;
            }

            // B: a different game holds the barrier (other fork, or a non-fork game). Stop it and launch the invited game.
            if (!running_id.empty())
            {
                utils::logger::write("[cbl-join] game '{}' running but invite is for '{}'; switching games",
                                     running_id, parsed->game_id);
                stash_pending_join();
                commands::game_commands::relaunch_for_join(parsed->game_id, parsed->mode);
                return;
            }

            // A3: an untracked instance of the invited game is running (launcher restart / manual start); queue — its reconnect hello gets adopted and fires the connect.
            if (game_config::is_game_process_running(parsed->game_id))
            {
                utils::logger::write("[cbl-join] game '{}' running unmanaged; queueing connect for its hello",
                                     parsed->game_id);
                stash_pending_join();
                return;
            }

            // C: nothing running: stash the transport and cold-launch; hello fires the connect.
            utils::logger::write("[cbl-join] game '{}' not running; cold-launching then connecting", parsed->game_id);
            stash_pending_join();
            commands::game_commands::launch_for_join(parsed->game_id, parsed->mode);
        }
    };

    ipc_server& ipc_server::instance()
    {
        static ipc_server server{};
        return server;
    }

    ipc_server::ipc_server()
        : impl_(std::make_unique<impl>())
    {
    }

    ipc_server::~ipc_server()
    {
        this->stop();
    }

    void ipc_server::start()
    {
        if (this->impl_->listener.running())
        {
            return;
        }

        this->impl_->outbound_event = CreateEventW(nullptr, FALSE, FALSE, nullptr); // auto-reset

        pipe::listener::options opts{};
        opts.name = PIPE_NAME;
        opts.access = PIPE_ACCESS_DUPLEX;
        opts.out_buffer = 64 * 1024;
        opts.in_buffer = 64 * 1024;
        opts.on_create_error = [](const unsigned long error)
        {
            utils::logger::write("[ipc] CreateNamedPipe failed: {}", error);
        };

        this->impl_->listener.start(std::move(opts), [impl = this->impl_.get()](void* pipe)
        {
            impl->serve_connection(pipe);
            impl->on_disconnect();
        });
    }

    void ipc_server::notify_presence_owner(const bool launcher_owns)
    {
        this->impl_->push_presence_owner(launcher_owns);
    }

    void ipc_server::notify_friends_changed()
    {
        this->impl_->push_friends_update();
    }

    void ipc_server::request_open_match()
    {
        this->impl_->push_outbound(build_json_object([](auto& w)
        {
            w.Key("type"); w.String("open-match");
        }) + "\n");
    }

    // Queued like anything else: if no fork is connected the line is dropped on the next connect,
    // so a game started later never replays stale invites.
    void ipc_server::notify_invite(const std::string& from)
    {
        this->impl_->push_outbound(build_json_object([&](auto& w)
        {
            w.Key("type"); w.String("notify");
            w.Key("kind"); w.String("invite");
            w.Key("from"); w.String(from.data());
        }) + "\n");
    }

    void ipc_server::handle_join_secret(const std::string& secret)
    {
        this->impl_->handle_join_secret(secret);
    }

    void ipc_server::clear_pending_join()
    {
        this->impl_->pending_join.access([](auto& pj) { pj.reset(); });
    }

    void ipc_server::stop()
    {
        if (!this->impl_->listener.running())
        {
            return;
        }

        this->impl_->listener.stop();

        if (this->impl_->outbound_event)
        {
            CloseHandle(this->impl_->outbound_event);
            this->impl_->outbound_event = nullptr;
        }
    }
}
