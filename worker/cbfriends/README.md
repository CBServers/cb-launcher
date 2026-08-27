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

## Deploy

```
wrangler kv namespace create CB
wrangler kv namespace create CB --preview
# paste the two ids into wrangler.toml
wrangler deploy
```

Local dev (simulated KV, no account needed): `wrangler dev`.
