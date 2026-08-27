// Direct messages: friends-only, unread counts, and the fact that a DM room cannot be reached
// through the open chat endpoints even though its id is derived from two public cbIds.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env, drop } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk(), C = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova' })).b.cbId;
const cId = (await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'stranger' })).b.cbId;

await call(A, '/v1/friends/add', { handle: 'nova' });
await call(B, '/v1/friends/accept', { cbId: aId });

check('a stranger cannot open a conversation',
    (await call(C, '/v1/dm/send', { to: aId, text: 'hi' })).s === 403);
check('and cannot read one', (await call(C, '/v1/dm/poll', { with: aId })).s === 403);
check('you cannot message yourself', (await call(A, '/v1/dm/send', { to: aId, text: 'hi' })).s === 403);

const sent = await call(A, '/v1/dm/send', { to: bId, text: 'want to run an EE?' });
check('a friend can send', sent.s === 200 && sent.b.ok === true);

const read = await call(B, '/v1/dm/poll', { with: aId, after: 0 });
check('the other side receives it', read.b.messages.length === 1 && read.b.messages[0].text === 'want to run an EE?');
check('the message names its author', read.b.messages[0].handle === 'divity');

// Both sides address the same conversation without any stored mapping.
const fromA = await call(A, '/v1/dm/poll', { with: bId, after: 0 });
check('both sides see the same conversation', fromA.b.messages.length === 1);

// Unread bookkeeping.
await call(A, '/v1/dm/send', { to: bId, text: 'second' });
await call(A, '/v1/dm/send', { to: bId, text: 'third' });
let list = await call(B, '/v1/dm/list');
check('the recipient has unread', list.b.unread === 2 && list.b.conversations[0].unread === 2);
check('the list carries a preview and the peer profile',
    list.b.conversations[0].preview === 'third' && list.b.conversations[0].handle === 'divity');
check('the sender has none of their own', (await call(A, '/v1/dm/list')).b.unread === 0);

await call(B, '/v1/dm/poll', { with: aId, after: 0 });
check('reading the tail clears unread', (await call(B, '/v1/dm/list')).b.unread === 0);
await call(A, '/v1/dm/send', { to: bId, text: 'fourth' });
await call(B, '/v1/dm/poll', { with: aId, before: 2 });
check('scrollback does not clear unread', (await call(B, '/v1/dm/list')).b.unread === 1);

// The important one: a DM room id is derivable from two public cbIds, so the open chat endpoints
// must refuse to name one.
const pair = [aId, bId].sort().join('|');
const digest = await sha256Hex(pair);
const room = 'dm-' + digest.slice(0, 28);
check('the open chat endpoint refuses a dm room id',
    (await call(C, '/v1/chat/poll', { room, after: 0 })).s === 400);
check('and refuses to send into one',
    (await call(C, '/v1/chat/send', { room, text: 'intruding' })).s === 400);
check('any dm- prefixed room is refused, not just a real one',
    (await call(C, '/v1/chat/poll', { room: 'dm-anything', after: 0 })).s === 400);

// History survives, same as any other room.
drop('CHAT');
check('conversation history survives a redeploy',
    (await call(A, '/v1/dm/poll', { with: bId, after: 0 })).b.messages.length === 4);

// Blocking closes the conversation in both directions.
await call(A, '/v1/block/add', { cbId: bId });
check('blocking closes the conversation for the blocker',
    (await call(A, '/v1/dm/send', { to: bId, text: 'still here?' })).s === 403);
check('and for the blocked side', (await call(B, '/v1/dm/send', { to: aId, text: 'hello?' })).s === 403);

check.done();
