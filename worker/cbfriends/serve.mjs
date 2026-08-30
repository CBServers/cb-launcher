// Production Node harness for the cbfriends worker: real src/index.js, SQLite-backed KV and
// persistent DO storage, in-memory Mailbox/Directory (deliberately non-persistent — presence
// expires in 90s and invites fall back to the Discord SDK, so surviving a restart buys
// nothing). serve-local.mjs remains the throwaway dev harness.
//
//   node serve.mjs                          # 127.0.0.1:8787, ./cbfriends.db
//   HOST=0.0.0.0 PORT=9000 DB_PATH=/var/lib/cbfriends/cbfriends.db node serve.mjs
//
// MUST run as a single process: Mailbox and Directory live in this process's memory,
// so load-balancing across workers would fork presence and mailboxes.
import { createServer } from 'node:http';
import { openStore } from './store-sqlite.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 8787;
const dbPath = process.env.DB_PATH || new URL('./cbfriends.db', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1');

const module = await import(new URL('./src/index.js', import.meta.url).href);
const worker = module.default;
const store = openStore(dbPath);

// Same surface as store-sqlite's doStorage, over a Map that lives and dies with the process.
function memStorage() {
    const m = new Map();
    return {
        async get(key) { return m.has(key) ? JSON.parse(m.get(key)) : undefined; },
        async put(keyOrEntries, value) {
            const entries = typeof keyOrEntries === 'object' ? Object.entries(keyOrEntries) : [[keyOrEntries, value]];
            for (const [k, v] of entries) m.set(k, JSON.stringify(v));
        },
        async delete(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) m.delete(k); },
        async list({ prefix = '', start, end, limit, reverse } = {}) {
            let keys = [...m.keys()].filter(k => k.startsWith(prefix)).sort();
            if (start !== undefined) keys = keys.filter(k => k >= start);
            if (end !== undefined) keys = keys.filter(k => k < end);
            if (reverse) keys.reverse();
            if (limit) keys = keys.slice(0, limit);
            return new Map(keys.map(k => [k, JSON.parse(m.get(k))]));
        },
    };
}

function doBinding(Cls, kind, persistent) {
    const instances = new Map();
    return {
        idFromName(name) { return name; },
        get(name) {
            if (!instances.has(name)) {
                const storage = persistent ? store.doStorage(`do:${kind}:${name}:`) : memStorage();
                instances.set(name, new Cls({ storage }));
            }
            return instances.get(name);
        },
    };
}

const env = {
    CB: store.kv,
    CHAT: doBinding(module.ChatRoom, 'chat', true),
    GRAPH: doBinding(module.SocialGraph, 'graph', true),
    MAILBOX: doBinding(module.Mailbox, 'mailbox', false),
    DIRECTORY: doBinding(module.Directory, 'directory', false),
};

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
        response = await worker.fetch(request, env);
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

// The /poll and chat /poll handlers hold requests for 25s; Node's defaults would sever them.
server.requestTimeout = 0;
server.headersTimeout = 80_000;
server.keepAliveTimeout = 75_000;

const sweeper = setInterval(() => store.sweepExpired(), 60_000);
sweeper.unref();

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal}: draining (held polls resolve within 25s)`);
    server.close(() => {
        store.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(0), 30_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(port, host, () => {
    console.log(`cbfriends on http://${host}:${port}, db ${dbPath}`);
});
