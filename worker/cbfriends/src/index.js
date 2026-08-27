// CB social account registry. Clients authenticate with a device ECC keypair (P-256): every request
// carries X-CB-Key (public key) and X-CB-Sig (signature over the raw body, which must include a
// fresh "ts"). cbId is assigned server-side and decoupled from any key, so keys can be recovered.
// See README.md for the endpoint list. Storage is KV: acct:<cbId> plus reverse indices.

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE_RE = /^\d{15,21}$/;
const HANDLE_RE = /^[a-z0-9_]{2,32}$/i;
const HWID_RE = /^[0-9a-f]{64}$/i; // sha256 hex from the launcher
const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const AVATAR_URL_RE = /^https?:\/\/[^\s]+$/i;
// Avatars are fetched by every viewer's launcher, so an arbitrary host would be an IP grabber.
const AVATAR_HOSTS = new Set([
    'cdn.discordapp.com', 'media.discordapp.net',
    'i.imgur.com', 'imgur.com',
    'avatars.githubusercontent.com',
    'steamcdn-a.akamaihd.net', 'avatars.steamstatic.com',
    'cdn.cbservers.xyz',
]);
// The launcher itself polls ~54/min in steady state, so this only has to be high enough to leave
// room for user actions on top while still stopping scripted abuse.
const RATE_PER_MINUTE = 240;       // per device key, across the CB endpoints
const RECOVER_PER_HOUR = 5;        // per anchor; HWID is a weak secret
const RECOVER_BLOCK_IF_ACTIVE_MS = 5 * 60_000; // an account in active use does not need recovery
const SECURITY_EVENTS = 20;
const CHAT_PAGE = 50;         // scrollback page size
const DM_PREFIX = 'dm-';      // reserved room-id prefix; the open chat endpoints refuse it
const TS_SKEW_SECONDS = 300;

function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function b64ToBytes(b64) {
    try {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The launcher's libtomcrypt emits DER SEQUENCE{r,s}; WebCrypto wants raw r||s.
function derToRaw(der, size = 32) {
    let i = 0;
    if (der[i++] !== 0x30) throw new Error('not a DER sequence');
    let seqLen = der[i++];
    if (seqLen & 0x80) {
        let n = seqLen & 0x7f;
        seqLen = 0;
        while (n-- > 0) seqLen = (seqLen << 8) | der[i++];
    }
    const readInt = () => {
        if (der[i++] !== 0x02) throw new Error('expected integer');
        let len = der[i++];
        let bytes = der.subarray(i, i + len);
        i += len;
        while (bytes.length > 1 && bytes[0] === 0x00) bytes = bytes.subarray(1);
        if (bytes.length > size) throw new Error('integer too large');
        const out = new Uint8Array(size);
        out.set(bytes, size - bytes.length);
        return out;
    };
    const r = readInt();
    const s = readInt();
    const raw = new Uint8Array(size * 2);
    raw.set(r, 0);
    raw.set(s, size);
    return raw;
}

// A raw P-256 signature is exactly 64 bytes and DER is a 0x30-tagged sequence, but a raw r can also
// start with 0x30, so offer both readings instead of sniffing the first byte.
function signatureForms(sig) {
    const forms = [];
    if (sig.length === 64) forms.push(sig);
    if (sig[0] === 0x30) {
        try { forms.push(derToRaw(sig)); } catch { /* not DER after all */ }
    }
    return forms;
}

// Verifies the signature, returning { fpr, body } or an error Response the caller propagates.
async function authenticate(request) {
    const keyB64 = request.headers.get('X-CB-Key');
    const sigB64 = request.headers.get('X-CB-Sig');
    if (!keyB64 || !sigB64) {
        return { error: json(401, { error: 'missing signature headers' }) };
    }

    const pub = b64ToBytes(keyB64);
    const sig = b64ToBytes(sigB64);
    if (!pub || !sig || pub.length !== 65 || pub[0] !== 0x04) {
        return { error: json(401, { error: 'malformed key or signature' }) };
    }

    const bodyText = await request.text();
    const bodyBytes = new TextEncoder().encode(bodyText);

    let ok = false;
    try {
        const key = await crypto.subtle.importKey(
            'raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        for (const raw of signatureForms(sig)) {
            ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, bodyBytes);
            if (ok) break;
        }
    } catch {
        ok = false;
    }
    if (!ok) {
        return { error: json(401, { error: 'signature verification failed' }) };
    }

    let body;
    try {
        body = JSON.parse(bodyText);
    } catch {
        return { error: json(400, { error: 'invalid json' }) };
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof body.ts !== 'number' || Math.abs(now - body.ts) > TS_SKEW_SECONDS) {
        return { error: json(401, { error: 'stale or missing ts' }) };
    }

    return { fpr: await sha256Hex(pub), body };
}

const rateBuckets = new Map(); // `${key}:${minute}` -> count

// Fixed windows of windowMs. Each isolate counts separately, so the effective limit is a multiple
// of this; it exists to stop scripted abuse, not to be exact.
function withinRate(key, limit, windowMs = 60_000) {
    const bucket = Math.floor(Date.now() / windowMs);
    if (rateBuckets.size > 10000) {
        const cutoff = Date.now() - 3600_000;
        for (const [k, v] of rateBuckets) {
            if (v.seen < cutoff) rateBuckets.delete(k);
        }
    }
    const id = `${key}:${windowMs}:${bucket}`;
    const entry = rateBuckets.get(id) || { count: 0, seen: 0 };
    entry.count += 1;
    entry.seen = Date.now();
    rateBuckets.set(id, entry);
    return entry.count <= limit;
}

function newCbId() {
    return 'cb_' + crypto.randomUUID().replace(/-/g, '');
}

function newRecoveryCode() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.match(/.{4}/g).join('-'); // e.g. 1A2B-3C4D-...
}

async function getAccount(env, cbId) {
    const raw = await env.CB.get(`acct:${cbId}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function putAccount(env, account) {
    await env.CB.put(`acct:${account.cbId}`, JSON.stringify(account));
}

function publicView(account, extra = {}) {
    return { cbId: account.cbId, profile: account.profile, ...extra };
}

// Adds a device key to an account and its index. Idempotent.
async function attachDeviceKey(env, account, fpr) {
    if (!account.deviceKeys.includes(fpr)) {
        account.deviceKeys.push(fpr);
        await putAccount(env, account);
    }
    await env.CB.put(`dev:${fpr}`, account.cbId);
    return publicView(account);
}

// Resolves the caller's Discord account, including the bits we seed a CB profile from.
async function resolveDiscordUser(token) {
    if (!token || typeof token !== 'string') return null;
    const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || !SNOWFLAKE_RE.test(String(user.id))) return null;

    const id = String(user.id);
    // Animated avatars are served as .gif; everything else (including the default) as .png.
    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.${String(user.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`;

    return { id, avatarUrl, displayName: user.global_name || user.username || '' };
}

async function resolveDiscordId(token) {
    const user = await resolveDiscordUser(token);
    return user ? user.id : null;
}

async function handleBootstrap(env, fpr, body) {
    if (typeof body.hwidHash !== 'string' || !HWID_RE.test(body.hwidHash)) {
        return json(400, { error: 'hwidHash must be a sha256 hex string' });
    }

    // A device key we already know just gets its account back.
    const existingCbId = await env.CB.get(`dev:${fpr}`);
    if (existingCbId) {
        const account = await getAccount(env, existingCbId);
        if (account) return json(200, publicView(account, { created: false }));
    }

    // Don't mint a duplicate if this machine or Discord already owns an account.
    const discordUser = await resolveDiscordUser(body.discordToken);
    const discordId = discordUser ? discordUser.id : null;
    const hwidOwner = await env.CB.get(`hwid:${body.hwidHash}`);
    const discordOwner = discordId ? await env.CB.get(`discord:${discordId}`) : null;
    if (hwidOwner || discordOwner) {
        const via = [];
        if (hwidOwner) via.push('hwid');
        if (discordOwner) via.push('discord');
        return json(409, { error: 'account exists for this device', recoverable: true, via });
    }

    // Handles are globally unique and case-insensitive.
    let handle = null;
    if (body.handle != null) {
        if (typeof body.handle !== 'string' || !HANDLE_RE.test(body.handle)) {
            return json(400, { error: 'handle must be 2-32 chars of [a-z0-9_]' });
        }
        const folded = body.handle.toLowerCase();
        if (await env.CB.get(`handle:${folded}`)) {
            return json(409, { error: 'handle taken' });
        }
        handle = body.handle;
    }

    const recoveryCode = newRecoveryCode();
    const account = {
        cbId: newCbId(),
        createdAt: Math.floor(Date.now() / 1000),
        deviceKeys: [fpr],
        discordId: discordId || null,
        hwidHash: body.hwidHash,
        recoveryCodeHash: await sha256Hex(new TextEncoder().encode(recoveryCode)),
        profile: {
            handle,
            // Seeded from the linked Discord account unless the client supplied its own.
            displayName: typeof body.displayName === 'string' && body.displayName
                ? body.displayName.slice(0, 64)
                : (discordUser ? discordUser.displayName.slice(0, 64) : ''),
            avatarUrl: typeof body.avatarUrl === 'string' && body.avatarUrl
                ? body.avatarUrl.slice(0, 512)
                : (discordUser ? discordUser.avatarUrl : ''),
        },
    };

    await putAccount(env, account);
    await env.CB.put(`dev:${fpr}`, account.cbId);
    await env.CB.put(`hwid:${account.hwidHash}`, account.cbId);
    await env.CB.put(`rec:${account.recoveryCodeHash}`, account.cbId);
    if (discordId) await env.CB.put(`discord:${discordId}`, account.cbId);
    if (handle) await env.CB.put(`handle:${handle.toLowerCase()}`, account.cbId);

    // Returned exactly once and never stored in the clear.
    return json(200, publicView(account, { created: true, recoveryCode }));
}

async function handleWhoami(env, fpr) {
    const cbId = await env.CB.get(`dev:${fpr}`);
    if (!cbId) return json(404, { error: 'unknown device key' });
    const account = await getAccount(env, cbId);
    if (!account) return json(404, { error: 'account not found' });
    return json(200, publicView(account));
}

// Changing the handle re-claims the unique index and 409s if someone else holds it.
async function handleProfileUpdate(env, cbId, body) {
    const account = await getAccount(env, cbId);
    if (!account) return json(404, { error: 'account not found' });

    if (typeof body.displayName === 'string') {
        account.profile.displayName = body.displayName.slice(0, 64);
    }
    // A custom avatar is remembered so the Discord sync stops overwriting it; clearing the field
    // hands control back to Discord.
    if (typeof body.avatarUrl === 'string') {
        const url = body.avatarUrl.trim().slice(0, 512);
        if (!url) {
            account.profile.avatarUrl = '';
            account.profile.avatarCustom = false;
        } else if (!AVATAR_URL_RE.test(url)) {
            return json(400, { error: 'avatar must be an http(s) URL' });
        } else if (!AVATAR_HOSTS.has(new URL(url).hostname.toLowerCase())) {
            // Every viewer's launcher fetches this URL, so an arbitrary host would see their IP.
            return json(400, { error: 'avatar host not allowed', allowed: [...AVATAR_HOSTS] });
        } else {
            account.profile.avatarUrl = url;
            account.profile.avatarCustom = true;
        }
    }
    if (typeof body.bio === 'string') {
        account.profile.bio = body.bio.slice(0, 200);
    }
    if (typeof body.accent === 'string') {
        account.profile.accent = ACCENT_RE.test(body.accent) ? body.accent : '';
    }
    if (typeof body.favoriteGame === 'string') {
        account.profile.favoriteGame = body.favoriteGame.slice(0, 32);
    }

    if (typeof body.handle === 'string' && body.handle) {
        if (!HANDLE_RE.test(body.handle)) return json(400, { error: 'invalid handle' });
        const newFold = body.handle.toLowerCase();
        const oldFold = (account.profile.handle || '').toLowerCase();
        if (newFold !== oldFold) {
            const owner = await env.CB.get(`handle:${newFold}`);
            if (owner && owner !== cbId) return json(409, { error: 'handle taken' });
            if (oldFold) await env.CB.delete(`handle:${oldFold}`);
            await env.CB.put(`handle:${newFold}`, cbId);
        }
        account.profile.handle = body.handle;
    }

    await putAccount(env, account);
    return json(200, publicView(account));
}

// Attaches the signing key to the account found via the anchor. HWID is a weak anchor: rate-limit it.
async function handleRecover(env, fpr, body, anchorKey, via) {
    // Rate limited on the anchor, not the caller, so a fresh key per attempt buys nothing.
    if (!withinRate(`rec:${anchorKey}`, RECOVER_PER_HOUR, 3600_000)) {
        return json(429, { error: 'too many recovery attempts' });
    }

    const cbId = await env.CB.get(anchorKey);
    if (!cbId) return json(404, { error: 'no account for this anchor' });
    const account = await getAccount(env, cbId);
    if (!account) return json(404, { error: 'account not found' });

    // HWID is a weak secret: anyone who learns the hash could bind their own key. An account that is
    // actively online does not need recovering, so refuse rather than hand it over. Discord and the
    // recovery code both prove possession of a real secret, so they are exempt.
    if (via === 'hwid' && !account.deviceKeys.includes(fpr)) {
        const pres = await presenceFor(env, cbId);
        if (pres.lastSeen && Date.now() - pres.lastSeen < RECOVER_BLOCK_IF_ACTIVE_MS) {
            await pushSecurityEvent(env, cbId, { kind: 'recover-blocked', via: 'hwid' });
            return json(409, { error: 'account is in use; sign in on the active device or use Discord or a recovery code' });
        }
    }

    const isNewKey = !account.deviceKeys.includes(fpr);
    const view = await attachDeviceKey(env, account, fpr);
    if (isNewKey) {
        await pushSecurityEvent(env, cbId, { kind: 'device-added', via });
    }
    return json(200, view);
}

// The owner polls this to see device binds and blocked attempts on their account.
async function handleSecurityEvents(env, cbId) {
    return json(200, { events: await readArray(env, `sec:${cbId}`) });
}

// Records something the account's owner should know about, such as a new device being bound.
async function pushSecurityEvent(env, cbId, event) {
    const events = await readArray(env, `sec:${cbId}`);
    events.push({ ...event, at: Date.now() });
    await env.CB.put(`sec:${cbId}`, JSON.stringify(events.slice(-SECURITY_EVENTS)));
}

// True if either side blocked the other, so neither can reach the other. Blocks stay out of the
// public profile view, so being blocked is not observable.
async function eitherBlocked(env, a, b) {
    const [ga, gb] = await Promise.all([graphGet(env, a), graphGet(env, b)]);
    return ga.blocked.includes(b) || gb.blocked.includes(a);
}

async function handleBlockAdd(env, cbId, body) {
    const target = String(body.cbId || '');
    if (!target || target === cbId) return json(400, { error: 'bad target' });
    if (!(await getAccount(env, target))) return json(404, { error: 'no such profile' });

    // Blocking also severs any existing relationship, in both directions.
    await Promise.all([
        graphApply(env, cbId, [
            { op: 'add', list: 'blocked', cbId: target },
            { op: 'remove', list: 'friends', cbId: target },
            { op: 'remove', list: 'incoming', cbId: target },
            { op: 'remove', list: 'outgoing', cbId: target },
        ]),
        graphApply(env, target, [
            { op: 'remove', list: 'friends', cbId },
            { op: 'remove', list: 'incoming', cbId },
            { op: 'remove', list: 'outgoing', cbId },
        ]),
    ]);
    return json(200, { ok: true });
}

async function handleBlockRemove(env, cbId, body) {
    await graphApply(env, cbId, [{ op: 'remove', list: 'blocked', cbId: String(body.cbId || '') }]);
    return json(200, { ok: true });
}

async function handleBlockList(env, cbId) {
    return json(200, { blocked: await peopleViews(env, (await graphGet(env, cbId)).blocked) });
}

// Reports queue for a moderator; nothing is actioned automatically.
async function handleReport(env, cbId, body) {
    const target = String(body.cbId || '');
    if (!target || target === cbId) return json(400, { error: 'bad target' });
    const id = 'rep_' + crypto.randomUUID().replace(/-/g, '');
    await env.CB.put(`report:${id}`, JSON.stringify({
        id,
        reporter: cbId,
        target,
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : '',
        context: typeof body.context === 'string' ? body.context.slice(0, 300) : '',
        at: Date.now(),
        status: 'open',
    }));
    return json(200, { ok: true, id });
}

// ---- moderation ----
//
// Authority is a server-side allowlist keyed by cbId, never by handle (which changes) or HWID
// (which is a forgeable machine-local secret). The device-key signature already proves who is
// calling, so a role is just a lookup. Every mod endpoint re-checks it; the client hiding a tab
// is cosmetic.
//
// `admin` is settable only by writing `role:<cbId>` in KV directly, so there is no in-app path
// from a compromised moderator to full control. An admin can grant and revoke `mod`.

const MOD_REPORT_PAGE = 100;
const MOD_LOG_KEEP = 500;

async function roleOf(env, cbId) {
    return (await env.CB.get(`role:${cbId}`)) || '';
}

// Returns the caller's role, or an error Response the caller propagates.
async function requireRole(env, cbId, needed) {
    const role = await roleOf(env, cbId);
    const ok = needed === 'admin' ? role === 'admin' : (role === 'mod' || role === 'admin');
    // 404 rather than 403: a non-moderator cannot tell these endpoints exist.
    return ok ? { role } : { error: json(404, { error: 'not found' }) };
}

// Records who did what to whom, so moderator actions are auditable after the fact.
async function modLog(env, cbId, action, target, detail) {
    const at = Date.now();
    const id = `modlog:${String(at).padStart(14, '0')}_${crypto.randomUUID().slice(0, 8)}`;
    await env.CB.put(id, JSON.stringify({ at, by: cbId, action, target, detail: detail || '' }));
}

// A mute is a record with an expiry rather than a flag, so temporary mutes lapse on their own.
async function activeMute(env, cbId) {
    const raw = await env.CB.get(`muted:${cbId}`);
    if (!raw) return null;
    let mute;
    try { mute = JSON.parse(raw); } catch { return { until: 0, reason: '' }; }
    if (mute.until && Date.now() > mute.until) {
        await env.CB.delete(`muted:${cbId}`);
        return null;
    }
    return mute;
}

async function handleModStatus(env, cbId) {
    return json(200, { role: await roleOf(env, cbId) });
}

// Newest first, so the queue opens on what just came in.
async function handleModReports(env, cbId, body) {
    const gate = await requireRole(env, cbId, 'mod');
    if (gate.error) return gate.error;

    const wantOpen = body.status !== 'all';
    const reports = [];
    let cursor;
    do {
        const page = await env.CB.list({ prefix: 'report:', cursor });
        for (const entry of page.keys) {
            const raw = await env.CB.get(entry.name);
            if (!raw) continue;
            let rec;
            try { rec = JSON.parse(raw); } catch { continue; }
            if (wantOpen && rec.status !== 'open') continue;
            reports.push(rec);
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor && reports.length < MOD_REPORT_PAGE * 4);

    reports.sort((a, b) => b.at - a.at);
    const page = reports.slice(0, MOD_REPORT_PAGE);

    // Both sides of a report are named, so the queue is readable without a second lookup each.
    const ids = [...new Set(page.flatMap(r => [r.reporter, r.target]))];
    const people = Object.fromEntries((await peopleViews(env, ids)).map(p => [p.cbId, p]));
    return json(200, {
        reports: page.map(r => ({ ...r, reporterProfile: people[r.reporter], targetProfile: people[r.target] })),
        total: reports.length,
    });
}

async function handleModResolve(env, cbId, body) {
    const gate = await requireRole(env, cbId, 'mod');
    if (gate.error) return gate.error;

    const raw = await env.CB.get(`report:${body.id}`);
    if (!raw) return json(404, { error: 'no such report' });
    const rec = JSON.parse(raw);
    rec.status = body.status === 'open' ? 'open' : 'closed';
    rec.handledBy = cbId;
    rec.handledAt = Date.now();
    await env.CB.put(`report:${rec.id}`, JSON.stringify(rec));
    await modLog(env, cbId, 'resolve', rec.target, rec.id);
    return json(200, { ok: true });
}

// minutes <= 0 unmutes, so one endpoint covers both directions.
async function handleModMute(env, cbId, body) {
    const gate = await requireRole(env, cbId, 'mod');
    if (gate.error) return gate.error;

    const target = String(body.cbId || '');
    if (!target) return json(400, { error: 'cbId required' });
    if (await roleOf(env, target)) return json(403, { error: 'cannot mute a moderator' });

    const minutes = Number.isFinite(body.minutes) ? Math.trunc(body.minutes) : 0;
    if (minutes <= 0) {
        await env.CB.delete(`muted:${target}`);
        await modLog(env, cbId, 'unmute', target, '');
        return json(200, { ok: true, muted: false });
    }

    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
    const until = Date.now() + minutes * 60_000;
    await env.CB.put(`muted:${target}`, JSON.stringify({ until, reason, by: cbId, at: Date.now() }));
    await modLog(env, cbId, 'mute', target, `${minutes}m ${reason}`);
    return json(200, { ok: true, muted: true, until });
}

// The moderator's view of one account: profile, mute state, and who they have been reported by.
async function handleModLookup(env, cbId, body) {
    const gate = await requireRole(env, cbId, 'mod');
    if (gate.error) return gate.error;

    let target = String(body.cbId || '');
    if (!target && typeof body.handle === 'string') {
        target = (await env.CB.get(`handle:${body.handle.toLowerCase()}`)) || '';
    }
    if (!target) return json(404, { error: 'no such account' });

    const account = await getAccount(env, target);
    if (!account) return json(404, { error: 'no such account' });

    return json(200, {
        person: await personView(env, target),
        role: await roleOf(env, target),
        mute: await activeMute(env, target),
        // Deliberately not the Discord id, HWID or recovery hashes: moderation does not need them.
        createdAt: account.createdAt,
        deviceCount: (account.deviceKeys || []).length,
    });
}

async function handleModLog(env, cbId) {
    const gate = await requireRole(env, cbId, 'mod');
    if (gate.error) return gate.error;

    const page = await env.CB.list({ prefix: 'modlog:' });
    const names = page.keys.map(k => k.name).sort().reverse().slice(0, MOD_LOG_KEEP);
    const entries = [];
    for (const name of names) {
        const raw = await env.CB.get(name);
        if (raw) { try { entries.push(JSON.parse(raw)); } catch { /* skip */ } }
    }
    const ids = [...new Set(entries.flatMap(e => [e.by, e.target]).filter(Boolean))];
    const people = Object.fromEntries((await peopleViews(env, ids)).map(p => [p.cbId, p]));
    return json(200, { entries: entries.map(e => ({ ...e, byProfile: people[e.by], targetProfile: people[e.target] })) });
}

// Only an admin moves the moderator list, and only between '' and 'mod'.
async function handleModSetRole(env, cbId, body) {
    const gate = await requireRole(env, cbId, 'admin');
    if (gate.error) return gate.error;

    const target = String(body.cbId || '');
    if (!target || target === cbId) return json(400, { error: 'bad target' });
    if (!(await getAccount(env, target))) return json(404, { error: 'no such account' });
    if ((await roleOf(env, target)) === 'admin') return json(403, { error: 'cannot change an admin' });

    if (body.role === 'mod') {
        await env.CB.put(`role:${target}`, 'mod');
    } else {
        await env.CB.delete(`role:${target}`);
    }
    await modLog(env, cbId, 'set-role', target, body.role === 'mod' ? 'mod' : 'none');
    return json(200, { ok: true });
}

// Friends, presence and LFG. Edges live in a SocialGraph object per account; presence and LFG posts
// live in the single Directory object. KV holds only the cold account records.

// Posts one request at an account's own graph object.
function graphCall(env, cbId, path, payload) {
    const stub = env.GRAPH.get(env.GRAPH.idFromName(cbId));
    return stub.fetch(new Request(`https://graph/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    })).then(r => r.json());
}

// Reads an account's edges, migrating them off the old KV arrays the first time it is asked.
async function graphGet(env, cbId) {
    const res = await graphCall(env, cbId, 'get', {});
    if (res.seeded) return res;
    return graphCall(env, cbId, 'seed', {
        friends: await readArray(env, `fr:${cbId}`),
        incoming: await readArray(env, `rin:${cbId}`),
        outgoing: await readArray(env, `rout:${cbId}`),
        blocked: await readArray(env, `blk:${cbId}`),
    });
}

// Applies a batch of edge changes atomically, seeding first if this account has never been read.
async function graphApply(env, cbId, ops) {
    const res = await graphCall(env, cbId, 'apply', { ops });
    if (res.seeded) return res;
    await graphGet(env, cbId);
    return graphCall(env, cbId, 'apply', { ops });
}

// Posts one request at the single directory object holding presence and the LFG board.
function dirCall(env, path, payload) {
    const stub = env.DIRECTORY.get(env.DIRECTORY.idFromName('main'));
    return stub.fetch(new Request(`https://dir/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    })).then(r => r.json());
}

const PRESENCE_FRESH_MS = 90_000;
const LFG_FRESH_MS = 15 * 60_000;
const PLAYED_WITH_MS = 6 * 3600_000;  // how long a match roster is worth suggesting from
const PLAYED_WITH_MATCHES = 5;        // recent matches kept per person
const CHAT_MAX_LENGTH = 300;
const CHAT_HISTORY = 200;
const CHAT_PER_MINUTE = 12;
const CHAT_HOLD_MS = 25_000;   // shorter than the client's read timeout

// Zero-padded so storage keys sort in message order.
function msgKey(id) {
    return 'msg:' + String(id).padStart(12, '0');
}

async function readArray(env, key) {
    const raw = await env.CB.get(key);
    if (!raw) return [];
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

// Resolves the signing device key to its account id, or null.
async function requireAccount(env, fpr) {
    return (await env.CB.get(`dev:${fpr}`)) || null;
}

async function presenceFor(env, cbId) {
    const known = await dirCall(env, 'people', { ids: [cbId] });
    return livePresence((known[cbId] || {}).pres);
}

// Join flags and the game only mean anything while the beat behind them is still fresh.
function livePresence(pres) {
    if (!pres) return { online: false };
    const online = (Date.now() - (pres.at || 0)) < PRESENCE_FRESH_MS;
    return {
        online,
        lastSeen: pres.at || 0,
        status: pres.status || '',
        game: pres.game || '',
        mode: pres.mode || '',
        joinable: online && !!pres.joinable,
        directJoin: online && !!pres.directJoin,
        openable: online && !!pres.openable,
        matchId: pres.matchId || '',
    };
}

// Public shape of a friend, request, or LFG poster: profile plus live presence.
function personFrom(cbId, profile, createdAt, pres) {
    const live = livePresence(pres);
    return {
        cbId,
        handle: profile.handle || '',
        displayName: profile.displayName || '',
        avatarUrl: profile.avatarUrl || '',
        bio: profile.bio || '',
        accent: profile.accent || '',
        avatarCustom: !!profile.avatarCustom,
        favoriteGame: profile.favoriteGame || '',
        createdAt: createdAt || 0,
        online: live.online,
        game: live.game,
        mode: live.mode,
        status: live.status,
        joinable: live.joinable,
        directJoin: live.directJoin,
        openable: live.openable,
        matchId: live.matchId,
    };
}

// Resolves a batch through the directory in one call, reading KV only for accounts it has not seen.
async function peopleViews(env, ids) {
    if (!ids.length) return [];
    const known = await dirCall(env, 'people', { ids });
    return Promise.all(ids.map(async id => {
        const hit = known[id];
        if (hit) return personFrom(id, hit.profile || {}, hit.createdAt, hit.pres);
        const account = await getAccount(env, id);
        return personFrom(id, (account && account.profile) || {}, account && account.createdAt, null);
    }));
}

async function personView(env, cbId) {
    return (await peopleViews(env, [cbId]))[0];
}

// Each side is one atomic batch on its own graph, so a concurrent edit cannot drop half of it.
async function acceptPair(env, meId, otherId) {
    await Promise.all([
        graphApply(env, meId, [
            { op: 'remove', list: 'incoming', cbId: otherId },
            { op: 'remove', list: 'outgoing', cbId: otherId },
            { op: 'add', list: 'friends', cbId: otherId },
        ]),
        graphApply(env, otherId, [
            { op: 'remove', list: 'outgoing', cbId: meId },
            { op: 'remove', list: 'incoming', cbId: meId },
            { op: 'add', list: 'friends', cbId: meId },
        ]),
    ]);
}

// Returns 'friends' when it completes a mutual add, otherwise 'requested'.
async function sendFriendRequest(env, cbId, targetId) {
    const me = await graphGet(env, cbId);
    if (me.friends.includes(targetId)) {
        return 'friends';
    }
    // They already asked us, so accept immediately.
    if (me.incoming.includes(targetId)) {
        await acceptPair(env, cbId, targetId);
        return 'friends';
    }
    await Promise.all([
        graphApply(env, cbId, [{ op: 'add', list: 'outgoing', cbId: targetId }]),
        graphApply(env, targetId, [{ op: 'add', list: 'incoming', cbId }]),
    ]);
    return 'requested';
}

async function handleFriendAdd(env, cbId, body) {
    const handle = String(body.handle || '').trim();
    if (!HANDLE_RE.test(handle)) return json(400, { error: 'invalid handle' });

    const targetId = await env.CB.get(`handle:${handle.toLowerCase()}`);
    if (!targetId) return json(404, { error: 'no such handle' });
    if (targetId === cbId) return json(400, { error: 'cannot add yourself' });
    // Same 404 as a missing handle, so blocking is not observable.
    if (await eitherBlocked(env, cbId, targetId)) return json(404, { error: 'no such handle' });

    return json(200, { status: await sendFriendRequest(env, cbId, targetId) });
}

async function handleFriendAccept(env, cbId, body) {
    const other = String(body.cbId || '');
    if (!(await graphGet(env, cbId)).incoming.includes(other)) {
        return json(404, { error: 'no such request' });
    }
    await acceptPair(env, cbId, other);
    return json(200, { status: 'friends' });
}

// decline drops their request to us, cancel drops ours to them, remove drops an accepted friendship.
async function handleFriendDrop(env, cbId, body, kind) {
    const other = String(body.cbId || '');
    const mine = kind === 'decline' ? 'incoming' : (kind === 'cancel' ? 'outgoing' : 'friends');
    const theirs = kind === 'decline' ? 'outgoing' : (kind === 'cancel' ? 'incoming' : 'friends');
    await Promise.all([
        graphApply(env, cbId, [{ op: 'remove', list: mine, cbId: other }]),
        graphApply(env, other, [{ op: 'remove', list: theirs, cbId }]),
    ]);
    return json(200, { status: 'ok' });
}

async function handleFriendList(env, cbId) {
    const edges = await graphGet(env, cbId);
    const [f, i, o] = await Promise.all([
        peopleViews(env, edges.friends),
        peopleViews(env, edges.incoming),
        peopleViews(env, edges.outgoing),
    ]);
    return json(200, { friends: f, incoming: i, outgoing: o });
}

// The beat carries the profile too, so the directory can serve friend lists without touching KV.
async function handlePresence(env, cbId, body) {
    const account = await getAccount(env, cbId);
    await dirCall(env, 'beat', {
        cbId,
        profile: (account && account.profile) || {},
        createdAt: (account && account.createdAt) || 0,
        pres: {
            status: typeof body.status === 'string' ? body.status.slice(0, 64) : '',
            game: typeof body.game === 'string' ? body.game.slice(0, 32) : '',
            mode: typeof body.mode === 'string' ? body.mode.slice(0, 16) : '',
            // Flags only; the secret is exchanged over the invite mailbox.
            joinable: !!body.joinable,
            directJoin: !!body.directJoin,
            openable: !!body.openable,
            matchId: typeof body.matchId === 'string' ? body.matchId.slice(0, 128) : '',
        },
    });
    return json(200, { ok: true });
}

// Game invite mailbox: friends-only, and the only place the join secret travels.

async function readMailbox(env, cbId) {
    const raw = await env.CB.get(`inv:${cbId}`);
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : [];
    } catch {
        return [];
    }
}

// Delivers an invite, join-request or approval into a friend's mailbox.
async function handleInviteSend(env, cbId, body) {
    const to = String(body.to || '');
    if (!to || to === cbId) return json(400, { error: 'bad target' });
    if (!(await graphGet(env, cbId)).friends.includes(to)) return json(403, { error: 'not friends' });
    if (await eitherBlocked(env, cbId, to)) return json(403, { error: 'not friends' });

    const message = {
        id: 'inv_' + crypto.randomUUID().replace(/-/g, ''),
        sender: cbId,
        kind: body.kind === 'join-request' ? 'join-request' : 'invite',
        game: typeof body.game === 'string' ? body.game.slice(0, 32) : '',
        matchId: typeof body.matchId === 'string' ? body.matchId.slice(0, 128) : '',
        joinSecret: typeof body.joinSecret === 'string' ? body.joinSecret.slice(0, 4096) : '',
        isApproval: !!body.isApproval,
        accept: body.accept !== false,
        replyTo: typeof body.replyTo === 'string' ? body.replyTo.slice(0, 64) : '',
        at: Date.now(),
    };

    const box = await readMailbox(env, to);
    box.push(message);
    await env.CB.put(`inv:${to}`, JSON.stringify(box.slice(-20)));
    return json(200, { ok: true, id: message.id });
}

// Refreshes the avatar from the linked Discord account, and links it if this account had none.
// Keeps the CB avatar current when the user changes it on Discord.
async function handleDiscordSync(env, cbId, body) {
    const account = await getAccount(env, cbId);
    if (!account) return json(404, { error: 'account not found' });

    const discordUser = await resolveDiscordUser(body.discordToken);
    if (!discordUser) return json(401, { error: 'invalid discord token' });

    const owner = await env.CB.get(`discord:${discordUser.id}`);
    if (owner && owner !== cbId) return json(409, { error: 'discord account linked elsewhere' });

    account.discordId = discordUser.id;
    if (!account.profile.avatarCustom) {
        account.profile.avatarUrl = discordUser.avatarUrl;
    }
    if (!account.profile.displayName) {
        account.profile.displayName = discordUser.displayName.slice(0, 64);
    }

    await putAccount(env, account);
    await env.CB.put(`discord:${discordUser.id}`, cbId);
    return json(200, publicView(account));
}

// Public profile card for anyone, so a name in chat or on the board can be inspected. Returns only
// public fields, never the Discord id, HWID or recovery data.
async function handleProfileGet(env, cbId, body) {
    const target = String(body.cbId || '');
    if (!target) return json(400, { error: 'cbId required' });
    if (!(await getAccount(env, target))) return json(404, { error: 'no such profile' });

    const [person, edges] = await Promise.all([personView(env, target), graphGet(env, cbId)]);

    let relation = 'none';
    if (target === cbId) relation = 'self';
    else if (edges.friends.includes(target)) relation = 'friend';
    else if (edges.outgoing.includes(target)) relation = 'requested';
    else if (edges.incoming.includes(target)) relation = 'incoming';

    return json(200, { ...person, relation });
}

// Chat rooms are "all" or a game id, so a room name maps straight to a Durable Object.
function chatRoomName(room) {
    const value = String(room || '').trim().toLowerCase();
    if (value === 'all') return 'all';
    // A DM room id is derived from two cbIds, which are public, so the open chat endpoints must not
    // be able to name one. DMs go through /v1/dm/*, which checks the friendship first.
    if (value.startsWith(DM_PREFIX)) return '';
    return /^[a-z0-9-]{2,32}$/.test(value) ? value : '';
}

function toChatRoom(env, room, path, payload) {
    const stub = env.CHAT.get(env.CHAT.idFromName(room));
    return stub.fetch(new Request(`https://chat/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    }));
}

// Direct messages. A conversation is an ordinary ChatRoom with an authorisation gate in front of
// it, so history, retention and the held poll all come for free. The room id is derived from the
// pair so both sides compute the same one without storing a mapping.

async function dmRoom(a, b) {
    const pair = [a, b].sort().join('|');
    return DM_PREFIX + (await sha256Hex(new TextEncoder().encode(pair))).slice(0, 28);
}

// Both sides must still be friends and unblocked; that is the whole access check for a conversation.
async function dmPeer(env, cbId, other) {
    if (!other || other === cbId) return null;
    const me = await graphGet(env, cbId);
    if (!me.friends.includes(other)) return null;
    if (await eitherBlocked(env, cbId, other)) return null;
    return other;
}

async function handleDmSend(env, cbId, body) {
    const peer = await dmPeer(env, cbId, String(body.to || ''));
    if (!peer) return json(403, { error: 'not friends' });

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, CHAT_MAX_LENGTH) : '';
    if (!text) return json(400, { error: 'empty message' });

    const mute = await activeMute(env, cbId);
    if (mute) return json(403, { error: 'you are muted', until: mute.until, reason: mute.reason });

    const account = await getAccount(env, cbId);
    const profile = (account && account.profile) || {};
    const room = await dmRoom(cbId, peer);
    const res = await toChatRoom(env, room, 'send', {
        cbId,
        handle: profile.handle || '',
        displayName: profile.displayName || profile.handle || '',
        accent: profile.accent || '',
        text,
    });
    const sent = await res.json();
    if (!sent.ok) return json(res.status, sent);

    // Each side keeps its own inbox row, so listing conversations never walks the rooms.
    const at = Date.now();
    await Promise.all([
        graphApply(env, cbId, [{ op: 'dm', peer, lastId: sent.id, lastAt: at, preview: text, unread: false }]),
        graphApply(env, peer, [{ op: 'dm', peer: cbId, lastId: sent.id, lastAt: at, preview: text, unread: true }]),
    ]);
    return json(200, { ok: true, id: sent.id });
}

async function handleDmPoll(env, cbId, body) {
    const peer = await dmPeer(env, cbId, String(body.with || ''));
    if (!peer) return json(403, { error: 'not friends' });

    const room = await dmRoom(cbId, peer);
    const res = await toChatRoom(env, room, 'poll', {
        after: body.after, before: body.before, hold: body.hold === true,
    });
    const data = await res.json();

    // Reaching the live tail is what marks a conversation read.
    if (!body.before) {
        await graphApply(env, cbId, [{ op: 'dm-read', peer }]);
    }
    return json(200, data);
}

// The conversation list, newest first, with unread counts for the badge.
async function handleDmList(env, cbId) {
    const edges = await graphGet(env, cbId);
    const inbox = edges.dm || {};
    const ids = Object.keys(inbox);
    const people = Object.fromEntries((await peopleViews(env, ids)).map(p => [p.cbId, p]));
    const conversations = ids
        .map(id => ({ ...people[id], ...inbox[id], cbId: id }))
        .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return json(200, {
        conversations,
        unread: conversations.reduce((n, c) => n + (c.unread || 0), 0),
    });
}

async function handleChatSend(env, cbId, body) {
    const room = chatRoomName(body.room);
    if (!room) return json(400, { error: 'bad room' });

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, CHAT_MAX_LENGTH) : '';
    if (!text) return json(400, { error: 'empty message' });

    const mute = await activeMute(env, cbId);
    if (mute) return json(403, { error: 'you are muted', until: mute.until, reason: mute.reason });

    const account = await getAccount(env, cbId);
    const profile = (account && account.profile) || {};
    return toChatRoom(env, room, 'send', {
        cbId,
        handle: profile.handle || '',
        displayName: profile.displayName || profile.handle || '',
        accent: profile.accent || '',
        text,
    });
}

async function handleChatPoll(env, cbId, body) {
    const room = chatRoomName(body.room);
    if (!room) return json(400, { error: 'bad room' });

    const res = await toChatRoom(env, room, 'poll', {
        after: body.after, before: body.before, hold: body.hold === true,
    });
    const blocks = (await graphGet(env, cbId)).blocked;
    if (!blocks.length) return res;

    // Blocked authors are filtered here rather than in the room, which has no idea who is reading.
    // `cursor` still counts them, so a room of nothing but blocked chatter cannot spin the client.
    const data = await res.json();
    const messages = data.messages || [];
    const cursor = messages.reduce((max, m) => (m.id > max ? m.id : max), 0);
    return json(200, {
        ...data,
        messages: messages.filter(m => !blocks.includes(m.cbId)),
        cursor,
    });
}

// Deliver-once: returns pending messages and clears the mailbox.
async function handleInvitePoll(env, cbId) {
    const box = await readMailbox(env, cbId);
    if (box.length) await env.CB.delete(`inv:${cbId}`);
    const fresh = box.filter(m => Date.now() - (m.at || 0) < 120000);
    return json(200, { messages: fresh });
}

// A post carries a profile snapshot so the board can be listed without a KV read per poster.
async function handleLfgPost(env, cbId, body) {
    const game = typeof body.game === 'string' ? body.game.slice(0, 32) : '';
    if (!game) return json(400, { error: 'game required' });

    const account = await getAccount(env, cbId);
    await dirCall(env, 'lfg/set', {
        cbId,
        profile: (account && account.profile) || {},
        createdAt: (account && account.createdAt) || 0,
        post: {
            game,
            mode: typeof body.mode === 'string' ? body.mode.slice(0, 16) : '',
            note: typeof body.note === 'string' ? body.note.slice(0, 200) : '',
            slots: Number.isFinite(body.slots) ? Math.max(0, Math.min(16, Math.trunc(body.slots))) : 0,
        },
    });
    return json(200, { ok: true });
}

async function handleLfgClear(env, cbId) {
    await dirCall(env, 'lfg/clear', { cbId });
    return json(200, { ok: true });
}

// Bumps a broadcast's freshness without disturbing its roster, keeping it live.
async function handleLfgRefresh(env, cbId) {
    const res = await dirCall(env, 'lfg/refresh', { cbId });
    return res.ok ? json(200, { ok: true }) : json(404, { error: 'no broadcast' });
}

// Adds you to a poster's roster and sends a friend request so you can connect. Idempotent.
async function handleLfgJoin(env, cbId, body) {
    const poster = String(body.cbId || '');
    if (!poster || poster === cbId) return json(400, { error: 'bad target' });

    const res = await dirCall(env, 'lfg/join', { cbId, poster });
    if (!res.ok) return json(404, { error: 'post not found' });

    await sendFriendRequest(env, cbId, poster);
    return json(200, { ok: true });
}

// People seen in the same match recently, minus anyone already connected to or blocked. Derived on
// read from the directory's match rosters, so nothing is written per player per match.
async function handlePlayedWith(env, cbId) {
    const [found, edges] = await Promise.all([
        dirCall(env, 'played-with', { cbId }),
        graphGet(env, cbId),
    ]);
    const known = new Set([...edges.friends, ...edges.incoming, ...edges.outgoing, ...edges.blocked, cbId]);
    const rows = (found.people || []).filter(p => !known.has(p.cbId));
    const people = Object.fromEntries((await peopleViews(env, rows.map(p => p.cbId))).map(p => [p.cbId, p]));
    return json(200, {
        people: rows
            .map(r => ({ ...people[r.cbId], game: r.game || '', at: r.at }))
            .sort((a, b) => b.at - a.at),
    });
}

async function handleLfgList(env, cbId, body) {
    const [board, edges] = await Promise.all([
        dirCall(env, 'lfg/list', { game: typeof body.game === 'string' ? body.game : '' }),
        graphGet(env, cbId),
    ]);
    const friends = new Set(edges.friends);
    const outgoing = new Set(edges.outgoing);
    const blocked = new Set(edges.blocked);

    const posts = (board.posts || []).filter(p => !blocked.has(p.cbId)).map(p => ({
        ...personFrom(p.cbId, p.profile || {}, p.createdAt, p.pres),
        game: p.game,
        mode: p.mode || '',
        note: p.note || '',
        slots: p.slots || 0,
        joined: p.joined || 0,
        iJoined: (p.joiners || []).includes(cbId),
        // Your own broadcast is listed too, so you can see the lobby you're advertising.
        relation: p.cbId === cbId ? 'self'
            : (friends.has(p.cbId) ? 'friend' : (outgoing.has(p.cbId) ? 'requested' : 'none')),
    }));
    return json(200, { posts });
}

// ---- Discord invite relay ----
//
// Speaks the protocol relay_client.cpp already implements, so retiring the standalone relay is just
// a URL change. Identity here is Discord only, keyed by Discord id, so it keeps working for people
// who never opt into a CB profile.

const RELAY_PATHS = new Set(['/v1/session/start', '/v1/poll', '/v1/invite', '/v1/invite/reply']);
const RELAY_SESSION_TTL = 3600;
const RELAY_RATE_PER_MINUTE = 30;

function relayMailbox(env, discordId, path, payload) {
    const stub = env.MAILBOX.get(env.MAILBOX.idFromName(discordId));
    return stub.fetch(new Request(`https://mailbox/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    }));
}

async function relayFetch(request, env, pathname) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json(401, { error: 'unauthorized' });

    // Exchange a Discord bearer for a relay token.
    if (pathname === '/v1/session/start') {
        const user = await resolveDiscordUser(token);
        if (!user) return json(401, { error: 'unauthorized' });

        const relayToken = 'rl_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
        await env.CB.put(`sess:${await sha256Hex(new TextEncoder().encode(relayToken))}`, user.id,
                         { expirationTtl: RELAY_SESSION_TTL });
        const enabled = (await env.CB.get('relayEnabled')) !== 'false';
        return json(200, { relayToken, relayEnabled: enabled });
    }

    const me = await env.CB.get(`sess:${await sha256Hex(new TextEncoder().encode(token))}`);
    if (!me) return json(401, { error: 'unauthorized' });

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    if (pathname === '/v1/poll') {
        return relayMailbox(env, me, 'poll', { ack: body.ack, session: body.session });
    }

    const to = String(body.to || '');
    if (!SNOWFLAKE_RE.test(to) || to === me) return json(200, { reason: 'failed' });

    const gate = await relayMailbox(env, me, 'rate', { limit: RELAY_RATE_PER_MINUTE });
    if (!(await gate.json()).allowed) return json(429, { reason: 'throttled' });

    const isReply = pathname === '/v1/invite/reply';
    return relayMailbox(env, to, 'deliver', {
        message: {
            id: 'rmsg_' + crypto.randomUUID().replace(/-/g, ''),
            from: me,
            kind: isReply ? 'invite' : (body.kind === 'join-request' ? 'join-request' : 'invite'),
            game: String(body.game || ''),
            matchId: String(body.matchId || ''),
            joinSecret: (!isReply || body.accept !== false) ? String(body.joinSecret || '') : '',
            isApproval: isReply,
            accept: body.accept !== false,
        },
    });
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return json(405, { error: 'method not allowed' });
        }

        const { pathname } = new URL(request.url);

        // Discord invite relay. Authed by Discord token / relay token rather than a device key, so it
        // is dispatched before the CB auth below and works for users with no CB profile.
        if (RELAY_PATHS.has(pathname)) {
            return relayFetch(request, env, pathname);
        }

        const auth = await authenticate(request);
        if (auth.error) return auth.error;
        const { fpr, body } = auth;

        if (!withinRate(`req:${fpr}`, RATE_PER_MINUTE)) {
            return json(429, { error: 'rate limited' });
        }

        switch (pathname) {
            case '/v1/account/bootstrap':
                return handleBootstrap(env, fpr, body);
            case '/v1/account':
                return handleWhoami(env, fpr);
            case '/v1/recover/hwid':
                if (!HWID_RE.test(String(body.hwidHash || ''))) {
                    return json(400, { error: 'hwidHash must be a sha256 hex string' });
                }
                return handleRecover(env, fpr, body, `hwid:${body.hwidHash}`, 'hwid');
            case '/v1/recover/discord': {
                const discordId = await resolveDiscordId(body.discordToken);
                if (!discordId) return json(401, { error: 'invalid discord token' });
                return handleRecover(env, fpr, body, `discord:${discordId}`, 'discord');
            }
            case '/v1/recover/code': {
                if (typeof body.recoveryCode !== 'string' || !body.recoveryCode) {
                    return json(400, { error: 'recoveryCode required' });
                }
                const hash = await sha256Hex(new TextEncoder().encode(body.recoveryCode));
                return handleRecover(env, fpr, body, `rec:${hash}`, 'code');
            }
        }

        // Everything past here requires an established account.
        const cbId = await requireAccount(env, fpr);
        if (!cbId) {
            return json(401, { error: 'no account for this device key' });
        }

        switch (pathname) {
            case '/v1/account/profile':
                return handleProfileUpdate(env, cbId, body);
            case '/v1/profile/get':
                return handleProfileGet(env, cbId, body);
            case '/v1/security/events':
                return handleSecurityEvents(env, cbId);
            case '/v1/block/add':
                return handleBlockAdd(env, cbId, body);
            case '/v1/block/remove':
                return handleBlockRemove(env, cbId, body);
            case '/v1/block/list':
                return handleBlockList(env, cbId);
            case '/v1/report':
                return handleReport(env, cbId, body);
            case '/v1/mod/status':
                return handleModStatus(env, cbId);
            case '/v1/mod/reports':
                return handleModReports(env, cbId, body);
            case '/v1/mod/resolve':
                return handleModResolve(env, cbId, body);
            case '/v1/mod/mute':
                return handleModMute(env, cbId, body);
            case '/v1/mod/lookup':
                return handleModLookup(env, cbId, body);
            case '/v1/mod/log':
                return handleModLog(env, cbId);
            case '/v1/mod/set-role':
                return handleModSetRole(env, cbId, body);
            case '/v1/account/sync-discord':
                return handleDiscordSync(env, cbId, body);
            case '/v1/friends/add':
                return handleFriendAdd(env, cbId, body);
            case '/v1/friends/accept':
                return handleFriendAccept(env, cbId, body);
            case '/v1/friends/decline':
                return handleFriendDrop(env, cbId, body, 'decline');
            case '/v1/friends/cancel':
                return handleFriendDrop(env, cbId, body, 'cancel');
            case '/v1/friends/remove':
                return handleFriendDrop(env, cbId, body, 'remove');
            case '/v1/friends/list':
                return handleFriendList(env, cbId);
            case '/v1/presence':
                return handlePresence(env, cbId, body);
            case '/v1/lfg/post':
                return handleLfgPost(env, cbId, body);
            case '/v1/lfg/clear':
                return handleLfgClear(env, cbId);
            case '/v1/lfg/join':
                return handleLfgJoin(env, cbId, body);
            case '/v1/lfg/refresh':
                return handleLfgRefresh(env, cbId);
            case '/v1/invite/send':
                return handleInviteSend(env, cbId, body);
            case '/v1/invite/poll':
                return handleInvitePoll(env, cbId);
            case '/v1/dm/send':
                return handleDmSend(env, cbId, body);
            case '/v1/dm/poll':
                return handleDmPoll(env, cbId, body);
            case '/v1/dm/list':
                return handleDmList(env, cbId);
            case '/v1/chat/send':
                return handleChatSend(env, cbId, body);
            case '/v1/chat/poll':
                return handleChatPoll(env, cbId, body);
            case '/v1/lfg/list':
                return handleLfgList(env, cbId, body);
            case '/v1/played-with':
                return handlePlayedWith(env, cbId);
            default:
                return json(404, { error: 'not found' });
        }
    },
};

// One instance per chat room, holding recent history in memory.
export class ChatRoom {
    constructor(state) {
        this.state = state;
        this.messages = [];
        this.seq = 0;
        this.rate = new Map();
        this.ready = null;
        this.waiters = [];

        // History lives in Durable Object storage so it survives evictions and redeploys; the array
        // above is just a mirror of the tail. Requests are blocked until it is loaded.
        if (state && state.blockConcurrencyWhile) {
            state.blockConcurrencyWhile(async () => { await this.load(); });
        }
    }

    async load() {
        const stored = await this.state.storage.list({ prefix: 'msg:', limit: CHAT_HISTORY, reverse: true });
        this.messages = [...stored.values()].reverse();
        this.seq = (await this.state.storage.get('seq')) || 0;
    }

    // Loading is normally done in the constructor; this covers runtimes without it.
    async ensureLoaded() {
        if (this.state && this.state.blockConcurrencyWhile) return;
        if (!this.ready) this.ready = this.load();
        await this.ready;
    }

    wake() {
        const waiters = this.waiters.splice(0);
        for (const resolve of waiters) resolve();
    }

    // Per-sender cap so one account can't flood the room.
    allowed(cbId) {
        const bucket = Math.floor(Date.now() / 60000);
        for (const key of this.rate.keys()) {
            if (!key.endsWith(`:${bucket}`)) this.rate.delete(key);
        }
        const key = `${cbId}:${bucket}`;
        const count = (this.rate.get(key) || 0) + 1;
        this.rate.set(key, count);
        return count <= CHAT_PER_MINUTE;
    }

    async fetch(request) {
        await this.ensureLoaded();
        const { pathname } = new URL(request.url);
        const body = await request.json().catch(() => ({}));

        if (pathname === '/send') {
            if (!this.allowed(body.cbId)) return json(429, { error: 'slow down' });
            const message = {
                id: ++this.seq,
                cbId: body.cbId,
                handle: body.handle || '',
                displayName: body.displayName || body.handle || '',
                accent: body.accent || '',
                text: body.text,
                at: Date.now(),
            };

            this.messages.push(message);
            await this.state.storage.put({ [msgKey(message.id)]: message, seq: this.seq });

            // Trim the tail to the retention window, dropping the same keys from storage.
            if (this.messages.length > CHAT_HISTORY) {
                const dropped = this.messages.splice(0, this.messages.length - CHAT_HISTORY);
                await this.state.storage.delete(dropped.map(m => msgKey(m.id)));
            }
            this.wake();
            return json(200, { ok: true, id: message.id });
        }

        if (pathname === '/poll') {
            // `before` walks backwards through storage for scrollback; `after` is the live tail.
            if (body.before) {
                const before = Number(body.before);
                const older = await this.state.storage.list({
                    prefix: 'msg:', end: msgKey(before), limit: CHAT_PAGE, reverse: true,
                });
                return json(200, { messages: [...older.values()].reverse(), history: true });
            }

            const after = Number(body.after) || 0;
            const since = () => this.messages.filter(m => m.id > after);
            if (body.hold && !since().length) {
                // Held open so a message arrives the moment it is sent, rather than on the next tick.
                await new Promise(resolve => {
                    let done = false;
                    const finish = () => {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        this.waiters = this.waiters.filter(w => w !== finish);
                        resolve();
                    };
                    const timer = setTimeout(finish, CHAT_HOLD_MS);
                    this.waiters.push(finish);
                });
            }
            return json(200, { messages: since(), seq: this.seq });
        }

        return json(404, { error: 'not found' });
    }
}

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
            return json(200, { allowed: count <= (body.limit || RELAY_RATE_PER_MINUTE) });
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

// One per account: its friend edges and block list. A Durable Object serialises its own requests,
// so a batch here cannot lose half an update the way a KV read-modify-write can.
export class SocialGraph {
    constructor(state) {
        this.state = state;
        this.edges = null;
        if (state && state.blockConcurrencyWhile) {
            state.blockConcurrencyWhile(async () => { await this.load(); });
        }
    }

    async load() {
        this.edges = (await this.state.storage.get('edges')) || null;
    }

    // Loading is normally done in the constructor; this covers runtimes without it.
    async ensureLoaded() {
        if (this.state && this.state.blockConcurrencyWhile) return;
        if (!this.ready) this.ready = this.load();
        await this.ready;
    }

    view() {
        return { seeded: true, ...this.edges };
    }

    async fetch(request) {
        await this.ensureLoaded();
        const { pathname } = new URL(request.url);
        const body = await request.json().catch(() => ({}));

        // An unseeded graph reports it so the worker can migrate this account's KV arrays across.
        if (!this.edges) {
            if (pathname !== '/seed') return json(200, { seeded: false });
            this.edges = {
                friends: [...new Set(body.friends || [])],
                incoming: [...new Set(body.incoming || [])],
                outgoing: [...new Set(body.outgoing || [])],
                blocked: [...new Set(body.blocked || [])],
                dm: {},
            };
            await this.state.storage.put('edges', this.edges);
            return json(200, this.view());
        }

        if (pathname === '/apply') {
            let dirty = false;
            for (const op of (body.ops || [])) {
                if (op.op === 'dm' || op.op === 'dm-read') {
                    if (!op.peer) continue;
                    if (!this.edges.dm) this.edges.dm = {};
                    const row = this.edges.dm[op.peer] || { unread: 0 };
                    if (op.op === 'dm-read') {
                        if (!row.unread) continue;
                        row.unread = 0;
                    } else {
                        row.lastId = op.lastId;
                        row.lastAt = op.lastAt;
                        row.preview = String(op.preview || '').slice(0, 120);
                        row.unread = op.unread ? (row.unread || 0) + 1 : 0;
                    }
                    this.edges.dm[op.peer] = row;
                    dirty = true;
                    continue;
                }

                const current = this.edges[op.list];
                if (!current || !op.cbId) continue;
                if (op.op === 'add' && !current.includes(op.cbId)) { current.push(op.cbId); dirty = true; }
                if (op.op === 'remove' && current.includes(op.cbId)) {
                    this.edges[op.list] = current.filter(x => x !== op.cbId);
                    dirty = true;
                }
            }
            if (dirty) await this.state.storage.put('edges', this.edges);
        }

        return json(200, this.view());
    }
}

// One instance for the whole population: live presence, the LFG board, and a profile snapshot for
// each. Held in memory only - every field is short-lived and the next beat repopulates it, the same
// bargain Mailbox makes.
export class Directory {
    constructor() {
        this.people = new Map();
        this.matches = new Map(); // matchId -> Map(cbId -> { at, game })
    }

    entry(cbId) {
        let it = this.people.get(cbId);
        if (!it) {
            it = { profile: {}, createdAt: 0, pres: null, post: null };
            this.people.set(cbId, it);
        }
        return it;
    }

    // Drops anyone whose presence and broadcast have both gone stale, so the map cannot grow forever.
    prune() {
        const now = Date.now();
        for (const [cbId, it] of this.people) {
            const livePres = it.pres && now - it.pres.at < PRESENCE_FRESH_MS;
            const livePost = it.post && now - it.post.at < LFG_FRESH_MS;
            const recent = (it.matches || []).some(m => now - m.at < PLAYED_WITH_MS);
            if (!livePres && !livePost && !recent) this.people.delete(cbId);
        }
        for (const [matchId, roster] of this.matches) {
            for (const [cbId, seen] of roster) {
                if (now - seen.at > PLAYED_WITH_MS) roster.delete(cbId);
            }
            if (!roster.size) this.matches.delete(matchId);
        }
    }

    // Remembers the match a beat named, on both the person and the match roster.
    noteMatch(cbId, entry, matchId, game, now) {
        if (!matchId) return;
        entry.matches = (entry.matches || []).filter(m => m.id !== matchId);
        entry.matches.push({ id: matchId, at: now });
        if (entry.matches.length > PLAYED_WITH_MATCHES) entry.matches.shift();

        let roster = this.matches.get(matchId);
        if (!roster) { roster = new Map(); this.matches.set(matchId, roster); }
        roster.set(cbId, { at: now, game: game || '' });
    }

    async fetch(request) {
        const { pathname } = new URL(request.url);
        const body = await request.json().catch(() => ({}));
        const now = Date.now();

        if (pathname === '/beat') {
            const it = this.entry(body.cbId);
            it.profile = body.profile || it.profile;
            it.createdAt = body.createdAt || it.createdAt;
            it.pres = { ...(body.pres || {}), at: now };
            this.noteMatch(body.cbId, it, it.pres.matchId, it.pres.game, now);
            this.prune();
            return json(200, { ok: true });
        }

        if (pathname === '/played-with') {
            const it = this.people.get(body.cbId);
            const seen = new Map();
            for (const mine of ((it && it.matches) || [])) {
                if (now - mine.at > PLAYED_WITH_MS) continue;
                for (const [other, info] of (this.matches.get(mine.id) || new Map())) {
                    if (other === body.cbId) continue;
                    const prev = seen.get(other);
                    if (!prev || info.at > prev.at) seen.set(other, { cbId: other, at: info.at, game: info.game });
                }
            }
            return json(200, { people: [...seen.values()] });
        }

        if (pathname === '/people') {
            const out = {};
            for (const cbId of (body.ids || [])) {
                const it = this.people.get(cbId);
                if (it) out[cbId] = { profile: it.profile, createdAt: it.createdAt, pres: it.pres };
            }
            return json(200, out);
        }

        if (pathname === '/lfg/set') {
            const it = this.entry(body.cbId);
            it.profile = body.profile || it.profile;
            it.createdAt = body.createdAt || it.createdAt;
            it.post = { ...(body.post || {}), at: now, joiners: [] };
            return json(200, { ok: true });
        }

        if (pathname === '/lfg/clear') {
            const it = this.people.get(body.cbId);
            if (it) it.post = null;
            return json(200, { ok: true });
        }

        if (pathname === '/lfg/refresh') {
            const it = this.people.get(body.cbId);
            if (!it || !it.post) return json(200, { ok: false });
            it.post.at = now;
            return json(200, { ok: true });
        }

        if (pathname === '/lfg/join') {
            const it = this.people.get(body.poster);
            if (!it || !it.post || now - it.post.at > LFG_FRESH_MS) return json(200, { ok: false });
            if (!it.post.joiners.includes(body.cbId)) it.post.joiners.push(body.cbId);
            return json(200, { ok: true });
        }

        if (pathname === '/lfg/list') {
            this.prune();
            const posts = [];
            for (const [cbId, it] of this.people) {
                if (!it.post || now - it.post.at > LFG_FRESH_MS) continue;
                if (body.game && it.post.game !== body.game) continue;
                posts.push({
                    cbId,
                    profile: it.profile,
                    createdAt: it.createdAt,
                    pres: it.pres,
                    game: it.post.game,
                    mode: it.post.mode,
                    note: it.post.note,
                    slots: it.post.slots,
                    joined: it.post.joiners.length,
                    joiners: it.post.joiners,
                });
            }
            return json(200, { posts });
        }

        return json(404, { error: 'not found' });
    }
}
