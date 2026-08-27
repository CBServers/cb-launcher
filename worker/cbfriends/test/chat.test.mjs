// Chat rooms: per-game and global, incremental polling, validation, per-sender rate limit.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity', displayName: 'Divity' });
await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova', displayName: 'Nova' });

const sent = await call(A, '/v1/chat/send', { room: 'boiii', text: 'anyone up for EE?' });
check('send to a game room', sent.s === 200 && sent.b.ok === true);

const poll = await call(B, '/v1/chat/poll', { room: 'boiii', after: 0 });
const msg = (poll.b.messages || [])[0];
check('other user sees the message with author', !!msg && msg.text === 'anyone up for EE?' && msg.handle === 'divity');

await call(B, '/v1/chat/send', { room: 'boiii', text: 'im down' });
const since = await call(A, '/v1/chat/poll', { room: 'boiii', after: msg.id });
check('incremental poll returns only new messages', since.b.messages.length === 1 && since.b.messages[0].text === 'im down');

check('rooms are isolated', ((await call(A, '/v1/chat/poll', { room: 'iw4x', after: 0 })).b.messages || []).length === 0);

await call(A, '/v1/chat/send', { room: 'all', text: 'hello everyone' });
const all = await call(B, '/v1/chat/poll', { room: 'all', after: 0 });
const boiii = await call(B, '/v1/chat/poll', { room: 'boiii', after: 0 });
check('global room holds its own history', all.b.messages.length === 1 && boiii.b.messages.length === 2);

check('empty message rejected', (await call(A, '/v1/chat/send', { room: 'all', text: '   ' })).s === 400);
check('bad room rejected', (await call(A, '/v1/chat/send', { room: 'not a room!', text: 'hi' })).s === 400);

const long = await call(A, '/v1/chat/send', { room: 'all', text: 'x'.repeat(500) });
const longMsg = (await call(A, '/v1/chat/poll', { room: 'all', after: 0 })).b.messages.find(m => m.text.startsWith('xxx'));
check('long message truncated to the cap', long.s === 200 && longMsg && longMsg.text.length === 300);

let limited = false;
for (let i = 0; i < 30 && !limited; i++) {
    limited = (await call(B, '/v1/chat/send', { room: 'all', text: 'spam ' + i })).s === 429;
}
check('rate limit kicks in', limited);

check('no account -> 401', (await call(await mk(), '/v1/chat/poll', { room: 'all' })).s === 401);

check.done();
