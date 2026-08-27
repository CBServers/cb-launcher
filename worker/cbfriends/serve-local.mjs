// Runs the cbfriends worker locally with a Map-backed KV, so testing needs no Cloudflare account.
//   node serve-local.mjs [port] [kv.json]   then   cb-launcher.exe -cbfriends-url http://127.0.0.1:8787
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const port = Number(process.argv[2]) || 8787;
const persistPath = process.argv[3] || null;

const module = await import(new URL('./src/index.js', import.meta.url).href);
const worker = module.default;

const store = new Map();
if (persistPath && existsSync(persistPath)) {
    try {
        for (const [k, v] of Object.entries(JSON.parse(readFileSync(persistPath, 'utf8')))) store.set(k, v);
        console.log(`loaded ${store.size} keys from ${persistPath}`);
    } catch (e) {
        console.warn('could not load persisted KV:', e.message);
    }
}
function persist() {
    if (!persistPath) return;
    try {
        writeFileSync(persistPath, JSON.stringify(Object.fromEntries(store), null, 2));
    } catch (e) {
        console.warn('could not persist KV:', e.message);
    }
}
// Durable Object storage shim, backed by the same store as KV so it persists like the real thing.
function doStorage(prefix) {
    const full = key => `${prefix}${key}`;
    return {
        async get(key) {
            const raw = store.get(full(key));
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        async put(keyOrEntries, value) {
            const entries = typeof keyOrEntries === 'object'
                ? Object.entries(keyOrEntries)
                : [[keyOrEntries, value]];
            for (const [k, v] of entries) store.set(full(k), JSON.stringify(v));
            persist();
        },
        async delete(keys) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) store.delete(full(k));
            persist();
        },
        async list({ prefix: p = '', limit, reverse } = {}) {
            let keys = [...store.keys()]
                .filter(k => k.startsWith(full(p)))
                .sort();
            if (reverse) keys.reverse();
            if (limit) keys = keys.slice(0, limit);
            return new Map(keys.map(k => [k.slice(prefix.length), JSON.parse(store.get(k))]));
        },
    };
}

// Runs the worker's real Durable Object classes, one instance per name.
function doBinding(Cls, kind) {
    const instances = new Map();
    return {
        idFromName(name) { return name; },
        get(name) {
            if (!instances.has(name)) {
                instances.set(name, new Cls({ storage: doStorage(`do:${kind}:${name}:`) }));
            }
            return instances.get(name);
        },
    };
}

const env = {
    CB: {
        async get(k) { return store.has(k) ? store.get(k) : null; },
        async put(k, v) { store.set(k, v); persist(); },
        async delete(k) { store.delete(k); persist(); },
        async list({ prefix = '' } = {}) {
            const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
            return { keys, list_complete: true };
        },
    },
    CHAT: doBinding(module.ChatRoom, 'chat'),
    MAILBOX: doBinding(module.Mailbox, 'mailbox'),
};

const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const url = `http://127.0.0.1:${port}${req.url}`;
    const request = new Request(url, {
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

    const text = await response.text();
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(text);
    console.log(`${req.method} ${req.url} -> ${response.status}`);
});

server.listen(port, '127.0.0.1', () => {
    console.log(`cbfriends worker (local) on http://127.0.0.1:${port}`);
    console.log(`launcher:  cb-launcher.exe -cbfriends-url http://127.0.0.1:${port}`);
});
