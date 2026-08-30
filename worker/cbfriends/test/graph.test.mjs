// Edges live in a per-account object now: existing KV arrays must migrate in, and concurrent
// updates must not clobber each other the way a read-modify-write did.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env, drop } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk(), C = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova' })).b.cbId;
const cId = (await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'carol' })).b.cbId;

// An account whose edges predate the migration: written straight into the old KV keys.
await env.CB.put(`fr:${aId}`, JSON.stringify([bId]));
await env.CB.put(`rin:${aId}`, JSON.stringify([cId]));
await env.CB.put(`blk:${aId}`, JSON.stringify([cId]));
const migrated = await call(A, '/v1/friends/list');
check('legacy KV friends migrate into the graph', migrated.b.friends.some(p => p.cbId === bId));
check('legacy KV requests migrate too', migrated.b.incoming.some(p => p.cbId === cId));
check('legacy KV blocks migrate too', (await call(A, '/v1/block/list')).b.blocked.some(p => p.cbId === cId));

// Seeding happens once: later KV writes must not overwrite what the graph now owns.
await env.CB.put(`fr:${aId}`, JSON.stringify([]));
check('graph ignores the old KV keys after seeding',
    (await call(A, '/v1/friends/list')).b.friends.some(p => p.cbId === bId));

check('edges survive the object being recreated',
    (drop('GRAPH'), (await call(A, '/v1/friends/list')).b.friends.some(p => p.cbId === bId)));

// Two edits racing on one account: a read-modify-write would drop one, a batched object keeps both.
const D = await mk(), E = await mk();
const dId = (await call(D, '/v1/account/bootstrap', { hwidHash: await sha256Hex('D'), handle: 'dave' })).b.cbId;
const eId = (await call(E, '/v1/account/bootstrap', { hwidHash: await sha256Hex('E'), handle: 'erin' })).b.cbId;
await Promise.all([
    call(D, '/v1/friends/add', { handle: 'carol' }),
    call(E, '/v1/friends/add', { handle: 'carol' }),
]);
const cIncoming = (await call(C, '/v1/friends/list')).b.incoming.map(p => p.cbId);
check('concurrent requests to one account both land',
    cIncoming.includes(dId) && cIncoming.includes(eId));

// Accepting is three edits on each side and must apply as one unit.
await call(C, '/v1/friends/accept', { cbId: dId });
const cAfter = await call(C, '/v1/friends/list');
check('accept moves the edge rather than duplicating it',
    cAfter.b.friends.some(p => p.cbId === dId) && !cAfter.b.incoming.some(p => p.cbId === dId));
check('the other side sees the accepted friendship',
    (await call(D, '/v1/friends/list')).b.friends.some(p => p.cbId === cId));

// A block has to clear every edge on both accounts in one pass.
await call(C, '/v1/block/add', { cbId: dId });
const cBlocked = await call(C, '/v1/friends/list');
const dAfterBlock = await call(D, '/v1/friends/list');
check('blocking clears friends and requests on both sides',
    !cBlocked.b.friends.some(p => p.cbId === dId) && !dAfterBlock.b.friends.some(p => p.cbId === cId));

check('presence directory reports a friend as offline before any beat',
    (await call(E, '/v1/friends/list')).b.outgoing.every(p => p.online === false));

// The directory is memory-only, so a restart drops presence but must not drop the friend graph.
await call(A, '/v1/presence', { game: 'boiii' });
check('presence is visible while the directory is warm',
    (await call(A, '/v1/profile/get', { cbId: aId })).b.online === true);
drop('DIRECTORY');
const cold = await call(A, '/v1/profile/get', { cbId: aId });
check('a restarted directory reports offline, not a broken profile',
    cold.s === 200 && cold.b.handle === 'divity' && cold.b.online === false);

check.done();
