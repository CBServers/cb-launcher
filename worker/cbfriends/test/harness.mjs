// Shared rig for the worker suites: fake KV, Durable Object shims, signed-request clients.
// Every suite imports the real src/index.js, so nothing here stubs worker logic.
export const mod = await import(new URL('../src/index.js', import.meta.url).href);
export const worker = mod.default;

const enc = new TextEncoder();
export const nowSec = () => Math.floor(Date.now() / 1000);
export const b64 = bytes => Buffer.from(bytes).toString('base64');

export async function sha256Hex(str) {
    const d = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Honours expirationTtl so key expiry behaves like the real namespace.
function fakeKV() {
    const m = new Map();
    const expiry = new Map();
    const live = k => {
        if (expiry.has(k) && Date.now() > expiry.get(k)) { m.delete(k); expiry.delete(k); }
        return m.has(k);
    };
    return {
        async get(k) { return live(k) ? m.get(k) : null; },
        async put(k, v, opts) {
            m.set(k, v);
            if (opts && opts.expirationTtl) expiry.set(k, Date.now() + opts.expirationTtl * 1000);
            else expiry.delete(k);
        },
        async delete(k) { m.delete(k); expiry.delete(k); },
        async list({ prefix = '' } = {}) {
            const keys = [...m.keys()].filter(k => live(k) && k.startsWith(prefix)).map(name => ({ name }));
            return { keys, list_complete: true };
        },
    };
}

// Durable Object storage over a Map that outlives the instance, like the real thing.
function doStorage(disk, prefix) {
    const full = k => prefix + k;
    return {
        async get(k) { const r = disk.get(full(k)); return r === undefined ? undefined : JSON.parse(r); },
        async put(keyOrEntries, value) {
            const entries = typeof keyOrEntries === 'object' ? Object.entries(keyOrEntries) : [[keyOrEntries, value]];
            for (const [k, v] of entries) disk.set(full(k), JSON.stringify(v));
        },
        async delete(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) disk.delete(full(k)); },
        async list({ prefix: p = '', limit, reverse } = {}) {
            let keys = [...disk.keys()].filter(k => k.startsWith(full(p))).sort();
            if (reverse) keys.reverse();
            if (limit) keys = keys.slice(0, limit);
            return new Map(keys.map(k => [k.slice(prefix.length), JSON.parse(disk.get(k))]));
        },
    };
}

// Builds an env plus a disk and a drop() that discards instances without touching their storage.
export function makeEnv() {
    const disk = new Map();
    const made = { CHAT: new Map(), MAILBOX: new Map(), GRAPH: new Map(), DIRECTORY: new Map() };
    const bind = (kind, Cls) => ({
        idFromName: n => n,
        get(n) {
            if (!made[kind].has(n)) {
                made[kind].set(n, new Cls({ storage: doStorage(disk, `${kind}:${n}:`) }));
            }
            return made[kind].get(n);
        },
    });
    const env = { CB: fakeKV() };
    if (mod.ChatRoom) env.CHAT = bind('CHAT', mod.ChatRoom);
    if (mod.Mailbox) env.MAILBOX = bind('MAILBOX', mod.Mailbox);
    if (mod.SocialGraph) env.GRAPH = bind('GRAPH', mod.SocialGraph);
    if (mod.Directory) env.DIRECTORY = bind('DIRECTORY', mod.Directory);
    const drop = kind => made[kind].clear();
    return { env, disk, drop };
}

export async function mk() {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    return { kp, key: b64(pub) };
}

function toDerInt(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let b = bytes.slice(i);
    if (b[0] & 0x80) b = Uint8Array.from([0, ...b]);
    return Uint8Array.from([0x02, b.length, ...b]);
}

// The launcher's libtomcrypt signs in DER, so suites can exercise that encoding too.
export function rawToDer(raw) {
    const r = toDerInt(raw.slice(0, 32));
    const s = toDerInt(raw.slice(32, 64));
    return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

export async function sign(who, bodyText, der = false) {
    const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, who.kp.privateKey, enc.encode(bodyText)));
    return b64(der ? rawToDer(raw) : raw);
}

// Device-key authed client: signs the exact body it sends, as the launcher does.
export function makeClient(env) {
    return async function call(who, path, fields = {}, { der = false, ts = nowSec() } = {}) {
        const body = JSON.stringify({ ts, ...fields });
        const res = await worker.fetch(new Request('https://x' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CB-Key': who.key, 'X-CB-Sig': await sign(who, body, der) },
            body,
        }), env);
        let b = null;
        try { b = await res.json(); } catch { /* empty body */ }
        return { s: res.status, b };
    };
}

// Bearer-authed client for the Discord relay endpoints, which never see a device key.
export function makeRelayClient(env) {
    return async function relay(path, token, body) {
        const res = await worker.fetch(new Request('https://x' + path, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        }), env);
        let b = null;
        try { b = await res.json(); } catch { /* empty body */ }
        return { s: res.status, b };
    };
}

const realFetch = globalThis.fetch;

// Replaces Discord's /users/@me with a local handler so suites need no real token.
export function stubDiscord(handler) {
    globalThis.fetch = async (url, opts) => {
        if (String(url).includes('/users/@me')) {
            const auth = (opts && opts.headers && opts.headers.Authorization) || '';
            const user = handler(auth.replace(/^Bearer\s+/, ''));
            return user ? { ok: true, json: async () => user } : { ok: false };
        }
        return realFetch(url, opts);
    };
}

export function restoreFetch() {
    globalThis.fetch = realFetch;
}

// Tallies assertions and exits non-zero on any failure, so the runner can gate on it.
export function checks() {
    let pass = 0, fail = 0;
    const check = (name, cond) => {
        if (cond) { pass++; console.log('[PASS] ' + name); }
        else { fail++; console.log('[FAIL] ' + name); }
    };
    check.done = () => {
        console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    };
    return check;
}
