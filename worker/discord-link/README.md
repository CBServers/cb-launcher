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
