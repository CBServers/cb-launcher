# vps harness

Runs the KV-only workers (`servers`, `discord-link`, `workshop`) on plain Node instead of
Cloudflare Workers, with their `src/index.js` unmodified. `serve.mjs` provides what those
files expect from the platform:

- KV bindings backed by SQLite (`../cbfriends/store-sqlite.mjs`, `node:sqlite`, Node 22.13+),
  including `get(key, 'json')`
- `caches.default` as an in-memory map keyed by request URL, TTL taken from the stored
  response's `Cache-Control: max-age`
- cron triggers as a `setInterval` calling `scheduled()` (one run at a time, first run 5 s
  after start)
- secrets and vars copied from the process environment into `env`

```
node serve.mjs servers.json                                   # 127.0.0.1:8788
DB_PATH=./discord-link.db node serve.mjs discord-link.json    # 127.0.0.1:8789, cron 60 s
DB_PATH=./workshop.db STEAM_API_KEY=... node serve.mjs workshop.json   # 127.0.0.1:8790, cron 300 s
```

One JSON config per service: `module` (relative to the config), `port`, `kv` (binding
names), `vars` (env var names to expose), `cronSeconds`. `HOST`, `PORT`, `DB_PATH`
environment variables override the config. `/healthz` is answered by the harness.

Sits behind a TLS-terminating reverse proxy on the VPS; the workers read the client
address from `CF-Connecting-IP`, so keep Cloudflare's proxy in front. cbfriends has its own
`serve.mjs` because it also needs Durable Objects.
