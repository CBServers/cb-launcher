// Chat history must survive a Durable Object being torn down and recreated, and stay capped.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env, disk, drop } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity', displayName: 'Divity' });

await call(A, '/v1/chat/send', { room: 'boiii', text: 'first message' });
await call(A, '/v1/chat/send', { room: 'boiii', text: 'second message' });
check('messages visible before restart', (await call(A, '/v1/chat/poll', { room: 'boiii', after: 0 })).b.messages.length === 2);

drop('CHAT');
const after = await call(A, '/v1/chat/poll', { room: 'boiii', after: 0 });
check('history survives a redeploy', after.b.messages.length === 2 && after.b.messages[1].text === 'second message');
check('author details survive', after.b.messages[0].handle === 'divity');

// Ids must keep counting up; restarting at 1 would break incremental polling.
await call(A, '/v1/chat/send', { room: 'boiii', text: 'after restart' });
const grown = await call(A, '/v1/chat/poll', { room: 'boiii', after: 0 });
check('sequence continues after restart', grown.b.messages.map(m => m.id).join(',') === '1,2,3');
check('incremental poll still works across a restart',
    (await call(A, '/v1/chat/poll', { room: 'boiii', after: 2 })).b.messages.length === 1);

await call(A, '/v1/chat/send', { room: 'all', text: 'global one' });
drop('CHAT');
check('rooms stay isolated in storage',
    (await call(A, '/v1/chat/poll', { room: 'all', after: 0 })).b.messages.length === 1 &&
    (await call(A, '/v1/chat/poll', { room: 'boiii', after: 0 })).b.messages.length === 3);

// Driven straight at the object: the worker's per-sender limit would throttle a burst this size.
const trimRoom = env.CHAT.get('trim');
for (let i = 0; i < 210; i++) {
    await trimRoom.fetch(new Request('https://chat/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cbId: 'cb_sender' + (i % 30), handle: 'h', displayName: 'H', text: 'm' + i }),
    }));
}
drop('CHAT');
const trimRes = await env.CHAT.get('trim').fetch(new Request('https://chat/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ after: 0 }),
}));
const trimmed = (await trimRes.json()).messages;
check('history is capped at the retention window', trimmed.length === 200);
check('the newest messages are the ones kept', trimmed[trimmed.length - 1].text === 'm209');
check('pruned messages are deleted from storage, not just the mirror',
    [...disk.keys()].filter(k => k.startsWith('CHAT:trim:msg:')).length === 200);

check.done();
