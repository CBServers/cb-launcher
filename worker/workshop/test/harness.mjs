// Drives the real worker in-process: a fake KV and a routed fetch stub standing in for GitHub and Steam.
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const realFetch = globalThis.fetch;

export function fixture(name) {
    return JSON.parse(readFileSync(`${here}fixtures/${name}`, 'utf8'));
}

export function makeEnv(vars = {}) {
    const kv = new Map();
    const writes = [];
    const env = {
        WORKSHOP: {
            async get(key, type) {
                const value = kv.get(key);
                if (value === undefined) return null;
                return type === 'json' ? JSON.parse(value) : value;
            },
            async put(key, value) { writes.push(key); kv.set(key, String(value)); },
            async delete(key) { kv.delete(key); },
        },
        STEAM_API_KEY: 'test-key',
        ...vars,
    };
    return { env, kv, writes };
}

// routes: [{ test: url => bool, respond: (url, opts) => Response }]. Unmatched URLs fail loudly.
export function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (input, opts) => {
        const url = typeof input === 'string' ? input : input.url;
        calls.push({ url, opts });
        for (const route of routes) {
            if (route.test(url)) return route.respond(url, opts);
        }
        throw new Error(`unrouted fetch: ${url}`);
    };
    return calls;
}

export function restoreFetch() {
    globalThis.fetch = realFetch;
}

export function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Calls the worker's fetch handler like Caddy would.
export function makeClient(worker, env) {
    return async (path, { method = 'GET', params = {}, headers = {} } = {}) => {
        const url = new URL(`http://127.0.0.1:8790${path}`);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        const res = await worker.fetch(new Request(url, { method, headers: { 'CF-Connecting-IP': '10.0.0.1', ...headers } }), env);
        const buffer = Buffer.from(await res.arrayBuffer());
        let body = null;
        try { body = JSON.parse(buffer.toString('utf8')); } catch { body = buffer; }
        return { s: res.status, b: body, h: res.headers };
    };
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
