# servers worker

Cache/normalization proxy over [gameserve.rs](https://gameserve.rs) for the
launcher's per-game Servers tab. No KV, no cron, no secrets — each game's list
is held in the edge cache for 30 seconds so launcher traffic reaches
gameserve.rs a handful of times a minute regardless of user count, and the
launcher owns its own schema in case the upstream changes.

| Endpoint | Query | Response |
|---|---|---|
| `GET /v1/servers` | `game=<launcher key: cod1, coduo, cod2x, cod4x, t4, t5, iw4x, iw5, t6, boiii, iw6x, s1x, iw7-mod, h1-mod, hmw-mod>` | `{ servers: [...], fetchedAt }` |
| `GET /v1/player-counts` | none | `{ games: { <launcher key>: { players, servers } }, fetchedAt }` |

Per server: `id` (`ip:port`), `name` (color codes stripped), `map` (display
name), `mode` (`mp`/`zm`), `gametype`, `players`, `maxPlayers`, `bots`,
`ping` (always `null` — the launcher measures it natively per user), `region`
(NA/SA/EU/AS/OCE/AF from country), `country`, `countryName`.

Plutonium games merge their separate mp/zm upstream ids (e.g. `T6` + `T6ZM`);
`hmw-mod` merges `HMW` and `H2M`, which track different master servers.

`/v1/player-counts` is the "players in servers" number on the launcher's
library cards and game pages, cached 30 seconds like a list. It comes from
gameserve.rs's `/stats` feed (one upstream call for every game, folded with
the same id merges) plus a scrape of the BO4 lobby-service status page
(`bo4`, which has no master list). That page lives on a bare IP, which
Workers cannot fetch (Cloudflare error 1003), so `t8.cbservers.xyz` is an
unproxied A record pointing at it. A game whose upstream failed is omitted
rather than reported as zero; the two upstreams fail independently. The
launcher's other count, people running each game from the launcher itself,
comes from the cbfriends worker's `/v1/stats` and is never added to this one.

## Deploy

Production runs on a VPS through the `worker/vps` harness (`node ../vps/serve.mjs
../vps/servers.json`), not on Cloudflare. The wrangler config is local-only and
gitignored; the Worker is kept only as a rollback path.
