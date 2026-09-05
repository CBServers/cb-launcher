# servers worker

Cache/normalization proxy over [gameserve.rs](https://gameserve.rs) for the
launcher's per-game Servers tab. No KV, no cron, no secrets — each game's list
is held in the edge cache for 30 seconds so launcher traffic reaches
gameserve.rs a handful of times a minute regardless of user count, and the
launcher owns its own schema in case the upstream changes.

| Endpoint | Query | Response |
|---|---|---|
| `GET /v1/servers` | `game=<launcher key: cod1, coduo, cod2x, cod4x, t4, t5, iw4x, iw5, t6, boiii, iw6x, s1x, iw7-mod, h1-mod, hmw-mod>` | `{ servers: [...], fetchedAt }` |

Per server: `id` (`ip:port`), `name` (color codes stripped), `map` (display
name), `mode` (`mp`/`zm`), `gametype`, `players`, `maxPlayers`, `bots`,
`ping` (always `null` — the launcher measures it natively per user), `region`
(NA/SA/EU/AS/OCE/AF from country), `country`, `countryName`.

Plutonium games merge their separate mp/zm upstream ids (e.g. `T6` + `T6ZM`);
`hmw-mod` merges `HMW` and `H2M`, which track different master servers.

## Deploy

```
npx wrangler dev                      # local, no secrets needed
npx wrangler deploy                   # staging (workers.dev)
npx wrangler deploy -c wrangler.prod.toml   # production (servers.cbservers.xyz)
```
