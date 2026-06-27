#include "std_include.hpp"
#include "ipc_server.hpp"

#include "commands/game_commands.hpp"
#include "discord/discord_service.hpp"
#include "game_config.hpp"
#include "join_secret.hpp"

#include <utils/concurrency.hpp>
#include <utils/logger.hpp>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <deque>
#include <optional>
#include <thread>
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
                out.is_nat = false;
                out.ip = json_string(t, "ip");
                out.port = json_int(t, "port");
                return !out.ip.empty() && out.port > 0;
            }
            if (kind == "nat")
            {
                out.is_nat = true;
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
        std::thread thread{};
        std::atomic<bool> running{false};
        HANDLE stop_event{nullptr};

        // Outbound launcher->client messages (presence-owner, connect), drained on the serve thread.
        HANDLE outbound_event{nullptr};
        utils::concurrency::container<std::deque<std::string>> outbound{};

        // Per-connection state. The launch barrier guarantees one game (one client) at a time.
        unsigned long connection_pid{0};
        std::string connection_game_id{};

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
                if (t.is_nat)
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

            utils::logger::write("[ipc] sending connect {} ({})", id, t.is_nat ? "nat" : "direct");
            printf("[cbl-join] -> connect %s (%s): %s\n", id.data(), t.is_nat ? "nat" : "direct", line.data());
            fflush(stdout);
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

        void run()
        {
            while (this->running)
            {
                const auto pipe = CreateNamedPipeW(
                    PIPE_NAME,
                    PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1, 64 * 1024, 64 * 1024, 0, nullptr);

                if (pipe == INVALID_HANDLE_VALUE)
                {
                    utils::logger::write("[ipc] CreateNamedPipe failed: {}", GetLastError());
                    if (WaitForSingleObject(this->stop_event, 1000) == WAIT_OBJECT_0)
                    {
                        break;
                    }
                    continue;
                }

                if (this->wait_for_connection(pipe) && this->running)
                {
                    this->serve_connection(pipe);
                    this->on_disconnect();
                }

                DisconnectNamedPipe(pipe);
                CloseHandle(pipe);
            }
        }

        // Overlapped ConnectNamedPipe that also unblocks on the stop event.
        bool wait_for_connection(const HANDLE pipe)
        {
            OVERLAPPED ov{};
            ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

            bool ready = false;
            const auto connect_ok = ConnectNamedPipe(pipe, &ov);
            const auto err = GetLastError();

            if (!connect_ok && err == ERROR_IO_PENDING)
            {
                HANDLE handles[2] = {ov.hEvent, this->stop_event};
                if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0)
                {
                    DWORD dummy = 0;
                    ready = GetOverlappedResult(pipe, &ov, &dummy, FALSE) != 0;
                }
                else
                {
                    CancelIoEx(pipe, &ov);
                }
            }
            else if (!connect_ok && err == ERROR_PIPE_CONNECTED)
            {
                // Client connected between CreateNamedPipe and ConnectNamedPipe.
                ready = true;
            }

            CloseHandle(ov.hEvent);
            return ready;
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

            while (this->running)
            {
                DWORD read = 0;
                if (!this->read_overlapped(pipe, chunk, sizeof(chunk), read) || read == 0)
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

        bool read_overlapped(const HANDLE pipe, char* buffer, const DWORD size, DWORD& read)
        {
            OVERLAPPED ov{};
            ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

            bool ok = ReadFile(pipe, buffer, size, &read, &ov) != 0;
            if (!ok && GetLastError() == ERROR_IO_PENDING)
            {
                ok = this->wait_read(pipe, ov, read);
            }

            CloseHandle(ov.hEvent);
            return ok;
        }

        // Waits for a pending read while also servicing outbound sends and the stop event.
        bool wait_read(const HANDLE pipe, OVERLAPPED& ov, DWORD& bytes)
        {
            HANDLE handles[3] = {ov.hEvent, this->stop_event, this->outbound_event};
            while (true)
            {
                const auto wait = WaitForMultipleObjects(3, handles, FALSE, INFINITE);
                if (wait == WAIT_OBJECT_0)
                {
                    return GetOverlappedResult(pipe, &ov, &bytes, FALSE) != 0;
                }
                if (wait == WAIT_OBJECT_0 + 2)
                {
                    // Ownership changed: send presence-owner, keep the read pending.
                    this->flush_outbound(pipe);
                    continue;
                }

                // Stop event (or wait failure): cancel the pending read.
                CancelIoEx(pipe, &ov);
                return false;
            }
        }

        bool wait_overlapped(const HANDLE pipe, OVERLAPPED& ov, DWORD& bytes)
        {
            HANDLE handles[2] = {ov.hEvent, this->stop_event};
            if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0)
            {
                return GetOverlappedResult(pipe, &ov, &bytes, FALSE) != 0;
            }

            CancelIoEx(pipe, &ov);
            return false;
        }

        bool write_line(const HANDLE pipe, const std::string& data)
        {
            OVERLAPPED ov{};
            ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

            DWORD written = 0;
            bool ok = WriteFile(pipe, data.data(), static_cast<DWORD>(data.size()), &written, &ov) != 0;
            if (!ok && GetLastError() == ERROR_IO_PENDING)
            {
                ok = this->wait_overlapped(pipe, ov, written);
            }

            CloseHandle(ov.hEvent);
            return ok;
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
                utils::logger::write("[ipc] connect-ack {} accepted={}", id, accepted);
                printf("[cbl-join] <- connect-ack %s accepted=%d\n", id.data(), accepted ? 1 : 0);
                fflush(stdout);
            }
            return true; // unknown types ignored (forward-compat)
        }

        bool handle_hello(const HANDLE pipe, const rapidjson::Document& doc)
        {
            const auto protocol = json_int(doc, "protocolVersion");
            const auto game = json_string(doc, "game");

            if (protocol <= 0 || protocol > PROTOCOL_VERSION || game.empty())
            {
                utils::logger::write("[ipc] rejecting hello (protocol {}, game '{}')", protocol, game);
                return false;
            }

            if (!commands::game_commands::is_tracked_game_pid(this->connection_pid, game))
            {
                utils::logger::write("[ipc] hello PID/game mismatch (pid {}, game '{}')", this->connection_pid, game);
#ifndef _DEBUG
                return false;
#endif
            }

            // Fixed launch mode from hello drives the relaunch decision; omitted by runtime-switchable forks.
            const auto hello_mode = json_string(doc, "mode");
            this->connection_game_id = game;
            this->connected.access([&](connected_state& c) { c.game = game; c.launch_mode = hello_mode; });

            const auto* owner = discord::discord_service::instance().owns_presence() ? "launcher" : "client";
            printf("[cbl-join] hello from '%s' (pid %lu); presenceOwner=%s\n", game.data(), this->connection_pid, owner);
            fflush(stdout);
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

            this->fire_pending_join(game);
            return true;
        }

        // If an accept cold-launched this game, send the queued connect now that it has dialed in.
        void fire_pending_join(const std::string& game)
        {
            std::optional<join_secret::transport> transport;
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
                    transport = pj->t;
                    pj.reset();
                }
            });

            if (transport)
            {
                this->send_connect(*transport);
            }
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

            // Live presence mode feeds only the Discord card and join secret, never the relaunch decision.
            const auto mode = json_string(doc, "mode");

            if (join_secret::transport transport{}; parse_transport(doc, transport))
            {
                info.join_secret = join_secret::build(this->connection_game_id, transport, mode);
                info.direct_join = !transport.is_nat; // direct => public/dedicated server, joinable without approval
                printf("[cbl-join] presence from '%s' is joinable (%s); secret='%s'\n",
                       this->connection_game_id.data(), transport.is_nat ? "nat" : "direct", info.join_secret.data());
                fflush(stdout);
            }

            discord::discord_service::instance().set_rich_game_activity(
                this->connection_game_id, config->display_name, mode, info);
        }

        // Accept flow: route a join secret to a running fork, or cold-launch then connect.
        void handle_join_secret(const std::string& secret)
        {
            printf("[cbl-join] handle_join_secret: '%s'\n", secret.data());
            fflush(stdout);

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
                printf("[cbl-join] ignoring duplicate join secret\n");
                fflush(stdout);
                return;
            }

            const auto parsed = join_secret::parse(secret);
            if (!parsed)
            {
                utils::logger::write("[ipc] ignoring malformed join secret");
                printf("[cbl-join] secret rejected (malformed)\n");
                fflush(stdout);
                return;
            }

            // Stash the transport so the target fork's hello fires the connect; the deadline backstops a launch that never connects.
            const auto stash_pending_join = [&]
            {
                this->pending_join.access([&](std::optional<pending_join_entry>& pj)
                {
                    pj = pending_join_entry{ parsed->game_id, parsed->t,
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
                    printf("[cbl-join] game '%s' running in mode '%s' but invite is '%s'; relaunching\n",
                           parsed->game_id.data(), ipc.launch_mode.data(), parsed->mode.data());
                    fflush(stdout);
                    stash_pending_join();
                    commands::game_commands::relaunch_for_join(parsed->game_id, parsed->mode);
                    return;
                }

                printf("[cbl-join] game '%s' already running; sending connect over pipe\n", parsed->game_id.data());
                fflush(stdout);
                this->send_connect(parsed->t);
                return;
            }

            // B: a different game holds the barrier (other fork, or a non-fork game). Stop it and launch the invited game.
            if (!running_id.empty())
            {
                printf("[cbl-join] game '%s' running but invite is for '%s'; switching games\n",
                       running_id.data(), parsed->game_id.data());
                fflush(stdout);
                stash_pending_join();
                commands::game_commands::relaunch_for_join(parsed->game_id, parsed->mode);
                return;
            }

            // C: nothing running: stash the transport and cold-launch; hello fires the connect.
            printf("[cbl-join] game '%s' not running; cold-launching then connecting\n", parsed->game_id.data());
            fflush(stdout);
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
        if (this->impl_->running.exchange(true))
        {
            return;
        }

        this->impl_->stop_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        this->impl_->outbound_event = CreateEventW(nullptr, FALSE, FALSE, nullptr); // auto-reset
        this->impl_->thread = std::thread([this]()
        {
            this->impl_->run();
        });
    }

    void ipc_server::notify_presence_owner(const bool launcher_owns)
    {
        this->impl_->push_presence_owner(launcher_owns);
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
        if (!this->impl_->running.exchange(false))
        {
            return;
        }

        if (this->impl_->stop_event)
        {
            SetEvent(this->impl_->stop_event);
        }

        if (this->impl_->thread.joinable())
        {
            this->impl_->thread.join();
        }

        if (this->impl_->stop_event)
        {
            CloseHandle(this->impl_->stop_event);
            this->impl_->stop_event = nullptr;
        }

        if (this->impl_->outbound_event)
        {
            CloseHandle(this->impl_->outbound_event);
            this->impl_->outbound_event = nullptr;
        }
    }
}
