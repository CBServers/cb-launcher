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
        const raw = sig[0] === 0x30 ? derToRaw(sig) : sig;
        ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, bodyBytes);
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
        } else if (AVATAR_URL_RE.test(url)) {
            account.profile.avatarUrl = url;
            account.profile.avatarCustom = true;
        } else {
            return json(400, { error: 'avatar must be an http(s) URL' });
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
async function handleRecover(env, fpr, body, anchorKey) {
    const cbId = await env.CB.get(anchorKey);
    if (!cbId) return json(404, { error: 'no account for this anchor' });
    const account = await getAccount(env, cbId);
    if (!account) return json(404, { error: 'account not found' });
    return json(200, await attachDeviceKey(env, account, fpr));
}

// Friends, presence and LFG. Edges are JSON arrays of cbIds: fr: accepted, rin: incoming requests,
// rout: outgoing. Presence and LFG posts are timestamped and judged fresh on read, not by KV TTL.

const PRESENCE_FRESH_MS = 90_000;
const LFG_FRESH_MS = 15 * 60_000;
const CHAT_MAX_LENGTH = 300;
const CHAT_HISTORY = 200;
const CHAT_PER_MINUTE = 12;

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

async function writeArray(env, key, arr) {
    await env.CB.put(key, JSON.stringify([...new Set(arr)]));
}

function without(arr, value) {
    return arr.filter(x => x !== value);
}

// Resolves the signing device key to its account id, or null.
async function requireAccount(env, fpr) {
    return (await env.CB.get(`dev:${fpr}`)) || null;
}

async function presenceFor(env, cbId) {
    const raw = await env.CB.get(`pres:${cbId}`);
    if (!raw) return { online: false };
    try {
        const p = JSON.parse(raw);
        const online = (Date.now() - (p.at || 0)) < PRESENCE_FRESH_MS;
        return {
            online,
            status: p.status || '',
            game: p.game || '',
            mode: p.mode || '',
            // Join flags only mean anything while online.
            joinable: online && !!p.joinable,
            directJoin: online && !!p.directJoin,
            openable: online && !!p.openable,
            matchId: p.matchId || '',
        };
    } catch {
        return { online: false };
    }
}

// Public shape of a friend, request, or LFG poster: profile plus live presence.
async function personView(env, cbId) {
    const account = await getAccount(env, cbId);
    const profile = (account && account.profile) || { handle: '', displayName: '', avatarUrl: '' };
    const pres = await presenceFor(env, cbId);
    return {
        cbId,
        handle: profile.handle || '',
        displayName: profile.displayName || '',
        avatarUrl: profile.avatarUrl || '',
        bio: profile.bio || '',
        accent: profile.accent || '',
        avatarCustom: !!profile.avatarCustom,
        favoriteGame: profile.favoriteGame || '',
        createdAt: (account && account.createdAt) || 0,
        online: !!pres.online,
        game: pres.game || '',
        mode: pres.mode || '',
        status: pres.status || '',
        joinable: !!pres.joinable,
        directJoin: !!pres.directJoin,
        openable: !!pres.openable,
        matchId: pres.matchId || '',
    };
}

async function acceptPair(env, meId, otherId) {
    await writeArray(env, `rin:${meId}`, without(await readArray(env, `rin:${meId}`), otherId));
    await writeArray(env, `rout:${otherId}`, without(await readArray(env, `rout:${otherId}`), meId));
    await writeArray(env, `rout:${meId}`, without(await readArray(env, `rout:${meId}`), otherId));
    await writeArray(env, `rin:${otherId}`, without(await readArray(env, `rin:${otherId}`), meId));
    await writeArray(env, `fr:${meId}`, [...await readArray(env, `fr:${meId}`), otherId]);
    await writeArray(env, `fr:${otherId}`, [...await readArray(env, `fr:${otherId}`), meId]);
}

// Returns 'friends' when it completes a mutual add, otherwise 'requested'.
async function sendFriendRequest(env, cbId, targetId) {
    if ((await readArray(env, `fr:${cbId}`)).includes(targetId)) {
        return 'friends';
    }
    // They already asked us, so accept immediately.
    if ((await readArray(env, `rin:${cbId}`)).includes(targetId)) {
        await acceptPair(env, cbId, targetId);
        return 'friends';
    }
    const myOutgoing = await readArray(env, `rout:${cbId}`);
    if (!myOutgoing.includes(targetId)) {
        await writeArray(env, `rout:${cbId}`, [...myOutgoing, targetId]);
        await writeArray(env, `rin:${targetId}`, [...await readArray(env, `rin:${targetId}`), cbId]);
    }
    return 'requested';
}

async function handleFriendAdd(env, cbId, body) {
    const handle = String(body.handle || '').trim();
    if (!HANDLE_RE.test(handle)) return json(400, { error: 'invalid handle' });

    const targetId = await env.CB.get(`handle:${handle.toLowerCase()}`);
    if (!targetId) return json(404, { error: 'no such handle' });
    if (targetId === cbId) return json(400, { error: 'cannot add yourself' });

    return json(200, { status: await sendFriendRequest(env, cbId, targetId) });
}

async function handleFriendAccept(env, cbId, body) {
    const other = String(body.cbId || '');
    if (!(await readArray(env, `rin:${cbId}`)).includes(other)) {
        return json(404, { error: 'no such request' });
    }
    await acceptPair(env, cbId, other);
    return json(200, { status: 'friends' });
}

async function handleFriendDrop(env, cbId, body, kind) {
    const other = String(body.cbId || '');
    if (kind === 'decline') {
        await writeArray(env, `rin:${cbId}`, without(await readArray(env, `rin:${cbId}`), other));
        await writeArray(env, `rout:${other}`, without(await readArray(env, `rout:${other}`), cbId));
    } else if (kind === 'cancel') {
        await writeArray(env, `rout:${cbId}`, without(await readArray(env, `rout:${cbId}`), other));
        await writeArray(env, `rin:${other}`, without(await readArray(env, `rin:${other}`), cbId));
    } else {
        await writeArray(env, `fr:${cbId}`, without(await readArray(env, `fr:${cbId}`), other));
        await writeArray(env, `fr:${other}`, without(await readArray(env, `fr:${other}`), cbId));
    }
    return json(200, { status: 'ok' });
}

async function handleFriendList(env, cbId) {
    const [friends, incoming, outgoing] = await Promise.all([
        readArray(env, `fr:${cbId}`),
        readArray(env, `rin:${cbId}`),
        readArray(env, `rout:${cbId}`),
    ]);
    const [f, i, o] = await Promise.all([
        Promise.all(friends.map(id => personView(env, id))),
        Promise.all(incoming.map(id => personView(env, id))),
        Promise.all(outgoing.map(id => personView(env, id))),
    ]);
    return json(200, { friends: f, incoming: i, outgoing: o });
}

async function handlePresence(env, cbId, body) {
    await env.CB.put(`pres:${cbId}`, JSON.stringify({
        at: Date.now(),
        status: typeof body.status === 'string' ? body.status.slice(0, 64) : '',
        game: typeof body.game === 'string' ? body.game.slice(0, 32) : '',
        mode: typeof body.mode === 'string' ? body.mode.slice(0, 16) : '',
        // Flags only; the secret is exchanged over the invite mailbox.
        joinable: !!body.joinable,
        directJoin: !!body.directJoin,
        openable: !!body.openable,
        matchId: typeof body.matchId === 'string' ? body.matchId.slice(0, 128) : '',
    }));
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
    if (!(await readArray(env, `fr:${cbId}`)).includes(to)) return json(403, { error: 'not friends' });

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

    const person = await personView(env, target);
    const [friends, outgoing, incoming] = await Promise.all([
        readArray(env, `fr:${cbId}`),
        readArray(env, `rout:${cbId}`),
        readArray(env, `rin:${cbId}`),
    ]);

    let relation = 'none';
    if (target === cbId) relation = 'self';
    else if (friends.includes(target)) relation = 'friend';
    else if (outgoing.includes(target)) relation = 'requested';
    else if (incoming.includes(target)) relation = 'incoming';

    return json(200, { ...person, relation });
}

// Chat rooms are "all" or a game id, so a room name maps straight to a Durable Object.
function chatRoomName(room) {
    const value = String(room || '').trim().toLowerCase();
    if (value === 'all') return 'all';
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

async function handleChatSend(env, cbId, body) {
    const room = chatRoomName(body.room);
    if (!room) return json(400, { error: 'bad room' });

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, CHAT_MAX_LENGTH) : '';
    if (!text) return json(400, { error: 'empty message' });

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
    return toChatRoom(env, room, 'poll', { after: body.after });
}

// Deliver-once: returns pending messages and clears the mailbox.
async function handleInvitePoll(env, cbId) {
    const box = await readMailbox(env, cbId);
    if (box.length) await env.CB.delete(`inv:${cbId}`);
    const fresh = box.filter(m => Date.now() - (m.at || 0) < 120000);
    return json(200, { messages: fresh });
}

async function handleLfgPost(env, cbId, body) {
    const game = typeof body.game === 'string' ? body.game.slice(0, 32) : '';
    if (!game) return json(400, { error: 'game required' });
    const slots = Number.isFinite(body.slots) ? Math.max(0, Math.min(16, Math.trunc(body.slots))) : 0;
    await env.CB.put(`lfg:${cbId}`, JSON.stringify({
        at: Date.now(),
        game,
        mode: typeof body.mode === 'string' ? body.mode.slice(0, 16) : '',
        note: typeof body.note === 'string' ? body.note.slice(0, 200) : '',
        slots,
        joiners: [],
    }));
    return json(200, { ok: true });
}

async function handleLfgClear(env, cbId) {
    await env.CB.delete(`lfg:${cbId}`);
    return json(200, { ok: true });
}

// Bumps a broadcast's freshness without disturbing its roster, keeping it live.
async function handleLfgRefresh(env, cbId) {
    const raw = await env.CB.get(`lfg:${cbId}`);
    if (!raw) return json(404, { error: 'no broadcast' });
    let rec;
    try { rec = JSON.parse(raw); } catch { return json(404, { error: 'no broadcast' }); }
    rec.at = Date.now();
    await env.CB.put(`lfg:${cbId}`, JSON.stringify(rec));
    return json(200, { ok: true });
}

// Adds you to a poster's roster and sends a friend request so you can connect. Idempotent.
async function handleLfgJoin(env, cbId, body) {
    const poster = String(body.cbId || '');
    if (!poster || poster === cbId) return json(400, { error: 'bad target' });

    const raw = await env.CB.get(`lfg:${poster}`);
    if (!raw) return json(404, { error: 'post not found' });
    let rec;
    try { rec = JSON.parse(raw); } catch { return json(404, { error: 'post not found' }); }
    if (Date.now() - (rec.at || 0) > LFG_FRESH_MS) return json(404, { error: 'post expired' });

    rec.joiners = Array.isArray(rec.joiners) ? rec.joiners : [];
    if (!rec.joiners.includes(cbId)) rec.joiners.push(cbId);
    await env.CB.put(`lfg:${poster}`, JSON.stringify(rec));

    await sendFriendRequest(env, cbId, poster);
    return json(200, { ok: true });
}

async function handleLfgList(env, cbId, body) {
    const wantGame = typeof body.game === 'string' ? body.game : '';
    const friends = new Set(await readArray(env, `fr:${cbId}`));
    const outgoing = new Set(await readArray(env, `rout:${cbId}`));

    const posts = [];
    let cursor;
    do {
        const page = await env.CB.list({ prefix: 'lfg:', cursor });
        for (const entry of page.keys) {
            const id = entry.name.slice('lfg:'.length);
            const raw = await env.CB.get(entry.name);
            if (!raw) continue;
            let rec;
            try { rec = JSON.parse(raw); } catch { continue; }
            if (Date.now() - (rec.at || 0) > LFG_FRESH_MS) continue;
            if (wantGame && rec.game !== wantGame) continue;

            const joiners = Array.isArray(rec.joiners) ? rec.joiners : [];
            const person = await personView(env, id);
            posts.push({
                ...person,
                game: rec.game,
                mode: rec.mode || '',
                note: rec.note || '',
                slots: rec.slots || 0,
                joined: joiners.length,
                iJoined: joiners.includes(cbId),
                // Your own broadcast is listed too, so you can see the lobby you're advertising.
                relation: id === cbId ? 'self'
                    : (friends.has(id) ? 'friend' : (outgoing.has(id) ? 'requested' : 'none')),
            });
        }
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

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

        switch (pathname) {
            case '/v1/account/bootstrap':
                return handleBootstrap(env, fpr, body);
            case '/v1/account':
                return handleWhoami(env, fpr);
            case '/v1/recover/hwid':
                if (!HWID_RE.test(String(body.hwidHash || ''))) {
                    return json(400, { error: 'hwidHash must be a sha256 hex string' });
                }
                return handleRecover(env, fpr, body, `hwid:${body.hwidHash}`);
            case '/v1/recover/discord': {
                const discordId = await resolveDiscordId(body.discordToken);
                if (!discordId) return json(401, { error: 'invalid discord token' });
                return handleRecover(env, fpr, body, `discord:${discordId}`);
            }
            case '/v1/recover/code': {
                if (typeof body.recoveryCode !== 'string' || !body.recoveryCode) {
                    return json(400, { error: 'recoveryCode required' });
                }
                const hash = await sha256Hex(new TextEncoder().encode(body.recoveryCode));
                return handleRecover(env, fpr, body, `rec:${hash}`);
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
            case '/v1/chat/send':
                return handleChatSend(env, cbId, body);
            case '/v1/chat/poll':
                return handleChatPoll(env, cbId, body);
            case '/v1/lfg/list':
                return handleLfgList(env, cbId, body);
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
            return json(200, { ok: true, id: message.id });
        }

        if (pathname === '/poll') {
            const after = Number(body.after) || 0;
            return json(200, { messages: this.messages.filter(m => m.id > after) });
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
