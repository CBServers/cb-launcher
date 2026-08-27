// Standalone Node build of the relay for local testing, speaking the same protocol as src/index.js.
//   node serve-local.mjs [port]   then   cb-launcher.exe -relay-url http://127.0.0.1:8091
// A bearer of the form "dev:<discord id>" is accepted so tests don't need real Discord tokens.
import { createServer } from 'node:http';

const PORT = Number(process.argv[2]) || 8091;
const DISCORD_API = 'https://discord.com/api/v10';
// How long a poll is held before returning empty. The client allows 40s; override for tests.
const POLL_HOLD_MS = Number(process.env.RELAY_POLL_HOLD_MS) || 25_000;
const SESSION_TTL_MS = 60 * 60_000;
const OFFLINE_AFTER_MS = 90_000; // not seen polling this long => offline, so the sender uses the SDK
const RATE_PER_MIN = 30;

// In-memory state; the Durable Object version shards this per user.
const sessions = new Map(); // relayToken -> { discordId, expiresAt }
const users = new Map();    // discordId -> { mailbox, waiters, lastSeen, snapshot, rate }
let msgSeq = 0;

function user(id) {
    let u = users.get(id);
    if (!u) { u = { mailbox: [], waiters: [], lastSeen: 0, snapshot: null, rate: new Map() }; users.set(id, u); }
    return u;
}

function randToken() {
    return 'rl_' + [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function resolveDiscordId(auth) {
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    if (token.startsWith('dev:')) return token.slice(4);
    try {
        const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const u = await res.json();
        return u && /^\d{15,21}$/.test(String(u.id)) ? String(u.id) : null;
    } catch { return null; }
}

function sessionId(auth) {
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const s = sessions.get(auth.slice(7).trim());
    if (!s || s.expiresAt < Date.now()) return null;
    return s.discordId;
}

function deliver(toId, msg) {
    const u = user(toId);
    u.mailbox.push(msg);
    const waiters = u.waiters.splice(0);
    for (const resolve of waiters) resolve();
}

function reachable(id) {
    const u = users.get(id);
    return !!(u && Date.now() - u.lastSeen < OFFLINE_AFTER_MS);
}

function allowed(fromId) {
    const u = user(fromId);
    const bucket = Math.floor(Date.now() / 60000);
    const n = (u.rate.get(bucket) || 0) + 1;
    u.rate.set(bucket, n);
    for (const k of u.rate.keys()) if (k !== bucket) u.rate.delete(k);
    return n <= RATE_PER_MIN;
}

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
}

const server = createServer(async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    const auth = req.headers['authorization'];
    const url = req.url.split('?')[0];

    // Exchange a Discord bearer for a relay token.
    if (url === '/v1/session/start') {
        const discordId = await resolveDiscordId(auth);
        if (!discordId) return send(res, 401, { error: 'unauthorized' });
        const token = randToken();
        sessions.set(token, { discordId, expiresAt: Date.now() + SESSION_TTL_MS });
        user(discordId).lastSeen = Date.now();
        return send(res, 200, { relayToken: token, relayEnabled: true });
    }

    const me = sessionId(auth);
    if (!me) return send(res, 401, { error: 'unauthorized' });
    const body = await readBody(req);

    if (url === '/v1/poll') {
        const u = user(me);
        u.lastSeen = Date.now();
        if (body && body.session && typeof body.session === 'object') u.snapshot = body.session;
        // Drop delivered messages the client confirmed.
        const acked = new Set(Array.isArray(body.ack) ? body.ack : []);
        if (acked.size) u.mailbox = u.mailbox.filter(m => !acked.has(m.id));
        if (u.mailbox.length) return send(res, 200, { invites: u.mailbox });

        // Hold until a message arrives, the hold elapses, or the client disconnects.
        await new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                u.waiters = u.waiters.filter(w => w !== waiter);
                res.off('close', finish);
                resolve();
            };
            const waiter = finish;
            const timer = setTimeout(finish, POLL_HOLD_MS);
            u.waiters.push(waiter);
            res.on('close', finish);
        });
        if (res.writableEnded) return;
        return send(res, 200, { invites: user(me).mailbox });
    }

    if (url === '/v1/invite') {
        if (!allowed(me)) return send(res, 429, { reason: 'throttled' });
        const to = String(body.to || '');
        if (!to || to === me) return send(res, 200, { reason: 'failed' });
        if (!reachable(to)) return send(res, 200, { reason: 'offline' });
        deliver(to, {
            id: 'rmsg_' + (++msgSeq) + '_' + Date.now().toString(36),
            from: me,
            kind: body.kind === 'join-request' ? 'join-request' : 'invite',
            game: String(body.game || ''),
            matchId: String(body.matchId || ''),
            joinSecret: String(body.joinSecret || ''),
            isApproval: false,
            accept: true,
        });
        return send(res, 200, { reason: 'delivered' });
    }

    if (url === '/v1/invite/reply') {
        if (!allowed(me)) return send(res, 429, { reason: 'throttled' });
        const to = String(body.to || '');
        if (!to || to === me) return send(res, 200, { reason: 'failed' });
        if (!reachable(to)) return send(res, 200, { reason: 'offline' });
        deliver(to, {
            id: 'rmsg_' + (++msgSeq) + '_' + Date.now().toString(36),
            from: me,
            kind: 'invite',
            game: String(body.game || ''),
            matchId: String(body.matchId || ''),
            joinSecret: body.accept ? String(body.joinSecret || '') : '',
            isApproval: true,
            accept: body.accept !== false,
        });
        return send(res, 200, { reason: 'delivered' });
    }

    return send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`relay (local) on http://127.0.0.1:${PORT}`);
    console.log(`launcher:  cb-launcher.exe -relay-url http://127.0.0.1:${PORT}`);
});
