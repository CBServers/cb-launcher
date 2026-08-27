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
case-insensitive (the folded form is the key). Phase 1 moves the friend graph to D1; Phase 0 needs
only these key→value lookups.

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

Two classes, because KV can neither hold a request open nor serialise appends:

- `ChatRoom` (binding `CHAT`) — one per chat room. History is kept in Durable Object **storage**
  (`msg:<zero-padded id>` plus a `seq` counter), so it survives evictions and redeploys. The
  in-memory array is only a mirror of the tail, loaded on wake via `blockConcurrencyWhile`. The last
  200 messages per room are retained; older ones are deleted from storage as new ones arrive.
- `Mailbox` (binding `MAILBOX`) — one per Discord user, holds their relay long-poll and mailbox.
  Deliberately **not** persisted: invites are short-lived, and anything undelivered falls back to the
  Discord SDK, so surviving a redeploy would buy nothing.

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
