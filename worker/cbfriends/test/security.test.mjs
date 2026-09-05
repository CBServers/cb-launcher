// Abuse surfaces: HWID rebind hardening, avatar host allowlist, blocking, reports, mute, throttles.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk(), C = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity', displayName: 'Divity' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova', displayName: 'Nova' })).b.cbId;

// An account in active use must not be handed over on the strength of a forgeable HWID.
await call(A, '/v1/presence', { game: 'boiii' });
check('hwid rebind refused while the account is in use',
    (await call(await mk(), '/v1/recover/hwid', { hwidHash: await sha256Hex('A') })).s === 409);
check('blocked attempt is recorded for the owner',
    (await call(A, '/v1/security/events')).b.events.some(e => e.kind === 'recover-blocked'));

const dormant = await mk();
const dId = (await call(dormant, '/v1/account/bootstrap', { hwidHash: await sha256Hex('D'), handle: 'dormant' })).b.cbId;
const newKey = await mk();
check('dormant account still recovers by hwid',
    (await call(newKey, '/v1/recover/hwid', { hwidHash: await sha256Hex('D') })).b.cbId === dId);
check('device-added is recorded',
    (await call(newKey, '/v1/security/events')).b.events.some(e => e.kind === 'device-added' && e.via === 'hwid'));

// Limited on the anchor rather than the caller, so a fresh key per attempt buys nothing.
let limited = false;
for (let i = 0; i < 12 && !limited; i++) {
    limited = (await call(await mk(), '/v1/recover/hwid', { hwidHash: await sha256Hex('D') })).s === 429;
}
check('recovery attempts are rate limited per anchor', limited);

check('allowed avatar host accepted',
    (await call(A, '/v1/account/profile', { avatarUrl: 'https://i.imgur.com/abc.png' })).s === 200);
check('arbitrary avatar host rejected',
    (await call(A, '/v1/account/profile', { avatarUrl: 'https://tracker.example.com/pixel.png' })).s === 400);

await call(B, '/v1/friends/add', { handle: 'divity' });
await call(A, '/v1/friends/accept', { cbId: bId });
check('friends before block', (await call(A, '/v1/friends/list')).b.friends.some(f => f.cbId === bId));

check('block succeeds', (await call(A, '/v1/block/add', { cbId: bId })).s === 200);
check('blocking severs the friendship both ways',
    !(await call(A, '/v1/friends/list')).b.friends.some(f => f.cbId === bId) &&
    !(await call(B, '/v1/friends/list')).b.friends.some(f => f.cbId === aId));
check('blocked user cannot re-add (indistinguishable from missing)',
    (await call(B, '/v1/friends/add', { handle: 'divity' })).s === 404);
check('block list shows who is blocked', (await call(A, '/v1/block/list')).b.blocked.some(p => p.cbId === bId));

await call(B, '/v1/chat/send', { room: 'all', text: 'from blocked user' });
await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'carol' });
check('blocker does not see blocked messages',
    !(await call(A, '/v1/chat/poll', { room: 'all', after: 0 })).b.messages.some(m => m.cbId === bId));
check('everyone else still sees them',
    ((await call(C, '/v1/chat/poll', { room: 'all', after: 0 })).b.messages || []).some(m => m.cbId === bId));

check('unblock restores reachability',
    (await call(A, '/v1/block/remove', { cbId: bId })).s === 200 &&
    (await call(B, '/v1/friends/add', { handle: 'divity' })).s === 200);

check('report is accepted', (await call(A, '/v1/report', { cbId: bId, reason: 'spam' })).s === 200);
check('cannot report yourself', (await call(A, '/v1/report', { cbId: aId })).s === 400);

await env.CB.put(`muted:${bId}`, '1');
check('muted account cannot send chat', (await call(B, '/v1/chat/send', { room: 'all', text: 'hi' })).s === 403);
await env.CB.delete(`muted:${bId}`);

// Loops past the limit rather than asserting its exact value, so tuning it does not break the test.
const spammer = await mk();
await call(spammer, '/v1/account/bootstrap', { hwidHash: await sha256Hex('S'), handle: 'spammer' });
let capped = false;
for (let i = 0; i < 400 && !capped; i++) {
    capped = (await call(spammer, '/v1/account')).s === 429;
}
check('per-caller rate limit applies to CB endpoints', capped);

check.done();
