// The Discord invite relay folded into this worker: exactly the protocol relay_client.cpp speaks.
import { makeEnv, makeRelayClient, checks, stubDiscord, restoreFetch, worker, nowSec } from './harness.mjs';

const A_ID = '111111111111111111';
const B_ID = '222222222222222222';
stubDiscord(token => {
    const m = /^tok-(\d+)$/.exec(token);
    return m ? { id: m[1], avatar: null, username: 'u' + m[1] } : null;
});

const { env } = makeEnv();
const relay = makeRelayClient(env);
const check = checks();

const sa = await relay('/v1/session/start', 'tok-' + A_ID);
const sb = await relay('/v1/session/start', 'tok-' + B_ID);
check('session/start mints relayToken + relayEnabled', sa.s === 200 && !!sa.b.relayToken && sa.b.relayEnabled === true);
const ta = sa.b.relayToken, tb = sb.b.relayToken;

// Both must poll once before either is considered reachable.
await relay('/v1/poll', ta, { ack: [], session: { game: 'boiii', matchId: 'm1', joinable: true } });
await relay('/v1/poll', tb, { ack: [] });

const held = relay('/v1/poll', tb, { ack: [] });
const t0 = Date.now();
await new Promise(r => setTimeout(r, 200));
const inv = await relay('/v1/invite', ta, { to: B_ID, kind: 'invite', game: 'boiii', matchId: 'm1', joinSecret: 'cbl:secret-1' });
check('invite -> delivered', inv.s === 200 && inv.b.reason === 'delivered');

const got = ((await held).b.invites || [])[0];
check('long-poll wakes on delivery', Date.now() - t0 < 5000);
check('invite payload carries secret + sender', !!got && got.joinSecret === 'cbl:secret-1' && got.from === A_ID);

const acked = await Promise.race([
    relay('/v1/poll', tb, { ack: [got.id] }).then(r => (r.b.invites || []).length > 0),
    new Promise(r => setTimeout(() => r(false), 1500)),
]);
check('acked message is not redelivered', acked === false);

const apPoll = relay('/v1/poll', ta, { ack: [] });
await new Promise(r => setTimeout(r, 150));
await relay('/v1/invite/reply', tb, { to: A_ID, inviteId: got.id, accept: true, game: 'boiii', joinSecret: 'cbl:secret-2' });
const appr = ((await apPoll).b.invites || []).find(m => m.isApproval);
check('approval delivered with secret', !!appr && appr.joinSecret === 'cbl:secret-2');

check('unreachable recipient -> offline (SDK fallback)',
    (await relay('/v1/invite', ta, { to: '999999999999999999', kind: 'invite', game: 'boiii' })).b.reason === 'offline');

// throttled must be distinct from offline: the client falls back on one and not the other.
let throttled = false;
for (let i = 0; i < 40 && !throttled; i++) {
    const r = await relay('/v1/invite', ta, { to: B_ID, kind: 'invite', game: 'boiii' });
    throttled = r.s === 429 && r.b.reason === 'throttled';
}
check('rate limit -> 429 throttled', throttled);
check('invalid relay token -> 401', (await relay('/v1/poll', 'nope', {})).s === 401);
check('relay needs no CB account', (await relay('/v1/session/start', 'tok-' + A_ID)).s === 200);

// A relay token must not open the device-key authed side of the worker.
const cbRes = await worker.fetch(new Request('https://x/v1/friends/list', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ta, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ts: nowSec() }),
}), env);
check('CB endpoints still require a device signature', cbRes.status === 401);

restoreFetch();
check.done();
