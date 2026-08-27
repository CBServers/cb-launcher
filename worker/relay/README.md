# relay worker

Replacement for the Python invite relay (`relay.cbservers.xyz`). Carries Discord invites and
join-requests off Discord's app-wide rate-limited surface.

**Drop-in:** it speaks the exact protocol `src/launcher/discord/relay_client.cpp` already implements,
so the launcher needs **no code change** — only `RELAY_URL` in `discord_constants.hpp` (or the
`-relay-url` flag) repointed here.

## Identity: Discord only — CB is not involved

Callers authenticate with their **Discord OAuth2 access token**; the worker resolves it through
`GET /users/@me` and keys every mailbox by **Discord user id**. There is deliberately no CB account
in this path, so **Discord friends keep working for users who never opt into a CB profile**. The CB
social stack (`worker/cbfriends`) is a separate, fully opt-in system with its own identity and its
own invite mailbox.

| | relay (this worker) | cbfriends worker |
|---|---|---|
| Identity | Discord token → Discord id | Device keypair → `cb_id` (Discord optional) |
| Used by | Discord friends list, invites/joins | CB friends list, invites/joins, presence, LFG |
| Opt-in? | No — works for any Discord-linked user | Yes — only if the user creates a CB profile |

## Endpoints (all POST)

| Endpoint | Auth | Response |
|---|---|---|
| `/v1/session/start` | `Bearer <discord token>` | `{ relayToken, relayEnabled }` |
| `/v1/poll` | `Bearer <relayToken>` | `{ invites: [...] }` — long-poll, held ~25s |
| `/v1/invite` | `Bearer <relayToken>` | `{ reason }` |
| `/v1/invite/reply` | `Bearer <relayToken>` | `{ reason }` |

`reason` is what the client classifies on:

- `delivered` — handed to the recipient's mailbox.
- `offline` — recipient isn't on the relay → **the launcher falls back to the Discord SDK**.
- `throttled` (with HTTP 429) — relay-side limit → the launcher reports rate-limited and **must not**
  fall back (falling back is exactly what the relay exists to avoid).
- `blocked` / `failed` — nothing more to do / transport error.

`relayEnabled` is a server-side kill switch: set the KV key `relayEnabled` to `false` and every
client returns to the SDK path.

## Why Durable Objects

A long poll needs a single coordination point per user — something that can hold a request open and
wake it the instant a message is delivered. KV can't do that. So each user's mailbox is a Durable
Object (`Mailbox`), keyed by Discord id; KV only holds sessions and the token cache.

## Deploy

```
wrangler kv namespace create RELAY
wrangler kv namespace create RELAY --preview
# paste the ids into wrangler.toml
wrangler deploy
```

## Local testing (no Cloudflare account)

`serve-local.mjs` is a standalone Node implementation of the same protocol, including real
long-polling:

```
node serve-local.mjs 8091
cb-launcher.exe -relay-url http://127.0.0.1:8091
```

For local runs without real Discord tokens, a bearer of the form `dev:<discord id>` is accepted as
that id. `RELAY_POLL_HOLD_MS` shortens the hold for tests.

## Migration

Because the protocol is identical, cutover is just repointing the URL: deploy this worker, point
`RELAY_URL` at it, ship, then retire the Python relay once the old build is drained. Rollback is
repointing back.
