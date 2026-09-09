// Generic Node harness for the stateless/KV-only workers (servers, discord-link, workshop):
// runs an unmodified Workers-style src/index.js on node:http with SQLite-backed KV, an
// in-memory Cache API shim and a setInterval stand-in for cron triggers. cbfriends keeps its
// own serve.mjs because it also needs Durable Objects.
//
//   node serve.mjs <config.json>
//
// config.json:
//   { "module": "../servers/src/index.js",   // relative to the config file
//     "port": 8788,                          // HOST defaults to 127.0.0.1
//     "kv": ["LINKS"],                       // KV bindings, all backed by DB_PATH (omit for none)
//     "vars": ["STEAM_API_KEY"],             // copied from process.env into env (secrets + vars)
//     "cronSeconds": 60 }                    // calls module.scheduled() on this interval (omit for none)
// HOST / PORT / DB_PATH env vars override the config.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { openStore } from '../cbfriends/store-sqlite.mjs';

const configPath = process.argv[2];
if (!configPath) {
    console.error('usage: node serve.mjs <config.json>');
    process.exit(1);
}
const configUrl = new URL(configPath, `file://${process.cwd().replace(/\\/g, '/')}/`);
const config = JSON.parse(readFileSync(configUrl, 'utf8'));

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || config.port || 8787;
const dbPath = process.env.DB_PATH || config.dbPath || null;

// Cloudflare's Cache API as the workers use it: match/put keyed on the request URL,
// TTL from the stored response's Cache-Control max-age. Nothing else is supported.
function installCache() {
    const store = new Map();
    function ttlMs(response) {
        const m = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '');
        return m ? Number(m[1]) * 1000 : 0;
    }
    globalThis.caches = {
        default: {
            async match(request) {
                const url = typeof request === 'string' ? request : request.url;
                const hit = store.get(url);
                if (!hit) return undefined;
                if (hit.expiresAt <= Date.now()) {
                    store.delete(url);
                    return undefined;
                }
                return hit.response.clone();
            },
            async put(request, response) {
                const url = typeof request === 'string' ? request : request.url;
                const ttl = ttlMs(response);
                if (ttl <= 0) return;
                store.set(url, { response: response.clone(), expiresAt: Date.now() + ttl });
            },
            async delete(request) {
                const url = typeof request === 'string' ? request : request.url;
                return store.delete(url);
            },
        },
    };
    const sweeper = setInterval(() => {
        const now = Date.now();
        for (const [url, hit] of store) if (hit.expiresAt <= now) store.delete(url);
    }, 60_000);
    sweeper.unref();
}
installCache();

const worker = (await import(new URL(config.module, configUrl).href)).default;

// store-sqlite's kv.get ignores the type argument; the workers ask for 'json'.
function typedKv(kv) {
    return {
        ...kv,
        async get(key, type) {
            const value = await kv.get(key);
            if (value === null) return null;
            const kind = typeof type === 'object' && type ? type.type : type;
            return kind === 'json' ? JSON.parse(value) : value;
        },
    };
}

const env = {};
let store = null;
if (config.kv && config.kv.length) {
    if (!dbPath) {
        console.error('config declares KV bindings but no DB_PATH / dbPath is set');
        process.exit(1);
    }
    store = openStore(dbPath);
    for (const name of config.kv) env[name] = typedKv(store.kv);
}
for (const name of config.vars || []) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
    else console.error(`warning: ${name} is not set in the environment`);
}

const ctx = { waitUntil() {}, passThroughOnException() {} };

const server = createServer(async (req, res) => {
    const started = Date.now();
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const request = new Request(`http://${host}:${port}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : body,
    });

    let response;
    try {
        response = await worker.fetch(request, env, ctx);
    } catch (e) {
        console.error('worker error:', e);
        response = new Response(JSON.stringify({ error: 'worker threw' }), { status: 500 });
    }

    const payload = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(payload);
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    console.log(`${req.method} ${req.url} -> ${response.status} ${Date.now() - started}ms ${ip}`);
});

server.headersTimeout = 80_000;
server.keepAliveTimeout = 75_000;

if (store) {
    const sweeper = setInterval(() => store.sweepExpired(), 60_000);
    sweeper.unref();
}

// Cron stand-in: one run at a time, first run shortly after start.
if (config.cronSeconds && typeof worker.scheduled === 'function') {
    let running = false;
    async function tick() {
        if (running) return;
        running = true;
        try {
            await worker.scheduled({ scheduledTime: Date.now(), cron: `${config.cronSeconds}s` }, env, ctx);
        } catch (e) {
            console.error('scheduled error:', e);
        } finally {
            running = false;
        }
    }
    setTimeout(tick, 5_000).unref();
    setInterval(tick, config.cronSeconds * 1000).unref();
}

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: draining`);
    server.close(() => {
        if (store) store.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(port, host, () => {
    console.log(`${config.module} on http://${host}:${port}${dbPath ? `, db ${dbPath}` : ''}`);
});
