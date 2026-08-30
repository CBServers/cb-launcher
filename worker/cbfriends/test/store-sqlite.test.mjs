// Exercises store-sqlite.mjs against the exact KV and DO-storage surface src/index.js uses,
// mirroring the semantics of the harness/serve-local Map shims plus real cursor pagination.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checks } from './harness.mjs';
import { openStore } from '../store-sqlite.mjs';

const check = checks();

let clock = 1_000_000_000;
const store = openStore(':memory:', { now: () => clock });
const kv = store.kv;

// --- KV basics ---
check('kv missing key is null', (await kv.get('nope')) === null);
await kv.put('acct:1', '{"a":1}');
check('kv round-trips a value', (await kv.get('acct:1')) === '{"a":1}');
await kv.put('acct:1', 'v2');
check('kv put overwrites', (await kv.get('acct:1')) === 'v2');
await kv.delete('acct:1');
check('kv delete removes', (await kv.get('acct:1')) === null);

// --- expirationTtl ---
await kv.put('sess:tok', 'user1', { expirationTtl: 3600 });
check('kv ttl key readable before expiry', (await kv.get('sess:tok')) === 'user1');
clock += 3600 * 1000 + 1;
check('kv ttl key expires', (await kv.get('sess:tok')) === null);
await kv.put('sess:tok2', 'user2', { expirationTtl: 3600 });
await kv.put('sess:tok2', 'user2');
clock += 3600 * 1000 + 1;
check('kv re-put without ttl clears expiry', (await kv.get('sess:tok2')) === 'user2');

// --- list: prefix, expiry filtering, cursor pagination ---
for (let i = 0; i < 25; i++) await kv.put(`report:${String(i).padStart(3, '0')}`, 'r');
await kv.put('other:x', 'o');
await kv.put('report:expired', 'r', { expirationTtl: 1 });
clock += 2000;

let page = await kv.list({ prefix: 'report:' });
check('kv list honours prefix', page.keys.length === 25 && page.keys.every(k => k.name.startsWith('report:')));
check('kv list excludes expired keys', !page.keys.some(k => k.name === 'report:expired'));
check('kv list complete page has no cursor', page.list_complete === true && page.cursor === undefined);

const names = [];
let cursor;
do {
    page = await kv.list({ prefix: 'report:', cursor, limit: 10 });
    names.push(...page.keys.map(k => k.name));
    check('kv list page shape matches CF', page.list_complete === (page.cursor === undefined));
    cursor = page.list_complete ? undefined : page.cursor;
} while (cursor);
check('kv cursor pagination covers all keys once',
    names.length === 25 && new Set(names).size === 25 && names.join() === [...names].sort().join());

// --- DO storage ---
const ds = store.doStorage('do:chat:room1:');
check('do get missing is undefined', (await ds.get('seq')) === undefined);
await ds.put('seq', 5);
check('do round-trips json', (await ds.get('seq')) === 5);
await ds.put({ 'msg:000000000001': { id: 1, text: 'a' }, 'msg:000000000002': { id: 2, text: 'b' }, seq: 2 });
check('do multi-put lands all entries', (await ds.get('seq')) === 2 && (await ds.get('msg:000000000002')).text === 'b');

const ds2 = store.doStorage('do:chat:room2:');
check('do instances are namespaced', (await ds2.get('seq')) === undefined);

for (let i = 3; i <= 8; i++) await ds.put(`msg:${String(i).padStart(12, '0')}`, { id: i });
const fwd = await ds.list({ prefix: 'msg:' });
check('do list strips instance prefix', [...fwd.keys()].every(k => k.startsWith('msg:')));
check('do list sorted ascending', [...fwd.values()].map(m => m.id).join() === '1,2,3,4,5,6,7,8');
const rev = await ds.list({ prefix: 'msg:', limit: 3, reverse: true });
check('do list reverse+limit takes newest', [...rev.values()].map(m => m.id).join() === '8,7,6');
const older = await ds.list({ prefix: 'msg:', end: 'msg:' + String(5).padStart(12, '0'), limit: 2, reverse: true });
check('do list end is exclusive, reverse walks back', [...older.values()].map(m => m.id).join() === '4,3');
const from = await ds.list({ prefix: 'msg:', start: 'msg:' + String(6).padStart(12, '0') });
check('do list start is inclusive', [...from.values()].map(m => m.id).join() === '6,7,8');

await ds.delete(['msg:000000000001', 'msg:000000000002']);
await ds.delete('seq');
check('do delete takes array or single', (await ds.get('msg:000000000001')) === undefined && (await ds.get('seq')) === undefined);

// --- KV and DO keys share one table without collisions ---
check('kv list does not see do keys', (await kv.list({ prefix: 'do:' })).keys.length === 0
    || !(await kv.list({ prefix: 'report:' })).keys.some(k => k.name.startsWith('do:')));

// --- sweep physically deletes, not just filters ---
await kv.put('sess:sweepme', 'x', { expirationTtl: 1 });
clock += 2000;
store.sweepExpired();
clock -= 2000;
check('sweep deletes expired rows', (await kv.get('sess:sweepme')) === null);
clock += 2000;
store.close();

// --- persistence across reopen ---
const dir = mkdtempSync(join(tmpdir(), 'cbfriends-sqlite-'));
const file = join(dir, 'test.db');
{
    const s = openStore(file);
    await s.kv.put('acct:persist', 'yes');
    await s.doStorage('do:graph:u1:').put('edges', { friends: ['u2'] });
    s.close();
}
{
    const s = openStore(file);
    check('kv survives reopen', (await s.kv.get('acct:persist')) === 'yes');
    const edges = await s.doStorage('do:graph:u1:').get('edges');
    check('do storage survives reopen', edges && edges.friends[0] === 'u2');
    s.close();
}
rmSync(dir, { recursive: true, force: true });

check.done();
