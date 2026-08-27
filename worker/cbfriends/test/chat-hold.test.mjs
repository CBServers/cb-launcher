// A held chat poll: it waits instead of returning empty, wakes the moment someone sends, and still
// advances the caller's cursor past authors it filtered out.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity' });
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova' })).b.cbId;

// Without hold the poll answers straight away, which is what scrollback and the first paint need.
const t0 = Date.now();
const immediate = await call(A, '/v1/chat/poll', { room: 'boiii', after: 0 });
check('an unheld poll returns at once', immediate.s === 200 && Date.now() - t0 < 1000);

const held = call(A, '/v1/chat/poll', { room: 'boiii', after: 0, hold: true });
const settled = await Promise.race([held.then(() => 'returned'), new Promise(r => setTimeout(() => r('waiting'), 400))]);
check('a held poll waits rather than returning empty', settled === 'waiting');

const t1 = Date.now();
await call(B, '/v1/chat/send', { room: 'boiii', text: 'first' });
const woke = await held;
check('sending wakes the held poll', woke.s === 200 && woke.b.messages.length === 1 && woke.b.messages[0].text === 'first');
check('delivery is immediate, not on the next tick', Date.now() - t1 < 2000);

// A poll that already has something newer must not wait for the timeout.
const t2 = Date.now();
const ready = await call(A, '/v1/chat/poll', { room: 'boiii', after: 0, hold: true });
check('a hold with messages already waiting returns at once',
    ready.b.messages.length === 1 && Date.now() - t2 < 1000);

// The whole point of the cursor: blocking someone must not leave the client re-asking forever.
await call(A, '/v1/block/add', { cbId: bId });
await call(B, '/v1/chat/send', { room: 'boiii', text: 'from a blocked user' });
const filtered = await call(A, '/v1/chat/poll', { room: 'boiii', after: 1, hold: true });
check('a blocked author is filtered out of the messages', filtered.b.messages.length === 0);
check('the cursor still advances past them', filtered.b.cursor === 2);

const t3 = Date.now();
const after = await call(A, '/v1/chat/poll', { room: 'boiii', after: filtered.b.cursor, hold: true });
check('polling from that cursor holds instead of spinning',
    after.b.messages.length === 0 && Date.now() - t3 >= 400);

check.done();
