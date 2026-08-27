// Recently played with: derived from the match rosters the directory already holds, so it costs
// nothing per player per match. Anyone already connected to must not be suggested.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env, drop } = makeEnv();
const call = makeClient(env);
const check = checks();

const ME = await mk(), A = await mk(), B = await mk(), C = await mk(), F = await mk();
const meId = (await call(ME, '/v1/account/bootstrap', { hwidHash: await sha256Hex('me'), handle: 'divity' })).b.cbId;
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('a'), handle: 'alpha' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('b'), handle: 'bravo' })).b.cbId;
const cId = (await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('c'), handle: 'charlie' })).b.cbId;
const fId = (await call(F, '/v1/account/bootstrap', { hwidHash: await sha256Hex('f'), handle: 'mate' })).b.cbId;

const inMatch = (who, matchId) => call(who, '/v1/presence', { game: 'boiii', mode: 'zm', matchId });

check('nothing to suggest before any match', (await call(ME, '/v1/played-with')).b.people.length === 0);

// Four of us in one match; C is on a different server.
await Promise.all([inMatch(ME, 'match-1'), inMatch(A, 'match-1'), inMatch(B, 'match-1'), inMatch(C, 'match-2')]);

const found = await call(ME, '/v1/played-with');
const handles = found.b.people.map(p => p.handle).sort();
check('everyone from my match is suggested', handles.join(',') === 'alpha,bravo');
check('someone on another server is not', !handles.includes('charlie'));
check('I am never suggested to myself', !found.b.people.some(p => p.cbId === meId));
check('suggestions carry a full profile', found.b.people[0].handle && found.b.people[0].game === 'boiii');

// Already-connected people are noise, so they drop out.
await call(ME, '/v1/friends/add', { handle: 'alpha' });
check('an outgoing request removes them from the list',
    !(await call(ME, '/v1/played-with')).b.people.some(p => p.cbId === aId));
await call(A, '/v1/friends/accept', { cbId: meId });
check('an accepted friend stays out', !(await call(ME, '/v1/played-with')).b.people.some(p => p.cbId === aId));
check('bravo is still suggested', (await call(ME, '/v1/played-with')).b.people.some(p => p.cbId === bId));

await call(ME, '/v1/block/add', { cbId: bId });
check('a blocked account is never suggested',
    (await call(ME, '/v1/played-with')).b.people.length === 0);

// A second match adds to the history rather than replacing it.
await Promise.all([inMatch(ME, 'match-3'), inMatch(F, 'match-3')]);
const after = await call(ME, '/v1/played-with');
check('a later match contributes too', after.b.people.some(p => p.cbId === fId));

// Presence with no matchId must not lump strangers together.
await call(C, '/v1/presence', { game: 'boiii' });
const D = await mk();
await call(D, '/v1/account/bootstrap', { hwidHash: await sha256Hex('d'), handle: 'delta' });
await call(D, '/v1/presence', { game: 'boiii' });
check('players with no match id are not treated as sharing one',
    !(await call(C, '/v1/played-with')).b.people.some(p => p.handle === 'delta'));

// The rosters live only in memory, like presence and the board.
drop('DIRECTORY');
check('a restarted directory simply has nothing to suggest',
    (await call(ME, '/v1/played-with')).b.people.length === 0);

check.done();
