// Player counts come from two signals: the presence beat accounts already send, and the anonymous
// pulse from launchers with no profile. The rules that matter are who counts, for how long, and
// that one launcher never counts twice.
import { makeEnv, makeClient, mk, sha256Hex, checks, worker } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();
const dir = env.DIRECTORY.get('main');

async function stats() {
    const res = await worker.fetch(new Request('https://x/v1/stats', { method: 'GET' }), env);
    return { s: res.status, h: res.headers, b: await res.json() };
}

const first = await stats();
check('stats is public and needs no signature', first.s === 200);
check('stats allows cross-origin reads', first.h.get('Access-Control-Allow-Origin') === '*');
check('an empty directory reports nobody', first.b.online === 0 && Object.keys(first.b.launcher).length === 0);
check('the answer carries its timestamp', typeof first.b.fetchedAt === 'string');

const anon = await mk();
check('pulse rejects an unsigned request',
    (await worker.fetch(new Request('https://x/v1/pulse', { method: 'POST', body: '{}' }), env)).status === 401);
check('a device key with no account may pulse', (await call(anon, '/v1/pulse', { game: 'boiii' })).s === 200);
check('the pulse never creates an account', (await call(anon, '/v1/account', {})).s === 404);

// Reads the directory straight, since the worker-level cache is not what these assert.
check('an anonymous launcher counts toward its game', dir.stats(Date.now()).launcher.boiii === 1);
check('and toward the online total', dir.stats(Date.now()).online === 1);

await call(anon, '/v1/pulse', { game: 'boiii' });
check('repeated pulses from one key count once', dir.stats(Date.now()).launcher.boiii === 1);

await call(anon, '/v1/pulse', { game: 't6' });
check('switching games moves the count', dir.stats(Date.now()).launcher.t6 === 1 && !dir.stats(Date.now()).launcher.boiii);

await call(anon, '/v1/pulse', { game: '' });
const idle = dir.stats(Date.now());
check('an idle launcher is online but in no game', idle.online === 1 && Object.keys(idle.launcher).length === 0);

const A = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'alpha' });
await call(A, '/v1/presence', { game: 'boiii' });
check('an account in a game counts from its presence beat', dir.stats(Date.now()).launcher.boiii === 1);
check('accounts and anonymous launchers add up', dir.stats(Date.now()).online === 2);

// The same launcher pulsed anonymously, then created a profile mid-session.
const B = await mk();
await call(B, '/v1/pulse', { game: 'boiii' });
check('setup: the newcomer counts anonymously', dir.stats(Date.now()).launcher.boiii === 2);
await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'bravo' });
await call(B, '/v1/presence', { game: 'boiii' });
check('a launcher that gains a profile is not counted twice', dir.stats(Date.now()).launcher.boiii === 2);

await call(B, '/v1/presence', { bye: true });
check('a goodbye beat drops the account from the count', dir.stats(Date.now()).launcher.boiii === 1);
await call(anon, '/v1/pulse', { bye: true });
check('a goodbye pulse drops the anonymous launcher', dir.stats(Date.now()).online === 1);

const C = await mk();
await call(C, '/v1/pulse', { game: 't6' });
dir.anon.get([...dir.anon.keys()][0]).at = Date.now() - 91_000;
check('a silent launcher ages out after the presence window', !dir.stats(Date.now()).launcher.t6);
dir.prune();
check('and is pruned from memory', dir.anon.size === 0);

const cap = 'x'.repeat(40);
await call(C, '/v1/pulse', { game: cap });
check('game ids are clamped', Object.keys(dir.stats(Date.now()).launcher).every(g => g.length <= 32));

await call(C, '/v1/pulse', { game: 's2x' });
const soon = dir.stats(Date.now());
check('a coming-soon game is not counted', !soon.launcher.s2x && soon.online >= 1);
check('nor kept in the stats history', !env.STATS.summary(Math.floor(Date.now() / 1000)).today.games.s2x);

// Beta testers still see each other in it, which is what lets a friend join.
const T1 = await mk(), T2 = await mk();
await call(T1, '/v1/account/bootstrap', { hwidHash: await sha256Hex('T1'), handle: 'tester1' });
await call(T2, '/v1/account/bootstrap', { hwidHash: await sha256Hex('T2'), handle: 'tester2' });
await call(T1, '/v1/friends/add', { handle: 'tester2' });
const t1Id = (await call(T2, '/v1/friends/list')).b.incoming.find(p => p.handle === 'tester1').cbId;
await call(T2, '/v1/friends/accept', { cbId: t1Id });
await call(T2, '/v1/presence', { game: 's2x', mode: 'mp', joinable: true, directJoin: true, players: 1, maxPlayers: 18 });
const t2 = (await call(T1, '/v1/friends/list')).b.friends.find(p => p.handle === 'tester2');
check('a coming-soon game shows in friend presence', t2 && t2.game === 's2x' && t2.joinable && t2.directJoin);
check('an account in it is online but not counted', !dir.stats(Date.now()).launcher.s2x);
check('a coming-soon game has no LFG board', (await call(T2, '/v1/lfg/post', { game: 's2x', note: 'test' })).s === 400);

// The worker answers from a short cache, so a burst of launchers polling costs one directory pass.
const again = await stats();
check('a quick second read is served from cache', again.b.fetchedAt === first.b.fetchedAt);
check('the cached answer advertises its max-age', /max-age=\d+/.test(again.h.get('Cache-Control') || ''));
check.done();
