// CB Launcher Discord link registry.
//
// Records which Discord accounts have linked the launcher so clients can
// intersect their friend list against it. Callers authenticate with their own
// Discord OAuth2 access token; the worker resolves the caller's identity via
// Discord's API and never trusts client-supplied IDs.
//
// Endpoints (all POST, all require "Authorization: Bearer <token>"):
//   /v1/link              -> registers the caller, 204
//   /v1/unlink            -> deregisters the caller, 204
//   /v1/friends/intersect -> { ids: ["...", ...] } (max 40) -> { linked: ["..."] }
//
// KV cost model: see README. Requests are served memory-first; per-user
// "linked:" keys are only ever read by the cron rebuild of the "index" key.

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_INTERSECT_IDS = 40;
const SNOWFLAKE_RE = /^\d{15,21}$/;
const TOKEN_CACHE_TTL = 3600; // seconds; worst case a revoked token resolves this long
const RATE_LIMIT_PER_MINUTE = 30;
const INDEX_KEY = 'index';
const INDEX_CACHE_TTL_MS = 60_000;

// Per-isolate, best-effort caches; KV or Discord backs every miss.
const tokenCache = new Map(); // token hash -> { id, expiresAt }
const rateBuckets = new Map(); // `${userId}:${minute}` -> count
let indexCache = null; // { ids: Set, fetchedAt }

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function rememberToken(hash, id) {
    tokenCache.set(hash, { id, expiresAt: Date.now() + TOKEN_CACHE_TTL * 1000 });
}

// Resolves the caller's Discord user ID from their access token. Results are
// cached by token hash, in memory first and then in KV (the token itself is
// never stored).
async function resolveCaller(request, env) {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
        return null;
    }

    const token = auth.slice('Bearer '.length).trim();
    if (!token) {
        return null;
    }

    const hash = await sha256Hex(token);

    const memory = tokenCache.get(hash);
    if (memory) {
        if (memory.expiresAt > Date.now()) {
            return memory.id;
        }
        tokenCache.delete(hash);
    }

    const cacheKey = `tok:${hash}`;
    const cached = await env.LINKS.get(cacheKey);
    if (cached) {
        rememberToken(hash, cached);
        return cached;
    }

    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        return null;
    }

    const user = await res.json();
    if (!user || !SNOWFLAKE_RE.test(String(user.id))) {
        return null;
    }

    const id = String(user.id);
    rememberToken(hash, id);
    await env.LINKS.put(cacheKey, id, { expirationTtl: TOKEN_CACHE_TTL });
    return id;
}

// Each isolate counts separately, so the effective global limit is a multiple
// of RATE_LIMIT_PER_MINUTE.
function checkRateLimit(userId) {
    const bucket = Math.floor(Date.now() / 60000);
    const key = `${userId}:${bucket}`;

    if (rateBuckets.size > 10000) {
        for (const staleKey of rateBuckets.keys()) {
            if (!staleKey.endsWith(`:${bucket}`)) {
                rateBuckets.delete(staleKey);
            }
        }
    }

    const count = (rateBuckets.get(key) || 0) + 1;
    rateBuckets.set(key, count);
    return count <= RATE_LIMIT_PER_MINUTE;
}

async function handleLink(userId, env) {
    await env.LINKS.put(`linked:${userId}`, JSON.stringify({ linkedAt: Math.floor(Date.now() / 1000) }));
    return new Response(null, { status: 204 });
}

async function handleUnlink(userId, env) {
    await env.LINKS.delete(`linked:${userId}`);
    return new Response(null, { status: 204 });
}

// Returns the set of all linked IDs, or null if the index has never been
// built (the cron trigger has not run yet).
async function loadIndex(env) {
    const now = Date.now();
    if (indexCache && now - indexCache.fetchedAt < INDEX_CACHE_TTL_MS) {
        return indexCache.ids;
    }

    const raw = await env.LINKS.get(INDEX_KEY);
    if (raw === null) {
        return null;
    }

    let ids;
    try {
        ids = new Set(JSON.parse(raw));
    } catch {
        return null;
    }

    indexCache = { ids, fetchedAt: now };
    return ids;
}

async function handleIntersect(request, userId, env) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: 'invalid json' });
    }

    const ids = body && body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_INTERSECT_IDS) {
        return json(400, { error: `ids must be an array of 1-${MAX_INTERSECT_IDS} entries` });
    }
    if (!ids.every(id => typeof id === 'string' && SNOWFLAKE_RE.test(id))) {
        return json(400, { error: 'ids must be snowflake strings' });
    }

    const unique = [...new Set(ids)].filter(id => id !== userId);

    const index = await loadIndex(env);
    if (index !== null) {
        return json(200, { linked: unique.filter(id => index.has(id)) });
    }

    // Index not built yet (first minute after deploy): fall back to per-key reads.
    const results = await Promise.all(unique.map(id => env.LINKS.get(`linked:${id}`)));
    return json(200, { linked: unique.filter((id, i) => results[i] !== null) });
}

// Rebuilds the "index" key from the per-user "linked:" keys. list() is
// eventually consistent, so a brand-new link can miss one rebuild; the next
// run picks it up.
async function rebuildIndex(env) {
    const ids = [];
    let cursor;
    do {
        const page = await env.LINKS.list({ prefix: 'linked:', cursor });
        for (const key of page.keys) {
            ids.push(key.name.slice('linked:'.length));
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    await env.LINKS.put(INDEX_KEY, JSON.stringify(ids));
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return json(405, { error: 'method not allowed' });
        }

        const userId = await resolveCaller(request, env);
        if (!userId) {
            return json(401, { error: 'unauthorized' });
        }

        if (!checkRateLimit(userId)) {
            return json(429, { error: 'rate limited' });
        }

        const { pathname } = new URL(request.url);
        switch (pathname) {
            case '/v1/link':
                return handleLink(userId, env);
            case '/v1/unlink':
                return handleUnlink(userId, env);
            case '/v1/friends/intersect':
                return handleIntersect(request, userId, env);
            default:
                return json(404, { error: 'not found' });
        }
    },

    async scheduled(controller, env) {
        await rebuildIndex(env);
    },
};
