# discord-link worker

Link registry for the launcher's Discord friends list. Stores which Discord
accounts have linked the launcher; the launcher intersects its Discord friend
list against it so only launcher users show up as friends.

All endpoints require the caller's own Discord OAuth2 access token
(`Authorization: Bearer <token>`); the worker resolves the caller's identity
through `GET /users/@me` and never trusts client-supplied IDs. There is no
enumeration endpoint - callers can only ask about IDs they already know
(their own Discord friend list). Only Discord user IDs and link timestamps
are stored, never tokens.

| Endpoint | Body | Response |
|---|---|---|
| `POST /v1/link` | - | 204 |
| `POST /v1/unlink` | - | 204 |
| `POST /v1/friends/intersect` | `{ "ids": ["...", ...] }` (max 40) | `{ "linked": ["..."] }` |

## KV usage

Per-user `linked:<id>` keys are the source of truth, but intersect never reads
them per-friend. A cron trigger (every minute) rebuilds a single `index` key
holding a JSON array of all linked IDs, and intersect checks against that key
through a 60s in-memory cache — so a warm isolate serves requests with zero KV
operations. Token resolution (`tok:` keys, 1h TTL) and rate limiting are also
memory-first.

Consequence: a newly linked user becomes visible to their friends within ~2
minutes (1 min cron + 60s cache) rather than instantly. Rate limiting is
per-isolate, i.e. best-effort.

Deploying requires setting the cron trigger alongside the script upload:

```
PUT /client/v4/accounts/{account}/workers/scripts/auth/schedules
[{ "cron": "* * * * *" }]
```
