// The steady-state poll loop is what drives KV spend, so pin its cost here. Growing the population
// must not grow the per-poll cost; a regression that reintroduces a per-friend or per-poster read
// shows up as a failure rather than as a bill.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

// Wraps the namespace so a suite can count exactly what one request costs.
let ops = null;
for (const name of ['get', 'put', 'delete', 'list']) {
    const inner = env.CB[name].bind(env.CB);
    env.CB[name] = async (...args) => {
        if (ops) ops[name]++;
        return inner(...args);
    };
}
const measure = async fn => {
    ops = { get: 0, put: 0, delete: 0, list: 0 };
    await fn();
    const seen = ops;
    ops = null;
    return seen;
};

const me = await mk();
await call(me, '/v1/account/bootstrap', { hwidHash: await sha256Hex('me'), handle: 'me' });

// Adds n friends who are online, and n strangers broadcasting on the board.
let made = 0;
async function grow(n) {
    for (let i = 0; i < n; i++, made++) {
        const friend = await mk();
        await call(friend, '/v1/account/bootstrap', { hwidHash: await sha256Hex('f' + made), handle: 'friend' + made });
        await call(friend, '/v1/friends/add', { handle: 'me' });
        const incoming = (await call(me, '/v1/friends/list')).b.incoming;
        await call(me, '/v1/friends/accept', { cbId: incoming[incoming.length - 1].cbId });
        await call(friend, '/v1/presence', { game: 'boiii' });

        const poster = await mk();
        await call(poster, '/v1/account/bootstrap', { hwidHash: await sha256Hex('p' + made), handle: 'poster' + made });
        await call(poster, '/v1/presence', { game: 'boiii' });
        await call(poster, '/v1/lfg/post', { game: 'boiii', note: 'lobby ' + made, slots: 4 });
    }
}

// The four calls the launcher makes on every five-second tick.
const cycle = () => measure(async () => {
    await call(me, '/v1/friends/list');
    await call(me, '/v1/invite/poll');
    await call(me, '/v1/lfg/list', { game: 'boiii' });
    await call(me, '/v1/chat/poll', { room: 'boiii', after: 0 });
});

await grow(5);
const small = await cycle();
await grow(25);
const large = await cycle();

const friends = (await call(me, '/v1/friends/list')).b.friends.length;
const posts = (await call(me, '/v1/lfg/list', { game: 'boiii' })).b.posts.length;
console.log(`  ${friends} friends, ${posts} posts on the board`);
console.log(`  poll cycle at 5:  ${small.get} gets, ${small.list} lists, ${small.put} puts`);
console.log(`  poll cycle at 30: ${large.get} gets, ${large.list} lists, ${large.put} puts`);

check('the population actually grew', friends === 30 && posts === 30);
check(`poll cost does not grow with the population (${small.get} -> ${large.get} gets)`, large.get === small.get);
check('a poll cycle never scans the namespace', small.list === 0 && large.list === 0);
check('polling writes nothing to KV', large.put === 0 && large.delete === 0);

// Each endpoint resolves the caller's device key; that lookup is the floor, and nothing sits on top
// of it except the invite mailbox, which is a single key.
check(`four polled endpoints cost five reads in total (${large.get})`, large.get === 5);

const beat = await measure(() => call(me, '/v1/presence', { game: 'boiii' }));
check(`presence no longer writes to KV (${beat.put} puts)`, beat.put === 0);

check.done();
