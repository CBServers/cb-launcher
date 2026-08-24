# workshop worker

Steam Workshop catalog for the launcher's Mods tab. A cron scrapes Workshop
metadata for supported games into KV; search requests are served from that
catalog and never touch Steam. The Steam Web API key is a worker secret spent
only by the scrape and per-item detail lookups, so user traffic cannot
rate-limit it and the key is never shipped in the launcher. No user
authentication of any kind.

| Endpoint | Query | Response |
|---|---|---|
| `GET /v1/search` | `game=bo3&query=&kind=all\|map\|mod&sort=popular\|recent\|name&page=1` | `{ items: [...], total, scrapedAt }` (60 per page) |
| `GET /v1/meta` | `game=bo3` | `{ scrapedAt, count }` |
| `GET /v1/item` | `game=bo3&id=<publishedfileid>` | full detail: description, screenshots, votes, dates (1 Steam call, edge-cached 1h; curated games answer from the catalog) |
| `GET /v1/updated` | `game=bo3&ids=<comma list, max 100>` | `{ "<id>": <updatedAt unix> }` for installed-mod update badges |

## Curated catalogs (Plutonium games)

Games without a Steam Workshop (`t4`, `t5`, `t6`) sync a hand-authored
catalog from `CBServers/updater` at `updater/mods/<game>.json`, refreshed by
the cron once per hour (one subrequest per game). `download` paths are
relative to the CDN root — the launcher prefixes its active CDN URL, so the
catalog can never point installs at another host.

```json
{ "items": [ {
    "id": "ugx-requiem", "title": "UGX Requiem", "author": "UGX Team",
    "kind": "map", "preview": "https://...", "screenshots": [],
    "description": "BBCode is supported here.",
    "size": 123456789, "updatedAt": 1756000000, "version": "1.2",
    "download": "mods/t4/ugx-requiem_1.2.zip"
} ] }
```

## Cost model

The free plan allows 50 subrequests per invocation, so a sweep of the
BO3 Workshop (100 items per page, cursor paging) is spread across cron runs:
each run fetches up to 30 `QueryFiles` pages plus a few `GetPlayerSummaries`
batches for new author names, then persists its cursor in `scrape:<game>`.
A finished sweep writes `catalog:<game>` (one value, well under the 25 MB cap)
and the shared `authors` name cache, and starts again once the catalog is
older than 12 hours — a few hundred Steam calls and under 30 KV writes per
day, independent of user count.

Search requests are memory-first: a warm isolate serves them with zero KV
operations (the catalog is cached in memory for 5 minutes); a cold isolate
does one KV read. Item detail is one Steam call per item per hour per edge
POP (Cache API). Rate limiting is per-isolate per-IP, i.e. best-effort.

Consequence: a newly published Workshop item appears in the launcher within
~13 hours (12h interval + sweep time), and `scrapedAt` in every response
tells the client how fresh the data is.

## Deploying

Script name `workshop`, route `workshop.cbservers.xyz`. Requires:

- KV namespace binding `WORKSHOP`
- Secret `STEAM_API_KEY` (steamcommunity.com/dev/apikey)
- Cron trigger, set alongside the script upload:

```
PUT /client/v4/accounts/{account}/workers/scripts/workshop/schedules
[{ "cron": "*/5 * * * *" }]
```
