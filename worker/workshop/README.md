# workshop worker

Mod catalog for the launcher's Mods tab, from two sources behind the same
endpoints:

- **Steam (`bo3`):** a cron scrapes Workshop metadata into KV; search requests
  are served from that catalog and never touch Steam. The Steam Web API key is
  a worker secret spent only by the scrape and per-item detail lookups, so user
  traffic cannot rate-limit it and the key is never shipped in the launcher.
- **Mod index (`cod1`, `coduo`, `cod2`, `cod4`, `mw2`, `ghosts`, `aw`, `mwr`, `iw`, `mw2r`, `waw`, `bo1`, `mw3`, `bo2`, the game manifest names):**
  the community list in [CBServers/mods-index](https://github.com/CBServers/mods-index).
  Its publish workflow builds `dist/<game>.json` on the repo's `dist` branch;
  the cron (and `POST /v1/refresh`) syncs them into KV.

No user authentication of any kind.

| Endpoint | Query | Response |
|---|---|---|
| `GET /v1/search` | `game=<game>&query=&kind=all\|map\|mod&sort=popular\|recent\|name&page=1` | `{ items: [...], total, scrapedAt }` (60 per page) |
| `GET /v1/meta` | `game=<game>` | `{ scrapedAt, count }`, plus `commit` for index games |
| `GET /v1/item` | `game=<game>&id=<id>` | full detail: description, screenshots, votes, dates, `children` (required items, one level; Steam: 1-2 Steam calls, edge-cached 1h) |
| `GET /v1/updated` | `game=<game>&ids=<comma list, max 100>` | Steam: `{ "<id>": <updatedAt unix> }`; index: `{ "<id>": "<version>" }` |
| `GET /v1/image/<commit>/<game>/<id>/<file>` | | an index entry's image from the repo at that commit, `Cache-Control: immutable` |
| `POST /v1/refresh` | `Authorization: Bearer <INDEX_REFRESH_SECRET>` | `{ changed, distCommit }`; 404 when no secret is configured, at most once per 10 s |

Index items differ from Steam ones: ids are slugs, `subscribers` is always 0
(so `sort=popular` sorts by `updatedAt`), `votes` is null, and search items
carry `version`, `comingSoon` and `changesGameFiles`. `/v1/item` also returns
`author`, `version` and `files: [{ root, path, size, hash, url | parts }]`,
which is what the launcher installs from. `preview` and `screenshots` point at
`/v1/image/...` on whichever of `workshop.cbservers.dev` / `.xyz` served the
request (`X-Forwarded-Host`), so they follow the launcher's host failover.

## Cost model

The free plan allows 50 subrequests per invocation, so a sweep of the
BO3 Workshop (100 items per page, cursor paging) is spread across cron runs:
each run fetches up to 30 `QueryFiles` pages plus a few `GetPlayerSummaries`
batches for new author names, then persists its cursor in `scrape:<game>`.
A finished sweep writes `catalog:<game>` (one value, well under the 25 MB cap)
and the shared `authors` name cache, and starts again once the catalog is
older than an hour — a few hundred Steam calls per sweep (sized for the VPS,
not the Workers free plan), independent of user count. A sweep that returns
fewer than half the cached items is discarded so a Steam outage cannot empty
the catalog.

The index sync is one GitHub API call per cron run (the `dist` ref, well inside
the 60/hour unauthenticated limit; `GITHUB_TOKEN` raises it if ever needed).
Only when that commit changes does it fetch the fourteen `dist/<game>.json` files
at that exact commit and write fourteen `catalog:<game>` values plus
`index:state`. It is all or nothing: one failing or malformed file keeps every
stored catalog and retries on the next run. Entries whose files fail
validation are dropped and logged.

Search requests are memory-first: a warm isolate serves them with zero KV
operations (the catalog is cached in memory for 5 minutes); a cold isolate
does one KV read. Item detail is one Steam call per item per hour per edge
POP (Cache API). Images are fetched from GitHub per request and are cacheable
for a year, since the commit is in the URL. Rate limiting is per-isolate
per-IP, i.e. best-effort; images have their own, larger bucket.

Consequence: a newly published Workshop item appears in the launcher within
~1-2 hours (1h interval + sweep time), a merged index entry within seconds of
its publish run (or one cron interval without the refresh hook), and
`scrapedAt` in every response tells the client how fresh the data is.

## Tests

```
node test/run.mjs
```

Drives the real `src/index.js` against a fake KV and a routed fetch stub.
`test/fixtures/dist-bo2.json` is real `publish.py` output.

## Deploying

Production runs on the VPS through `worker/vps/serve.mjs workshop.json`
(cron every 300 s). Env (`/etc/cbservers/workshop.env`):

- `STEAM_API_KEY` (steamcommunity.com/dev/apikey)
- `INDEX_REFRESH_SECRET`: the same value as the mods-index secret
  `WORKSHOP_REFRESH_SECRET`; its variable `WORKSHOP_REFRESH_URL` is
  `https://workshop.cbservers.dev/v1/refresh`. Optional: without it
  `/v1/refresh` is 404 and the cron alone picks up builds.

The dormant Workers path (script `workshop`, route `workshop.cbservers.xyz`)
needs the KV binding `WORKSHOP`, the same secrets, and a cron trigger:

```
PUT /client/v4/accounts/{account}/workers/scripts/workshop/schedules
[{ "cron": "*/5 * * * *" }]
```
