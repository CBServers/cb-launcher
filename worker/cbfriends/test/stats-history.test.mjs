// History behind the public dashboard: sightings become daily uniques, samples become series and
// peaks, hours fold into rollups, and the read endpoints stay public, cached and shaped for charts.
import { makeEnv, makeClient, mk, sha256Hex, checks, worker } from './harness.mjs';
import { openStats, DAY, HOUR, RANGES } from '../stats-sqlite.mjs';

const check = checks();

// ---- Binding, driven directly with scripted time ----
{
    const st = openStats(':memory:', { salt: 'a' });
    const T0 = 1_800_000_000 - (1_800_000_000 % DAY) + 12 * HOUR; // noon UTC on some day
    const live = (online, games) => ({ online, launcher: games });

    st.sample(T0, live(5, { boiii: 2, t6: 1 }), { boiii: { players: 40, servers: 9 }, t6: { players: 10, servers: 3 } });
    let s = st.summary(T0 + 30);
    check('a sample records the total', s.latest.online === 5);
    check('idle is what is left after the games', s.latest.idle === 2);
    check('per-game counts are kept', s.latest.games.boiii === 2 && s.latest.games.t6 === 1);
    check('server players are summed into a total', s.servers.players === 50 && s.servers.servers === 12);
    check('tracking starts at the first sample', s.since === T0);
    check('the first sample is the all-time peak', s.peakAll.n === 5 && s.peakAll.ts === T0);

    st.sample(T0 + 60, live(9, { boiii: 9 }), null);
    st.sample(T0 + 120, live(3, {}), null);
    s = st.summary(T0 + 150);
    check('peaks move up but never down', s.peakAll.n === 9 && s.peak24h.n === 9);
    check('a game peak is tracked too', s.gamePeaks.boiii.n === 9);
    check('an unknown servers feed leaves the last server sample in place', s.servers.players === 50);
    check('latest reflects the newest sample', s.latest.online === 3 && s.latest.idle === 3);

    const ser = st.series(T0 + 150, '6h');
    check('series is columnar with one t per bucket', ser.t.length === ser.online.length && ser.bucket === 60);
    const i0 = ser.t.indexOf(T0);
    check('series carries the samples at their minute', i0 >= 0 && ser.online[i0] === 5 && ser.idle[i0] === 2);
    check('per-game series exist for every game seen', ser.games.boiii[i0] === 2 && ser.games.t6[i0] === 1);
    check('a game absent from a minute is zero, not null', ser.games.t6[i0 + 1] === 0);
    check('minutes with no sample are null', ser.online[i0 - 1] === null);
    check('server series ride alongside', ser.servers.players[i0] === 50 && ser.servers.games.boiii.servers[i0] === 9);
    check('an unknown range falls back to 24h', st.series(T0, 'bogus').range === '24h');

    // Coarser buckets average over the minutes actually sampled, so a game present for one minute of
    // a two-minute bucket reads as half.
    const ser2 = st.series(T0 + 150, '24h');
    const j = ser2.t.indexOf(T0);
    check('bucket averages weight by sample count', ser2.online[j] === 7 && ser2.games.t6[j] === 0.5);

    // Sightings: one row per launcher per game per day, hashed, with first-seen tracking.
    st.seen(T0, 'boiii', 'fpr-A');
    st.seen(T0 + 30, 'boiii', 'fpr-A');
    st.seen(T0 + 60, 't6', 'fpr-A');
    st.seen(T0, '', 'fpr-B');
    let u = st.summary(T0 + 100).today;
    check('two launchers today', u.dau === 2 && u.partial === true);
    check('both are new today', u.new === 2);
    check('per-game uniques count a launcher once per game', u.games.boiii === 1 && u.games.t6 === 1);
    check('idle sightings count toward dau but not any game', Object.keys(u.games).length === 2);

    // Next day: A returns, C is new, B is gone. Daily row for day 0 must be computed on rollover.
    const T1 = T0 + DAY;
    st.seen(T1, 'boiii', 'fpr-A');
    st.seen(T1, 'boiii', 'fpr-C');
    st.sample(T1, live(2, { boiii: 2 }), null);
    const un = st.uniques(T1 + 10, '30d');
    check('yesterday was rolled into a daily row', un.days.length === 2 && un.days[0].dau === 2 && !un.days[0].partial);
    check('today is live and partial', un.days[1].dau === 2 && un.days[1].partial === true);
    check('only C is new today', un.days[1].new === 1);
    check('wau spans both days', un.days[1].wau === 3 && un.days[1].mau === 3);
    check('day labels are ISO dates', /^\d{4}-\d{2}-\d{2}$/.test(un.days[0].day));
    check('summary exposes yesterday', st.summary(T1 + 10).yesterday.dau === 2);

    // Hour folding: the hours between T0 and T1 are complete and land in the rollup.
    const all = st.series(T1 + 10, 'all');
    const d0 = all.t.indexOf(Math.floor(T0 / DAY) * DAY);
    check('the all range buckets by day', all.bucket === DAY && d0 >= 0);
    check('a day bucket averages the hours that had samples', Math.abs(all.online[d0] - (5 + 9 + 3) / 3) < 0.11);
    const m = st.series(T1 + 10, '30d');
    const h1 = m.t.indexOf(Math.floor(T1 / HOUR) * HOUR);
    check('the current unfolded hour is still present in hourly ranges', h1 >= 0 && m.online[h1] === 2);

    // Raw rows are pruned after the retention window while rollups and daily rows survive.
    const T40 = T0 + 40 * DAY;
    st.sample(T40, live(1, {}), null);
    const late = st.series(T40 + 10, 'all');
    check('old samples survive as rollups', late.online[late.t.indexOf(Math.floor(T0 / DAY) * DAY)] > 0);
    check('daily rows survive too', st.uniques(T40, 'all').days[0].dau === 2);
    check('the peak survives the prune', st.summary(T40).peakAll.n === 9);
    check('the 24h peak is only the last day', st.summary(T40 + 10).peak24h.n === 1);
    st.close();
}

// Two stores with different salts hash the same launcher differently, so the file is not linkable.
{
    const a = openStats(':memory:', { salt: 'one' });
    const b = openStats(':memory:', { salt: 'two' });
    const T = 1_800_000_000;
    a.seen(T, 'boiii', 'fpr-X'); b.seen(T, 'boiii', 'fpr-X');
    check('a salt is required', (() => { try { openStats(':memory:'); return false; } catch { return true; } })());
    check('sightings dedupe in memory and on disk', (a.seen(T, 'boiii', 'fpr-X'), a.summary(T).today.dau === 1));
    a.close(); b.close();
}

// ---- Through the worker ----
const { env } = makeEnv();
const call = makeClient(env);

async function get(path) {
    const res = await worker.fetch(new Request('https://x' + path, { method: 'GET', headers: { 'CF-Connecting-IP': '1.2.3.4' } }), env);
    return { s: res.status, h: res.headers, b: await res.json() };
}

const anon = await mk();
await call(anon, '/v1/pulse', { game: 'boiii' });
const idleOne = await mk();
await call(idleOne, '/v1/pulse', {});
const A = await mk();
await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'alpha' });
await call(A, '/v1/presence', { game: 't6' });

const live = await get('/v1/stats');
check('/v1/stats keeps its original fields', live.b.online === 3 && live.b.launcher.boiii === 1 && live.b.launcher.t6 === 1);
check('/v1/stats now reports idle launchers', live.b.idle === 1);
check('/v1/stats mirrors launcher as games', JSON.stringify(live.b.games) === JSON.stringify(live.b.launcher));

// The servers worker is fetched by the tick; stub it.
const realFetch = globalThis.fetch;
env.SERVERS_URL = 'http://servers.test/v1/player-counts';
let serversHits = 0;
globalThis.fetch = async url => {
    if (String(url) === env.SERVERS_URL) {
        serversHits++;
        return { ok: true, json: async () => ({ games: { boiii: { players: 12, servers: 4 } }, fetchedAt: 'x' }) };
    }
    return realFetch(url);
};
await worker.scheduled({ scheduledTime: Date.now() }, env);
globalThis.fetch = realFetch;
check('the tick fetched the servers feed', serversHits === 1);

const summary = await get('/v1/stats/summary');
check('summary is public with CORS', summary.s === 200 && summary.h.get('Access-Control-Allow-Origin') === '*');
check('summary carries the live numbers', summary.b.online === 3 && summary.b.idle === 1 && summary.b.games.boiii === 1);
check('summary carries the sampled history', summary.b.latest.online === 3 && summary.b.peakAll.n === 3);
check('summary carries the server sample', summary.b.servers.players === 12 && summary.b.servers.games.boiii.servers === 4);
check('pulses and beats were sighted', summary.b.today.dau === 3 && summary.b.today.games.boiii === 1 && summary.b.today.games.t6 === 1);
check('a goodbye is not a sighting', (await call(anon, '/v1/pulse', { bye: true })).s === 200 && (await get('/v1/stats/summary')).b.today.dau === 3);

const series = await get('/v1/stats/series?range=6h');
check('series is served with a cache header', series.s === 200 && /max-age=60/.test(series.h.get('Cache-Control')));
check('series holds the tick', series.b.online[series.b.online.length - 1] === 3);
check('series ranges are the documented set', Object.keys(RANGES).every(r => r.length));

const uniques = await get('/v1/stats/uniques');
check('uniques defaults to 30d', uniques.s === 200 && uniques.b.range === '30d' && uniques.b.days.length === 1);
check('an unknown history path is 404', (await get('/v1/stats/nope')).s === 404);
check('history is GET only', (await worker.fetch(new Request('https://x/v1/stats/series', { method: 'POST', body: '{}' }), env)).status === 405);

// A worker with no STATS binding (wrangler) still serves the live count and refuses history cleanly.
const bare = makeEnv().env;
delete bare.STATS;
const bareLive = await worker.fetch(new Request('https://x/v1/stats', { method: 'GET' }), bare);
check('without history the live count still works', bareLive.status === 200);
const bareHist = await worker.fetch(new Request('https://x/v1/stats/summary', { method: 'GET' }), bare);
check('without history the dashboard endpoints 404', bareHist.status === 404);
const anon2 = await mk();
check('pulses still work without history', (await call(anon2, '/v1/pulse', { game: 'boiii' })).s === 200);
await worker.scheduled({ scheduledTime: Date.now() }, bare);
check('the tick is a no-op without history', true);

// Per-IP rate limit on the read side.
let limited = false;
for (let i = 0; i < 70; i++) {
    const r = await worker.fetch(new Request('https://x/v1/stats/summary', { method: 'GET', headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env);
    if (r.status === 429) { limited = true; break; }
}
check('history reads are rate limited per IP', limited);
check.done();
