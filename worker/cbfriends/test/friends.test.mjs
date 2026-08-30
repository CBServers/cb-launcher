// The friend graph, presence propagation and the LFG board seen through two and three identities.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk(), C = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('mA'), handle: 'divity', displayName: 'Divity' });
await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('mB'), handle: 'bravo', displayName: 'Bravo' });
await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('mC'), handle: 'charlie', displayName: 'Charlie' });

const add = await call(A, '/v1/friends/add', { handle: 'bravo' });
check('add by handle -> requested', add.s === 200 && add.b.status === 'requested');

let bList = await call(B, '/v1/friends/list');
check('B sees incoming request from A', bList.b.incoming.some(p => p.handle === 'divity'));
let aList = await call(A, '/v1/friends/list');
check('A sees outgoing request to B', aList.b.outgoing.some(p => p.handle === 'bravo'));

const aCbId = bList.b.incoming.find(p => p.handle === 'divity').cbId;
const acc = await call(B, '/v1/friends/accept', { cbId: aCbId });
check('accept -> friends', acc.s === 200 && acc.b.status === 'friends');

aList = await call(A, '/v1/friends/list');
bList = await call(B, '/v1/friends/list');
check('A and B are now friends (both sides)',
    aList.b.friends.some(p => p.handle === 'bravo') && bList.b.friends.some(p => p.handle === 'divity'));
check('no dangling requests after accept',
    aList.b.outgoing.length === 0 && bList.b.incoming.length === 0);

await call(B, '/v1/presence', { game: 'boiii', mode: 'zm' });
aList = await call(A, '/v1/friends/list');
const bAsFriend = aList.b.friends.find(p => p.handle === 'bravo');
check('friend presence shows online + game', bAsFriend && bAsFriend.online === true && bAsFriend.game === 'boiii');

await call(B, '/v1/lfg/post', { game: 'boiii', mode: 'zm', note: 'need 2 for EE' });
let lfg = await call(A, '/v1/lfg/list', { game: 'boiii' });
const bPost = lfg.b.posts.find(p => p.handle === 'bravo');
check('LFG list shows post with note + friend relation', bPost && bPost.note === 'need 2 for EE' && bPost.relation === 'friend');

await call(A, '/v1/lfg/post', { game: 'boiii', note: 'my own lobby', slots: 2 });
const mine = await call(A, '/v1/lfg/list', { game: 'boiii' });
const selfPost = mine.b.posts.find(p => p.relation === 'self');
check('own broadcast appears in the list tagged self', !!selfPost && selfPost.note === 'my own lobby');
check('others still see it as a normal post', (await call(B, '/v1/lfg/list', { game: 'boiii' }))
    .b.posts.some(p => p.handle === 'divity' && p.relation !== 'self'));
await call(A, '/v1/lfg/clear', {});

await call(C, '/v1/lfg/post', { game: 'boiii' });
lfg = await call(A, '/v1/lfg/list', { game: 'boiii' });
check('non-friend LFG poster shows relation none',
    (lfg.b.posts.find(p => p.handle === 'charlie') || {}).relation === 'none');

lfg = await call(A, '/v1/lfg/list', { game: 'mw2' });
check('LFG game filter excludes other games', !lfg.b.posts.some(p => p.handle === 'bravo'));

// A already requested C, so C adding A back completes the pair instead of queuing a request.
await call(A, '/v1/friends/add', { handle: 'charlie' });
const mutual = await call(C, '/v1/friends/add', { handle: 'divity' });
check('mutual add auto-accepts to friends', mutual.s === 200 && mutual.b.status === 'friends');

await call(B, '/v1/friends/add', { handle: 'charlie' });
let cList = await call(C, '/v1/friends/list');
await call(C, '/v1/friends/decline', { cbId: cList.b.incoming.find(p => p.handle === 'bravo').cbId });
cList = await call(C, '/v1/friends/list');
bList = await call(B, '/v1/friends/list');
check('decline clears request both sides',
    !cList.b.incoming.some(p => p.handle === 'bravo') && !bList.b.outgoing.some(p => p.handle === 'charlie'));

await call(A, '/v1/friends/remove', { cbId: bAsFriend.cbId });
aList = await call(A, '/v1/friends/list');
bList = await call(B, '/v1/friends/list');
check('remove drops friend both sides',
    !aList.b.friends.some(p => p.handle === 'bravo') && !bList.b.friends.some(p => p.handle === 'divity'));

check('device key with no account is 401 on friends/list', (await call(await mk(), '/v1/friends/list')).s === 401);

check.done();

// The board has to name who joined, not just count them.
await call(B, '/v1/lfg/post', { game: 'boiii', mode: 'zm', note: 'ee run', slots: 3 });
await call(C, '/v1/lfg/join', { cbId: (await call(A, '/v1/lfg/list', { game: 'boiii' }))
    .b.posts.find(p => p.handle === 'bravo').cbId });
const board = await call(A, '/v1/lfg/list', { game: 'boiii' });
const joined = board.b.posts.find(p => p.handle === 'bravo');
check('post reports who joined, not just how many',
      joined.joined === 1 && (joined.joiners || []).some(j => j.handle === 'charlie'));
check('joiner carries enough to draw a row',
      (joined.joiners[0].displayName || joined.joiners[0].handle) !== '' && 'avatarUrl' in joined.joiners[0]);
check('joiner sees their own post membership',
      (await call(C, '/v1/lfg/list', { game: 'boiii' })).b.posts.find(p => p.handle === 'bravo').iJoined === true);
check('a non-joiner does not', joined.iJoined === false);

// One seat at a time: joining elsewhere, leaving, or quitting all release the previous group.
await call(A, '/v1/lfg/post', { game: 'boiii', note: 'second lobby' });
await call(C, '/v1/lfg/join', { cbId: (await call(C, '/v1/lfg/list', { game: 'boiii' }))
    .b.posts.find(p => p.handle === 'divity').cbId });
const after = (await call(A, '/v1/lfg/list', { game: 'boiii' })).b.posts;
check('joining another group vacates the first',
      !(after.find(p => p.handle === 'bravo').joiners || []).some(j => j.handle === 'charlie'));
check('and seats them in the new one',
      (after.find(p => p.handle === 'divity').joiners || []).some(j => j.handle === 'charlie'));

check('leave releases the seat', (await call(C, '/v1/lfg/leave', {})).b.ok === true);
check('and the board shows it', !(await call(A, '/v1/lfg/list', { game: 'boiii' }))
    .b.posts.some(p => (p.joiners || []).some(j => j.handle === 'charlie')));
check('leaving nothing is not an error', (await call(C, '/v1/lfg/leave', {})).b.ok === false);
