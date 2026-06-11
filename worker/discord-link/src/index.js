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

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_INTERSECT_IDS = 40;
const SNOWFLAKE_RE = /^\d{15,21}$/;
const TOKEN_CACHE_TTL = 300; // seconds
const RATE_LIMIT_PER_MINUTE = 30;

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

// Resolves the caller's Discord user ID from their access token. Results are
// cached briefly by token hash (the token itself is never stored).
async function resolveCaller(request, env) {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
        return null;
    }

    const token = auth.slice('Bearer '.length).trim();
    if (!token) {
        return null;
    }

    const cacheKey = `tok:${await sha256Hex(token)}`;
    const cached = await env.LINKS.get(cacheKey);
    if (cached) {
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

    await env.LINKS.put(cacheKey, String(user.id), { expirationTtl: TOKEN_CACHE_TTL });
    return String(user.id);
}

async function checkRateLimit(env, userId) {
    const bucket = Math.floor(Date.now() / 60000);
    const key = `rl:${userId}:${bucket}`;
    const count = parseInt((await env.LINKS.get(key)) || '0', 10) + 1;
    // Not atomic, but good enough to stop abuse
    await env.LINKS.put(key, String(count), { expirationTtl: 120 });
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
    const results = await Promise.all(unique.map(id => env.LINKS.get(`linked:${id}`)));
    const linked = unique.filter((id, i) => results[i] !== null);

    return json(200, { linked });
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

        if (!(await checkRateLimit(env, userId))) {
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
};
