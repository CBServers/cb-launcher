// CB game invites: joinable presence flags, the friends-only mailbox, and deliver-once semantics.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk(), C = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'host', displayName: 'Host' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'joiner', displayName: 'Joiner' })).b.cbId;
await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'stranger', displayName: 'Stranger' });

await call(A, '/v1/friends/add', { handle: 'joiner' });
await call(B, '/v1/friends/accept', { cbId: aId });

await call(A, '/v1/presence', { game: 'boiii', mode: 'zm', joinable: true, directJoin: false, openable: true, matchId: 'match-42' });
const host = (await call(B, '/v1/friends/list')).b.friends.find(p => p.cbId === aId);
check('friend presence carries join flags', host && host.joinable === true && host.openable === true && host.matchId === 'match-42');

const send = await call(B, '/v1/invite/send', { to: aId, kind: 'join-request', game: 'boiii', matchId: 'match-42' });
check('join-request sent', send.s === 200 && !!send.b.id);

let poll = await call(A, '/v1/invite/poll');
const req = poll.b.messages.find(m => m.kind === 'join-request');
check('host receives join-request from joiner', !!req && req.sender === bId && req.matchId === 'match-42');
check('mailbox deliver-once (second poll empty)', (await call(A, '/v1/invite/poll')).b.messages.length === 0);

const approve = await call(A, '/v1/invite/send', {
    to: bId, kind: 'invite', isApproval: true, replyTo: req.id,
    game: 'boiii', matchId: 'match-42', joinSecret: 'cbl:AAA-secret-BBB',
});
check('approval sent', approve.s === 200);

poll = await call(B, '/v1/invite/poll');
const appr = poll.b.messages.find(m => m.isApproval);
check('joiner receives approval with join secret', !!appr && appr.joinSecret === 'cbl:AAA-secret-BBB');

await call(A, '/v1/invite/send', { to: bId, kind: 'invite', game: 'boiii', matchId: 'match-42', joinSecret: 'cbl:INVITE-secret' });
poll = await call(B, '/v1/invite/poll');
check('joiner receives direct invite with secret',
    poll.b.messages.some(m => m.kind === 'invite' && m.joinSecret === 'cbl:INVITE-secret'));

check('non-friend invite rejected (403)',
    (await call(C, '/v1/invite/send', { to: aId, kind: 'invite', game: 'boiii', joinSecret: 'x' })).s === 403);

check.done();
