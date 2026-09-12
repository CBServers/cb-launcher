// The invite inbox: one held poll per device key carrying both the CB and the Discord address.
import { makeEnv, makeClient, mk, sha256Hex, checks, stubDiscord, restoreFetch } from './harness.mjs';

const A_DISCORD = '111111111111111111';
const B_DISCORD = '222222222222222222';
const D_DISCORD = '444444444444444444';
stubDiscord(token => {
    const m = /^tok-(\d+)$/.exec(token);
    return m ? { id: m[1], avatar: null, username: 'u' + m[1] } : null;
});

const { env, drop } = makeEnv();
const call = makeClient(env);
const check = checks();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A and B: CB friends who are also Discord-linked. C: a CB stranger. D: Discord only, no profile.
const A = await mk(), B = await mk(), C = await mk(), D = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'host', displayName: 'Host' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'joiner', displayName: 'Joiner' })).b.cbId;
await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'stranger', displayName: 'Stranger' });
await call(A, '/v1/friends/add', { handle: 'joiner' });
await call(B, '/v1/friends/accept', { cbId: aId });

const at = await call(A, '/v1/inbox/attach', { discordToken: 'tok-' + A_DISCORD });
check('attach binds both addresses', at.s === 200 && at.b.cbId === aId && at.b.discordId === A_DISCORD && at.b.relayEnabled === true);
check('unattached recipient -> offline',
    (await call(A, '/v1/invite/send', { to: bId, kind: 'invite', game: 'boiii', joinSecret: 'x' })).b.reason === 'offline');

await call(B, '/v1/inbox/attach', { discordToken: 'tok-' + B_DISCORD });
const first = await call(B, '/v1/inbox/poll', { after: 0, hold: false });
check('poll reports attached with an empty inbox', first.s === 200 && first.b.attached === true && first.b.messages.length === 0);

// Held poll wakes the moment a CB invite lands.
const held = call(B, '/v1/inbox/poll', { after: first.b.cursor, hold: true });
await sleep(150);
const t0 = Date.now();
const sent = await call(A, '/v1/invite/send', { to: bId, kind: 'invite', game: 'boiii', matchId: 'm1', joinSecret: 'cbl:secret-1' });
check('cb invite -> delivered', sent.s === 200 && sent.b.reason === 'delivered' && !!sent.b.id);
const woke = await held;
const inv = woke.b.messages[0];
check('held poll wakes on delivery', Date.now() - t0 < 1000 && !!inv);
check('cb invite carries sender, source and secret', inv.from === aId && inv.source === 'cb' && inv.joinSecret === 'cbl:secret-1');

check('acked cursor suppresses redelivery',
    (await call(B, '/v1/inbox/poll', { after: woke.b.cursor, hold: false })).b.messages.length === 0);

// Discord-addressed traffic rides the same inbox.
const heldD = call(B, '/v1/inbox/poll', { after: woke.b.cursor, hold: true });
await sleep(150);
const dsent = await call(A, '/v1/invite/send', { to: B_DISCORD, kind: 'join-request', game: 'boiii', matchId: 'm1' });
check('discord join-request -> delivered', dsent.b.reason === 'delivered');
const dgot = (await heldD).b.messages[0];
check('discord message carries the discord sender', !!dgot && dgot.from === A_DISCORD && dgot.source === 'discord' && dgot.kind === 'join-request');

// Approval and decline replies.
const heldA = call(A, '/v1/inbox/poll', { after: 0, hold: true });
await sleep(150);
await call(B, '/v1/invite/send', { to: A_DISCORD, kind: 'invite', isApproval: true, replyTo: dgot.id, accept: true, game: 'boiii', joinSecret: 'cbl:secret-2' });
const appr = (await heldA).b.messages.find(m => m.isApproval);
check('approval carries the secret and replyTo', !!appr && appr.joinSecret === 'cbl:secret-2' && appr.replyTo === dgot.id);
const cursorA = appr.seq;
await call(B, '/v1/invite/send', { to: aId, kind: 'invite', isApproval: true, replyTo: 'x', accept: false, joinSecret: 'leak' });
const decl = (await call(A, '/v1/inbox/poll', { after: cursorA, hold: false })).b.messages.find(m => m.isApproval && !m.accept);
check('decline carries no secret', !!decl && decl.joinSecret === '');

// Gates.
check('non-friend cb invite -> 403',
    (await call(C, '/v1/invite/send', { to: aId, kind: 'invite', joinSecret: 'x' })).s === 403);
check('discord send without a discord binding -> failed (SDK fallback)',
    (await call(C, '/v1/invite/send', { to: A_DISCORD, kind: 'invite' })).b.reason === 'failed');
check('malformed target -> 400', (await call(A, '/v1/invite/send', { to: 'nope' })).s === 400);
check('self target -> 400', (await call(A, '/v1/invite/send', { to: aId })).s === 400);

// Discord-only launcher: no account, still reachable by Discord id.
const dat = await call(D, '/v1/inbox/attach', { discordToken: 'tok-' + D_DISCORD });
check('discord-only launcher attaches without an account', dat.s === 200 && dat.b.cbId === '' && dat.b.discordId === D_DISCORD);
const heldDD = call(D, '/v1/inbox/poll', { after: 0, hold: true });
await sleep(150);
check('cb user can reach a discord-only launcher', (await call(A, '/v1/invite/send', { to: D_DISCORD, kind: 'invite', joinSecret: 's' })).b.reason === 'delivered');
check('discord-only launcher receives it', (await heldDD).b.messages.some(m => m.from === A_DISCORD));
check('discord-only launcher cannot send cb invites', (await call(D, '/v1/invite/send', { to: aId, kind: 'invite' })).s === 401);

// A bad Discord token is reported, and the CB address still binds.
const bad = await call(A, '/v1/inbox/attach', { discordToken: 'tok-bad' });
check('bad discord token attaches with discordError', bad.s === 200 && bad.b.discordError === true && bad.b.cbId === aId && bad.b.discordId === '');
check('cb address survives a bad discord token',
    (await call(B, '/v1/invite/send', { to: aId, kind: 'invite', joinSecret: 's' })).b.reason === 'delivered');
check('discord address is gone until re-attached',
    (await call(B, '/v1/invite/send', { to: A_DISCORD, kind: 'invite' })).b.reason === 'offline');
await call(A, '/v1/inbox/attach', { discordToken: 'tok-' + A_DISCORD });

// Restart: the inbox instance is gone, the poll says so, and a re-attach resumes with higher seqs.
const before = (await call(B, '/v1/inbox/poll', { after: 0, hold: false })).b.cursor;
drop('INBOX');
const tLost = Date.now();
const lost = await call(B, '/v1/inbox/poll', { after: before, hold: true });
check('a held poll after a restart returns at once with attached:false', lost.b.attached === false && Date.now() - tLost < 1000);
await call(B, '/v1/inbox/attach', { discordToken: 'tok-' + B_DISCORD });
await sleep(5); // the new instance seeds seq from the clock
await call(A, '/v1/invite/send', { to: bId, kind: 'invite', joinSecret: 'after-restart' });
const resumed = (await call(B, '/v1/inbox/poll', { after: before, hold: false })).b;
check('a stale cursor does not hide messages from the new instance',
    resumed.attached === true && resumed.messages.some(m => m.joinSecret === 'after-restart'));

// Two devices on one address: the newer binding wins and the older one cannot keep it alive.
const B2 = await mk();
await call(B2, '/v1/recover/hwid', { hwidHash: await sha256Hex('B') });
await call(B2, '/v1/inbox/attach');
await call(B, '/v1/inbox/poll', { after: 0, hold: false });
const heldB2 = call(B2, '/v1/inbox/poll', { after: 0, hold: true });
await sleep(150);
await call(A, '/v1/invite/send', { to: bId, kind: 'invite', joinSecret: 'to-b2' });
check('the newest device bound to an address receives', (await heldB2).b.messages.some(m => m.joinSecret === 'to-b2'));

// Throttle is distinct from offline: the client must not fall back on it.
let throttled = false;
for (let i = 0; i < 40 && !throttled; i++) {
    const r = await call(A, '/v1/invite/send', { to: bId, kind: 'invite', joinSecret: 's' });
    throttled = r.s === 429 && r.b.reason === 'throttled';
}
check('rate limit -> 429 throttled', throttled);

restoreFetch();
check.done();
