# Integrating the CB Social work

Notes for reviewing and landing the `cb-social` work into CB Servers. Nothing here has been
deployed to Cloudflare and nothing has shipped to users — it runs today only against a local worker.

## What it is

A launcher-native social identity that works without Discord: every install mints an ECC P-256
device keypair, and an account is anchored to that key plus a HWID hash, a linked Discord id, and a
one-time recovery code. On top of that sits a friend graph, presence, a Community hub (per-game LFG
boards and chat), and game invites that route between CB friends.

Discord users get a profile seeded from their Discord account automatically. Users who never link
Discord can still create one.

## Review surface

The branch is ~8,200 lines, but nearly all of it is **new files**. Only 13 pre-existing files are
modified, and that is the whole review surface:

| File | Change |
|---|---|
| `src/launcher/main.cpp` | +29 — starts the CB service alongside the Discord one |
| `src/launcher/ipc/ipc_server.cpp` | +53 — CB friends join the existing `friends` IPC line, tagged `source:"cb"` |
| `src/launcher/commands/commands.cpp` | +2 — registers the new command group |
| `src/launcher/commands/discord_commands.cpp` | **−81/+5, no behaviour change** — the toast helpers moved verbatim into `invite_notification.cpp` so CB invites raise the same toast instead of duplicating them |
| `src/launcher/discord/discord_constants.hpp` | `RELAY_URL` now points at the cbfriends worker — see *Retiring the standalone relay* |
| `src/common/utils/property_keys.hpp` | +17 — new property keys |
| `src/launcher-ui/*` | additive — new tab, new panel, new i18n block, mocks |
| `.gitignore` | ignores the local worker dev store |

**The Discord bridge is functionally untouched.** The whole `src/launcher/discord/` tree differs from
upstream by a single constant — `RELAY_URL` — and its comment. `relay_client.cpp`,
`discord_service.cpp` and the Discord friends UI are byte-identical, so the relay protocol on the
wire is unchanged and only its destination moves. That was a hard constraint throughout: CB friends
live *beside* Discord friends, they do not replace or reroute them.

## Cloudflare: what has to exist

One worker, `worker/cbfriends`. It serves both the CB endpoints and the existing Discord invite
relay protocol, so it replaces the standalone relay rather than running next to it.

```bash
cd worker/cbfriends
wrangler kv namespace create CB
wrangler kv namespace create CB --preview
# paste both ids into wrangler.toml, replacing REPLACE_WITH_KV_ID / REPLACE_WITH_PREVIEW_KV_ID
wrangler deploy
```

`wrangler.toml` declares four Durable Object classes across two migrations. `v1` (`ChatRoom`,
`Mailbox`) and `v2` (`SocialGraph`, `Directory`) both apply on first deploy.

Then point a hostname at it. The launcher reads `social.cbservers.xyz` for CB endpoints
(`src/launcher/social/social_constants.hpp`), overridable with `-cbfriends-url`.

### Retiring the standalone relay

The invite relay currently runs as its own service at `relay.cbservers.xyz`, outside this repo. The
cbfriends worker speaks the same protocol (`relay_client.cpp` is unchanged, so the wire format is
identical), which is what lets that service be switched off.

Retiring it fully takes two routes on the one worker:

1. **`social.cbservers.xyz`** — what this branch points `RELAY_URL` and `CBFRIENDS_URL` at. Covers
   every build from this branch onward.
2. **`relay.cbservers.xyz`** — repointed at the same worker. Covers the builds already installed,
   which will keep calling that hostname forever.

With both routes live the old service takes zero traffic and can be turned off. With only the first,
it still serves everyone who has not updated.

**Ordering matters.** `social.cbservers.xyz` must be deployed and answering *before* a build from
this branch is released. If it is not, invites on that build fall back to the Discord SDK — the
rate-limit problem the relay was built to avoid. `worker/cbfriends/test/relay.test.mjs` covers the
protocol end to end (11 assertions, including that `offline` and `throttled` stay distinct, since
the client falls back on one and not the other), so it can be verified before any DNS moves.

## Testing without deploying

The worker runs locally against a `Map`-backed KV and real Durable Object classes:

```bash
node worker/cbfriends/serve-local.mjs 8787 kv.json
```

```bash
cb-launcher.exe -cbfriends-url http://127.0.0.1:8787
```

`kv.json` is the dev store and is gitignored — it holds real Discord ids and HWID hashes, so it must
never be committed.

The suite drives the real `src/index.js` through signed requests, no wrangler or account needed:

```bash
node worker/cbfriends/test/run.mjs
```

13 suites, 168 assertions. Three are worth knowing about:

- `kv-budget.test.mjs` pins the cost of the launcher's poll loop. It builds a population, measures,
  grows it 6×, and asserts the cost did not change — a poll cycle is a flat 5 KV reads regardless of
  how many friends or broadcasters exist. A regression that reintroduces a per-friend read fails
  here rather than on the bill.
- `graph.test.mjs` covers the KV→Durable Object migration described below.
- `moderation.test.mjs` is mostly about the authority boundary rather than the queue: that the
  endpoints 404 to non-moderators, that nobody can grant themselves a role, that `admin` is
  unreachable through the API, and that moderators cannot be muted.

## Migration behaviour on first deploy

Friend edges used to live in KV as `fr:` / `rin:` / `rout:` / `blk:` arrays. They now live in a
`SocialGraph` object per account. The first time an account's edges are read, the worker seeds that
object from the old KV keys, once. Nothing needs running by hand; the old keys are left in place and
simply stop being read.

This is a one-way door worth noting at review time: edges changed after the deploy live only in the
Durable Object, so rolling the worker back would lose post-deploy friend changes.

## Known gaps

- **`cb:` i18n block is English-only.** 117 keys. `t()` falls back to English, so fr/es/ru users see
  English text rather than raw keys, but it is untranslated.
- **The in-game side is not in this repo.** `docs/boiii-cb-friends.md` is the launcher→fork contract.

## Moderation

There is a Moderation page in the launcher, shown only to accounts the worker gives a role to.
Report queue, account lookup by handle, timed mutes, and an audit trail of every moderator action.

Authority is a server-side allowlist keyed by `cbId` — deliberately not by handle, which users can
change, and not by HWID, which is a forgeable machine-local secret. The device-key signature already
proves who is calling, so a role is just a lookup, and every endpoint re-checks it. The client
hiding the tab is cosmetic.

Two tiers:

- **`admin`** — set only by writing KV directly, so there is no in-app path from a compromised
  moderator account to full control:
  ```bash
  wrangler kv key put --binding CB "role:cb_<theirCbId>" admin
  ```
- **`mod`** — granted and revoked in-app by an admin, from the lookup tab.

Non-moderators get `404` rather than `403` from these endpoints, so their existence is not
discoverable. Mutes carry an expiry and lapse on their own; moderators cannot be muted.

## Scale headroom

`Directory` is a single Durable Object holding presence and the LFG board for everyone, so it is the
one shared choke point. Measured against the real class with every user sitting in the Community tab,
it saturates somewhere around 15,000 concurrent — far past current numbers. Sharding it by game is
the obvious move if that ever changes; nothing else concentrates.
