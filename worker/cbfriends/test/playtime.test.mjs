// Playtime is accumulated from the presence beat the launcher already sends, so it needs nothing
// from the game. The rules that matter are what counts as continuous play and what does not.
import { makeEnv, makeClient, mk, sha256Hex, checks, mod } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity' })).b.cbId;

// The directory is driven straight here: a real session is many beats over many minutes, and the
// suite cannot wait for that.
const dir = env.DIRECTORY.get('main');
const beat = (cbId, game, at) => dir.fetch(new Request('https://dir/beat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cbId, profile: { handle: 'divity' }, createdAt: 1, pres: { game }, at }),
}));

check('a first beat credits nothing, having no gap to measure',
    (await (await beat(aId, 'boiii')).json()).flush === null);

// Fakes the clock by rewriting the stored beat time, which is what the gap is measured against.
// A real client beats well inside the credit window, so the suite has to as well.
async function beatAfter(seconds, game, who = aId) {
    dir.people.get(who).pres.at = Date.now() - seconds * 1000;
    return (await (await beat(who, game)).json()).flush;
}

// Ten beats a minute apart is ten minutes of play, and the last one crosses the threshold.
async function playMinutes(count, game) {
    let flush = null;
    for (let i = 0; i < count; i++) flush = (await beatAfter(60, game)) || flush;
    return flush;
}

check('a short gap banks time without flushing yet', (await beatAfter(60, 'boiii')) === null);
check('time keeps banking across beats', (await beatAfter(60, 'boiii')) === null);

// A gap longer than presence freshness is a new session, not eleven hours of play.
const before = dir.people.get(aId).pendingTotal;
await beatAfter(40000, 'boiii');
check('a long gap is treated as a new session, not played time',
    dir.people.get(aId).pendingTotal === before);

// Crossing the flush threshold hands the total to the worker to write down.
const flushed = await playMinutes(10, 'boiii');
check('crossing the threshold flushes', !!flushed && flushed.boiii >= 600);
check('the bank resets after a flush', dir.people.get(aId).pendingTotal < 600);

// Per game, not a single total.
await beatAfter(60, 'iw4x');
check('time is tracked per game', dir.people.get(aId).pending.iw4x === 60);

// End to end through the worker, on a clean account so the arithmetic is exact:
// ten one-minute beats reach the threshold and flush exactly ten minutes.
const C = await mk();
const cId = (await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'player' })).b.cbId;
await call(C, '/v1/presence', { game: 'boiii' });
for (let i = 0; i < 10; i++) {
    dir.people.get(cId).pres.at = Date.now() - 60 * 1000;
    await call(C, '/v1/presence', { game: 'boiii' });
}

const me = await call(C, '/v1/profile/get', { cbId: cId });
check('playtime reaches the profile', me.b.playtime && me.b.playtime.boiii === 600);
check('the profile still carries everything else', me.b.handle === 'player' && me.b.relation === 'self');

// It must survive a directory restart, since it lives on the account not in memory.
env.DIRECTORY.get('main');
check('banked playtime is on the account, not the directory',
    (await call(C, '/v1/profile/get', { cbId: cId })).b.playtime.boiii === 600);

// Idle in the launcher with no game is not playtime.
const B = await mk();
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'idle' })).b.cbId;
await call(B, '/v1/presence', {});
for (let i = 0; i < 11; i++) {
    dir.people.get(bId).pres.at = Date.now() - 60 * 1000;
    await call(B, '/v1/presence', {});
}
check('sitting in the launcher earns no playtime',
    Object.keys((await call(B, '/v1/profile/get', { cbId: bId })).b.playtime || {}).length === 0);
check('a friend sees the same playtime on the public card',
    (await call(A, '/v1/profile/get', { cbId: cId })).b.playtime.boiii === 600);

check.done();
