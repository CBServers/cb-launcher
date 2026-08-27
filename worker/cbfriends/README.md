# cbfriends worker

CB social account registry. Gives every launcher install a persistent CB identity that is
independent of Discord, so users can drop Discord mid-session and keep their friends (Phase 1).

Clients authenticate with a **device ECC keypair (P-256)** minted and stored by the launcher
(`src/launcher/social/identity.*`). Every request is signed by the private key; the worker verifies
it with WebCrypto. The account id (`cbId`) is assigned server-side and decoupled from any single
key, so keys can be rotated or re-issued during recovery without the account changing.

## Auth

Every request carries:

| Header | Value |
|---|---|
| `X-CB-Key` | base64 of the device public key (ANSI X9.63 uncompressed point, `04‖X‖Y`, 65 bytes) |
| `X-CB-Sig` | base64 of the ECDSA signature over the **raw request body** |

The signed body is JSON and must include a fresh `ts` (unix seconds, ±300s) to bound replay. The
launcher signs `sha256(body)` via libtomcrypt, emitting an ANSI X9.62 DER signature; the worker
accepts both that and raw `r‖s`. The device credential id is `fpr = sha256hex(publicKey)`.

## Endpoints (all POST)

| Endpoint | Body | Response |
|---|---|---|
| `/v1/account/bootstrap` | `{ ts, hwidHash, discordToken?, handle?, displayName?, avatarUrl? }` | `200 { cbId, profile, created, recoveryCode? }` — `recoveryCode` only on create; `409 { recoverable:true, via:[...] }` if the machine/Discord already owns an account |
| `/v1/account` | `{ ts }` | `200 { cbId, profile }` — whoami for the signing key; `404` if unknown |
| `/v1/recover/hwid` | `{ ts, hwidHash }` | `200 { cbId, profile }` — attaches the signing key to the account anchored on this HWID |
| `/v1/recover/discord` | `{ ts, discordToken }` | `200 { cbId, profile }` — via the linked Discord account |
| `/v1/recover/code` | `{ ts, recoveryCode }` | `200 { cbId, profile }` — via the one-time recovery code |

## Recovery model

An account holds a set of authorized device keys plus recovery anchors (HWID hash, linked Discord
id, one-time recovery-code hash). Losing the local keyfile is recovered by minting a fresh key and
calling a `recover/*` endpoint — the new key's signature proves possession, the anchor identifies
the account. `bootstrap` refuses to mint a second account for a machine/Discord that already owns
one, returning `409 recoverable` so the client recovers instead of duplicating.

> HWID is a weak anchor (a machine-local, forgeable secret). Phase 1 adds rate-limiting on
> `recover/hwid` and notifies existing sessions/linked Discord when a new key is bound this way.

## Storage (KV binding `CB`)

`acct:<cbId>` holds the account JSON. Reverse indices `dev:<fpr>`, `hwid:<hash>`, `discord:<id>`,
`rec:<codeHash>`, `handle:<folded>` each map to a `cbId`. Handles are globally unique and
case-insensitive (the folded form is the key). `sec:<cbId>` holds the security event log and
`inv:<cbId>` the game-invite mailbox.

KV holds **only cold records**. Everything the poll loop touches lives in a Durable Object instead,
for two reasons: KV is eventually consistent (a read can serve a value up to a minute stale, so an
accepted friend request could appear not to have landed), and a KV read-modify-write has no
atomicity, so two edits to one friend list could lose each other. Both problems disappear inside an
object, which serialises its own requests and reads its own writes.

It is also what makes the service affordable. The board used to be listed by scanning the `lfg:`
prefix and reading each poster's account and presence, on every client's five-second tick;
`test/kv-budget.test.mjs` now pins a poll cycle at a flat five KV reads no matter how many friends
or broadcasters exist.

## Discord invite relay

This worker also serves the Discord invite relay that used to run separately, so there is one
service instead of two. Those endpoints speak the protocol `src/launcher/discord/relay_client.cpp`
already implements, and are authenticated by **Discord token / relay token** — never a device key —
so they keep working for people who never opt into a CB profile.

| Endpoint | Auth | Response |
|---|---|---|
| `/v1/session/start` | `Bearer <discord token>` | `{ relayToken, relayEnabled }` |
| `/v1/poll` | `Bearer <relayToken>` | `{ invites: [...] }` — long-poll, held ~25s |
| `/v1/invite` | `Bearer <relayToken>` | `{ reason }` |
| `/v1/invite/reply` | `Bearer <relayToken>` | `{ reason }` |

`reason` is what the client classifies on: `delivered`; `offline` → **the launcher falls back to the
Discord SDK**; `throttled` (429) → report rate-limited and **do not** fall back, which is the whole
point of the relay; `blocked` / `failed`.

Set the KV key `relayEnabled` to `false` to push every client back onto the SDK without redeploying.

These are distinct from the CB game invites (`/v1/invite/send`, `/v1/invite/poll`), which are
device-key authed and route between CB friends by `cbId`.

## Durable Objects

Four classes, because KV can neither hold a request open, serialise appends, nor be read back
immediately after a write:

- `ChatRoom` (binding `CHAT`) — one per chat room. A poll sent with `hold` is held open until someone
  sends or ~25s elapses, so a message arrives the moment it is sent and an idle room costs one
  request every 25 seconds instead of one every five. Because the worker filters blocked authors
  after the room replies, the response also carries a `cursor` past everything it considered —
  without it, a room of nothing but blocked chatter would spin the client. History is kept in
  Durable Object **storage**
  (`msg:<zero-padded id>` plus a `seq` counter), so it survives evictions and redeploys. The
  in-memory array is only a mirror of the tail, loaded on wake via `blockConcurrencyWhile`. The last
  200 messages per room are retained; older ones are deleted from storage as new ones arrive.
- `Mailbox` (binding `MAILBOX`) — one per Discord user, holds their relay long-poll and mailbox.
  Deliberately **not** persisted: invites are short-lived, and anything undelivered falls back to the
  Discord SDK, so surviving a redeploy would buy nothing.
- `SocialGraph` (binding `GRAPH`) — one per account, holding its `friends`, `incoming`, `outgoing`
  and `blocked` lists in Durable Object storage. Edits arrive as a batch and apply atomically, so
  accepting a request (three edits a side) cannot half-land. An account whose edges still live in the
  old `fr:`/`rin:`/`rout:`/`blk:` KV arrays is migrated across the first time it is read, once.
- `Directory` (binding `DIRECTORY`) — a single instance holding live presence, the LFG board, and a
  profile snapshot per account, so a friend list or a board listing is one call rather than two KV
  reads per person. **Not** persisted, on the same reasoning as `Mailbox`: presence expires after 90s
  and a post after 15 minutes, and the next 30-second beat repopulates both. A redeploy therefore
  shows an empty board for up to one beat.

  Being a single object, it serialises the whole population's presence traffic. At the launcher's
  cadence that is a couple of calls per user per minute plus one per poll, which is comfortable, but
  it is the first thing that would need sharding by game if the population grew by an order of
  magnitude.

## Tests

```
node test/run.mjs          # every suite
node test/chat.test.mjs    # one suite
```

Each suite imports the real `src/index.js` and drives it through signed requests against a fake KV
and Durable Object storage, so no wrangler, deploy or Cloudflare account is needed. `test/harness.mjs`
holds the shared rig; Discord is stubbed where a suite needs it.

## Deploy

```
wrangler kv namespace create CB
wrangler kv namespace create CB --preview
# paste the two ids into wrangler.toml
wrangler deploy
```

Local dev (simulated KV, no account needed): `wrangler dev`.
