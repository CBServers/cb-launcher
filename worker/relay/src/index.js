// Invite relay, replacing the Python one. Speaks the protocol relay_client.cpp already implements,
// so the launcher only needs RELAY_URL repointed. Identity is Discord only, with no CB account
// involved, so Discord friends keep working for users who never opt into a CB profile.
// See README.md for endpoints and the `reason` values the client classifies on.

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE_RE = /^\d{15,21}$/;
const SESSION_TTL = 3600;          // seconds; relay token lifetime
const TOKEN_CACHE_TTL = 3600;      // Discord token -> id cache
const RATE_PER_MINUTE = 30;

const tokenCache = new Map(); // discord token hash -> { id, expiresAt }

function json(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function bearer(request) {
    const auth = request.headers.get('Authorization') || '';
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

// Resolves a Discord access token to its user id, memory-first then KV.
async function resolveDiscordId(env, token) {
    if (!token) return null;
    const hash = await sha256Hex(token);

    const memory = tokenCache.get(hash);
    if (memory && memory.expiresAt > Date.now()) return memory.id;

    const cached = await env.RELAY.get(`tok:${hash}`);
    if (cached) {
        tokenCache.set(hash, { id: cached, expiresAt: Date.now() + TOKEN_CACHE_TTL * 1000 });
        return cached;
    }

    const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !SNOWFLAKE_RE.test(String(user.id))) return null;

    const id = String(user.id);
    tokenCache.set(hash, { id, expiresAt: Date.now() + TOKEN_CACHE_TTL * 1000 });
    await env.RELAY.put(`tok:${hash}`, id, { expirationTtl: TOKEN_CACHE_TTL });
    return id;
}

function mailbox(env, discordId) {
    return env.MAILBOX.get(env.MAILBOX.idFromName(discordId));
}

// Forwards a request into a user's Durable Object.
function toMailbox(env, discordId, path, payload) {
    return mailbox(env, discordId).fetch(new Request(`https://mailbox/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    }));
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
        const { pathname } = new URL(request.url);

        // Mint a relay session from a Discord bearer.
        if (pathname === '/v1/session/start') {
            const discordId = await resolveDiscordId(env, bearer(request));
            if (!discordId) return json(401, { error: 'unauthorized' });

            const relayToken = 'rl_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
            await env.RELAY.put(`sess:${await sha256Hex(relayToken)}`, discordId, { expirationTtl: SESSION_TTL });
            // Server-side kill switch the client honours.
            const enabled = (await env.RELAY.get('relayEnabled')) !== 'false';
            return json(200, { relayToken, relayEnabled: enabled });
        }

        // Everything else is authenticated by the relay token.
        const token = bearer(request);
        if (!token) return json(401, { error: 'unauthorized' });
        const me = await env.RELAY.get(`sess:${await sha256Hex(token)}`);
        if (!me) return json(401, { error: 'unauthorized' });

        let body = {};
        try { body = await request.json(); } catch { body = {}; }

        if (pathname === '/v1/poll') {
            return toMailbox(env, me, 'poll', { ack: body.ack, session: body.session });
        }

        if (pathname === '/v1/invite' || pathname === '/v1/invite/reply') {
            const to = String(body.to || '');
            if (!SNOWFLAKE_RE.test(to) || to === me) return json(200, { reason: 'failed' });

            // Rate limited in the sender's own DO so the count stays consistent.
            const gate = await toMailbox(env, me, 'rate', { limit: RATE_PER_MINUTE });
            if (!(await gate.json()).allowed) return json(429, { reason: 'throttled' });

            const isReply = pathname === '/v1/invite/reply';
            const message = {
                id: 'rmsg_' + crypto.randomUUID().replace(/-/g, ''),
                from: me,
                kind: isReply ? 'invite' : (body.kind === 'join-request' ? 'join-request' : 'invite'),
                game: String(body.game || ''),
                matchId: String(body.matchId || ''),
                joinSecret: (!isReply || body.accept !== false) ? String(body.joinSecret || '') : '',
                isApproval: isReply,
                accept: body.accept !== false,
            };
            return toMailbox(env, to, 'deliver', { message });
        }

        return json(404, { error: 'not found' });
    },
};

// One instance per Discord user, holding that user's long-poll and mailbox.
export class Mailbox {
    constructor(state) {
        this.state = state;
        this.messages = [];
        this.waiters = [];
        this.lastSeen = 0;
        this.rate = new Map();
        this.snapshot = null;
    }

    // A recipient who hasn't polled recently is offline, so the sender falls back to the SDK.
    reachable() {
        return Date.now() - this.lastSeen < 90_000;
    }

    wake() {
        const waiters = this.waiters.splice(0);
        for (const resolve of waiters) resolve();
    }

    async fetch(request) {
        const { pathname } = new URL(request.url);
        const body = await request.json().catch(() => ({}));

        if (pathname === '/rate') {
            const bucket = Math.floor(Date.now() / 60000);
            for (const key of this.rate.keys()) if (key !== bucket) this.rate.delete(key);
            const count = (this.rate.get(bucket) || 0) + 1;
            this.rate.set(bucket, count);
            return json(200, { allowed: count <= (body.limit || RATE_PER_MINUTE) });
        }

        if (pathname === '/deliver') {
            if (!this.reachable()) return json(200, { reason: 'offline' });
            this.messages.push(body.message);
            if (this.messages.length > 64) this.messages.shift();
            this.wake();
            return json(200, { reason: 'delivered' });
        }

        if (pathname === '/poll') {
            this.lastSeen = Date.now();
            if (body.session && typeof body.session === 'object') this.snapshot = body.session;

            const acked = new Set(Array.isArray(body.ack) ? body.ack : []);
            if (acked.size) this.messages = this.messages.filter(m => !acked.has(m.id));
            if (this.messages.length) return json(200, { invites: this.messages });

            // Hold until a delivery wakes it or the hold elapses.
            await new Promise(resolve => {
                let done = false;
                const finish = () => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    this.waiters = this.waiters.filter(w => w !== finish);
                    resolve();
                };
                const timer = setTimeout(finish, 25_000);
                this.waiters.push(finish);
            });
            return json(200, { invites: this.messages });
        }

        return json(404, { error: 'not found' });
    }
}
