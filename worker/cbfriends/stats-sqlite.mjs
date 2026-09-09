// SQLite history behind the STATS binding: per-minute launcher and server-player samples, hourly
// rollups, and hashed daily sightings for unique-launcher counts. Owned by serve.mjs; the worker
// only calls seen()/sample() on the write side and series()/summary()/uniques() on the read side.
// Every method takes explicit unix-second times so suites can script days without a clock.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export const DAY = 86400;
export const HOUR = 3600;
export const TOTAL = '*';      // pseudo-game row carrying the sum, so totals need no aggregation
export const IDLE = '';        // launcher open with no game running
const RAW_KEEP = 35 * DAY;     // one-minute samples and hashed sightings; hourly and daily rows are forever
const HASH_BYTES = 16;

// Bucket widths keep every range at or under 720 points, like gameserve.rs. Ranges over a week read
// the hourly table, everything shorter reads the raw minutes.
export const RANGES = {
    '6h':  { window: 6 * HOUR,   bucket: 60,   hourly: false },
    '12h': { window: 12 * HOUR,  bucket: 60,   hourly: false },
    '24h': { window: DAY,        bucket: 120,  hourly: false },
    '48h': { window: 2 * DAY,    bucket: 240,  hourly: false },
    '7d':  { window: 7 * DAY,    bucket: 900,  hourly: false },
    '30d': { window: 30 * DAY,   bucket: HOUR, hourly: true },
    'all': { window: 0,          bucket: DAY,  hourly: true },
};
export const UNIQUE_RANGES = { '30d': 30, '90d': 90, 'all': 0 };

export const dayOf = ts => Math.floor(ts / DAY);
export const dayIso = day => new Date(day * DAY * 1000).toISOString().slice(0, 10);

export function openStats(path, { salt } = {}) {
    if (!salt) throw new Error('openStats needs a salt');
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS samples (ts INTEGER, game TEXT, n INTEGER, PRIMARY KEY (ts, game)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS svr_samples (ts INTEGER, game TEXT, players INTEGER, servers INTEGER,
            PRIMARY KEY (ts, game)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS hourly (ts INTEGER, game TEXT, avg REAL, peak INTEGER, PRIMARY KEY (ts, game)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS svr_hourly (ts INTEGER, game TEXT, players REAL, peak INTEGER, servers REAL,
            PRIMARY KEY (ts, game)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS sightings (day INTEGER, game TEXT, hash BLOB, PRIMARY KEY (day, game, hash)) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS first_seen (hash BLOB PRIMARY KEY, day INTEGER) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS first_seen_day ON first_seen (day);
        CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, dau INTEGER, wau INTEGER, mau INTEGER,
            new_launchers INTEGER, games TEXT);
        CREATE TABLE IF NOT EXISTS peaks (key TEXT PRIMARY KEY, n INTEGER, ts INTEGER);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER);
    `);

    const stmt = {
        sample: db.prepare('INSERT OR REPLACE INTO samples (ts, game, n) VALUES (?, ?, ?)'),
        svrSample: db.prepare('INSERT OR REPLACE INTO svr_samples (ts, game, players, servers) VALUES (?, ?, ?, ?)'),
        peak: db.prepare('INSERT INTO peaks (key, n, ts) VALUES (?, ?, ?) ' +
                         'ON CONFLICT (key) DO UPDATE SET n = excluded.n, ts = excluded.ts WHERE excluded.n > peaks.n'),
        getPeak: db.prepare('SELECT n, ts FROM peaks WHERE key = ?'),
        gamePeaks: db.prepare("SELECT key, n, ts FROM peaks WHERE key LIKE 'game:%'"),
        metaGet: db.prepare('SELECT value FROM meta WHERE key = ?'),
        metaSet: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
        metaInit: db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)'),
        sighting: db.prepare('INSERT OR IGNORE INTO sightings (day, game, hash) VALUES (?, ?, ?)'),
        firstSeen: db.prepare('INSERT OR IGNORE INTO first_seen (hash, day) VALUES (?, ?)'),
        foldHour: db.prepare(
            'INSERT OR REPLACE INTO hourly (ts, game, avg, peak) ' +
            'SELECT ?1, game, SUM(n) * 1.0 / (SELECT COUNT(*) FROM samples WHERE game = ? AND ts >= ?1 AND ts < ?1 + 3600), MAX(n) ' +
            'FROM samples WHERE ts >= ?1 AND ts < ?1 + 3600 GROUP BY game'),
        foldSvrHour: db.prepare(
            'INSERT OR REPLACE INTO svr_hourly (ts, game, players, peak, servers) ' +
            'SELECT ?1, game, SUM(players) * 1.0 / (SELECT COUNT(*) FROM svr_samples WHERE game = ? AND ts >= ?1 AND ts < ?1 + 3600), ' +
            'MAX(players), SUM(servers) * 1.0 / (SELECT COUNT(*) FROM svr_samples WHERE game = ? AND ts >= ?1 AND ts < ?1 + 3600) ' +
            'FROM svr_samples WHERE ts >= ?1 AND ts < ?1 + 3600 GROUP BY game'),
        distinctDay: db.prepare('SELECT COUNT(DISTINCT hash) AS c FROM sightings WHERE day >= ? AND day <= ?'),
        distinctGames: db.prepare('SELECT game, COUNT(DISTINCT hash) AS c FROM sightings WHERE day = ? AND game <> ? GROUP BY game'),
        newOnDay: db.prepare('SELECT COUNT(*) AS c FROM first_seen WHERE day = ?'),
        daily: db.prepare('INSERT OR REPLACE INTO daily (day, dau, wau, mau, new_launchers, games) VALUES (?, ?, ?, ?, ?, ?)'),
        dailyRange: db.prepare('SELECT * FROM daily WHERE day >= ? ORDER BY day'),
        dailyOne: db.prepare('SELECT * FROM daily WHERE day = ?'),
        pruneSamples: db.prepare('DELETE FROM samples WHERE ts < ?'),
        pruneSvr: db.prepare('DELETE FROM svr_samples WHERE ts < ?'),
        pruneSightings: db.prepare('DELETE FROM sightings WHERE day < ?'),
        // Bucketed reads: per-(bucket, game) sums plus the number of samples per bucket, which is the
        // denominator so a game present for one minute of a fifteen-minute bucket averages honestly.
        bucketSamples: db.prepare('SELECT (CAST(ts / ?1 AS INTEGER)) * ?1 AS b, game, SUM(n) AS s FROM samples WHERE ts >= ?2 GROUP BY b, game'),
        bucketCount: db.prepare('SELECT (CAST(ts / ?1 AS INTEGER)) * ?1 AS b, COUNT(*) AS c FROM samples WHERE game = ?3 AND ts >= ?2 GROUP BY b'),
        bucketSvr: db.prepare('SELECT (CAST(ts / ?1 AS INTEGER)) * ?1 AS b, game, SUM(players) AS p, SUM(servers) AS s FROM svr_samples WHERE ts >= ?2 GROUP BY b, game'),
        bucketSvrCount: db.prepare('SELECT (CAST(ts / ?1 AS INTEGER)) * ?1 AS b, COUNT(*) AS c FROM svr_samples WHERE game = ?3 AND ts >= ?2 GROUP BY b'),
        hourlyRows: db.prepare('SELECT ts, game, avg FROM hourly WHERE ts >= ?'),
        svrHourlyRows: db.prepare('SELECT ts, game, players, servers FROM svr_hourly WHERE ts >= ?'),
        latestTs: db.prepare('SELECT MAX(ts) AS ts FROM samples'),
        latestRows: db.prepare('SELECT game, n FROM samples WHERE ts = ?'),
        latestSvrTs: db.prepare('SELECT MAX(ts) AS ts FROM svr_samples'),
        latestSvrRows: db.prepare('SELECT game, players, servers FROM svr_samples WHERE ts = ?'),
        peak24: db.prepare('SELECT n, ts FROM samples WHERE game = ? AND ts >= ? ORDER BY n DESC, ts ASC LIMIT 1'),
        svrPeak24: db.prepare('SELECT players AS n, ts FROM svr_samples WHERE game = ? AND ts >= ? ORDER BY players DESC, ts ASC LIMIT 1'),
    };

    const meta = key => { const r = stmt.metaGet.get(key); return r ? r.value : null; };
    const hashOf = fpr => createHash('sha256').update(salt).update(String(fpr)).digest().subarray(0, HASH_BYTES);

    function tx(fn) {
        db.exec('BEGIN');
        try { fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    }

    // Sightings are deduped in memory per day so a launcher pulsing every 30s costs one insert a day.
    let seenDay = -1;
    let seenSet = new Set();

    function seen(ts, game, fpr) {
        if (!fpr) return;
        const day = dayOf(ts);
        if (day !== seenDay) { seenDay = day; seenSet = new Set(); }
        const key = `${game}|${fpr}`;
        if (seenSet.has(key)) return;
        seenSet.add(key);
        const hash = hashOf(fpr);
        stmt.sighting.run(day, game || IDLE, hash);
        stmt.firstSeen.run(hash, day);
    }

    // Folds every complete hour since the last fold, computes finished days, prunes raw rows.
    function maintain(ts) {
        const hour = Math.floor(ts / HOUR) * HOUR;
        let folded = meta('folded_hour');
        if (folded === null) folded = hour;
        for (let h = folded; h < hour; h += HOUR) {
            stmt.foldHour.run(h, TOTAL);
            stmt.foldSvrHour.run(h, TOTAL, TOTAL);
        }
        stmt.metaSet.run('folded_hour', hour);

        const today = dayOf(ts);
        let done = meta('daily_done');
        if (done === null) { done = today - 1; stmt.metaSet.run('daily_done', done); }
        for (let d = done + 1; d < today; d++) computeDaily(d);
        if (done < today - 1) {
            stmt.metaSet.run('daily_done', today - 1);
            stmt.pruneSamples.run(ts - RAW_KEEP);
            stmt.pruneSvr.run(ts - RAW_KEEP);
            stmt.pruneSightings.run(today - RAW_KEEP / DAY);
        }
    }

    function uniquesFor(day) {
        const games = {};
        for (const r of stmt.distinctGames.all(day, IDLE)) games[r.game] = r.c;
        return {
            dau: stmt.distinctDay.get(day, day).c,
            wau: stmt.distinctDay.get(day - 6, day).c,
            mau: stmt.distinctDay.get(day - 29, day).c,
            new: stmt.newOnDay.get(day).c,
            games,
        };
    }

    function computeDaily(day) {
        const u = uniquesFor(day);
        stmt.daily.run(day, u.dau, u.wau, u.mau, u.new, JSON.stringify(u.games));
    }

    // One tick of history. `launcher` is Directory.stats() ({ online, launcher: {game: n} }); `servers`
    // is the servers worker's `games` map ({ game: { players, servers } }) or null when unknown.
    function sample(ts, launcher, servers) {
        ts = Math.floor(ts / 60) * 60;
        const games = (launcher && launcher.launcher) || {};
        const online = Math.max(0, (launcher && launcher.online) || 0);
        const inGame = Object.values(games).reduce((a, b) => a + b, 0);
        tx(() => {
            stmt.metaInit.run('since', ts);
            stmt.sample.run(ts, TOTAL, online);
            stmt.sample.run(ts, IDLE, Math.max(0, online - inGame));
            stmt.peak.run('online', online, ts);
            for (const [game, n] of Object.entries(games)) {
                if (game === TOTAL || game === IDLE) continue;
                stmt.sample.run(ts, game, n);
                stmt.peak.run(`game:${game}`, n, ts);
            }
            if (servers && typeof servers === 'object') {
                let players = 0, count = 0;
                for (const [game, v] of Object.entries(servers)) {
                    if (game === TOTAL || !v || typeof v !== 'object') continue;
                    const p = Math.max(0, Math.trunc(v.players) || 0);
                    const s = Math.max(0, Math.trunc(v.servers) || 0);
                    players += p; count += s;
                    stmt.svrSample.run(ts, game, p, s);
                    stmt.peak.run(`svr:game:${game}`, p, ts);
                }
                stmt.svrSample.run(ts, TOTAL, players, count);
                stmt.peak.run('svr:players', players, ts);
                stmt.peak.run('svr:servers', count, ts);
            }
            maintain(ts);
        });
    }

    // Hourly rows for ts >= from, with the not-yet-folded tail computed from raw samples so the
    // latest hour is never missing.
    function hourlyFrom(from) {
        const folded = meta('folded_hour') || 0;
        const rows = stmt.hourlyRows.all(from).map(r => ({ b: r.ts, game: r.game, s: r.avg }));
        const tail = Math.max(from, folded);
        const counts = new Map(stmt.bucketCount.all(HOUR, tail, TOTAL).map(r => [r.b, r.c]));
        for (const r of stmt.bucketSamples.all(HOUR, tail)) {
            if (counts.get(r.b)) rows.push({ b: r.b, game: r.game, s: r.s / counts.get(r.b) });
        }
        return rows;
    }

    function svrHourlyFrom(from) {
        const folded = meta('folded_hour') || 0;
        const rows = stmt.svrHourlyRows.all(from).map(r => ({ b: r.ts, game: r.game, p: r.players, s: r.servers }));
        const tail = Math.max(from, folded);
        const counts = new Map(stmt.bucketSvrCount.all(HOUR, tail, TOTAL).map(r => [r.b, r.c]));
        for (const r of stmt.bucketSvr.all(HOUR, tail)) {
            const c = counts.get(r.b);
            if (c) rows.push({ b: r.b, game: r.game, p: r.p / c, s: r.s / c });
        }
        return rows;
    }

    // Groups rows already carrying values into `bucket`-wide averages weighted by the TOTAL row count.
    function regroup(rows, bucket, fields) {
        const acc = new Map();
        const cnt = new Map();
        for (const r of rows) {
            const b = Math.floor(r.b / bucket) * bucket;
            if (r.game === TOTAL) cnt.set(b, (cnt.get(b) || 0) + 1);
            let g = acc.get(b);
            if (!g) { g = new Map(); acc.set(b, g); }
            let v = g.get(r.game);
            if (!v) { v = {}; for (const f of fields) v[f] = 0; g.set(r.game, v); }
            for (const f of fields) v[f] += r[f];
        }
        return { acc, cnt };
    }

    // Columnar series: `t` plus one array per metric, null where no sample landed in a bucket.
    function series(now, range) {
        const def = RANGES[range] || RANGES['24h'];
        const bucket = def.bucket;
        const since = meta('since');
        const to = Math.floor(now / bucket) * bucket;
        let from;
        if (def.window) from = Math.floor((now - def.window) / bucket) * bucket;
        else from = since === null ? to : Math.floor(since / bucket) * bucket;

        let launcher, servers;
        if (def.hourly) {
            launcher = regroup(hourlyFrom(from), bucket, ['s']);
            servers = regroup(svrHourlyFrom(from), bucket, ['p', 's']);
        } else {
            const rows = stmt.bucketSamples.all(bucket, from);
            launcher = { acc: new Map(), cnt: new Map(stmt.bucketCount.all(bucket, from, TOTAL).map(r => [r.b, r.c])) };
            for (const r of rows) {
                let g = launcher.acc.get(r.b);
                if (!g) { g = new Map(); launcher.acc.set(r.b, g); }
                g.set(r.game, { s: r.s });
            }
            servers = { acc: new Map(), cnt: new Map(stmt.bucketSvrCount.all(bucket, from, TOTAL).map(r => [r.b, r.c])) };
            for (const r of stmt.bucketSvr.all(bucket, from)) {
                let g = servers.acc.get(r.b);
                if (!g) { g = new Map(); servers.acc.set(r.b, g); }
                g.set(r.game, { p: r.p, s: r.s });
            }
        }

        const gameSet = new Set();
        for (const g of launcher.acc.values()) for (const k of g.keys()) if (k !== TOTAL && k !== IDLE) gameSet.add(k);
        const svrSet = new Set();
        for (const g of servers.acc.values()) for (const k of g.keys()) if (k !== TOTAL) svrSet.add(k);

        const t = [], online = [], idle = [];
        const games = Object.fromEntries([...gameSet].map(k => [k, []]));
        const svrPlayers = [], svrServers = [];
        const svrGames = Object.fromEntries([...svrSet].map(k => [k, { players: [], servers: [] }]));
        const round = x => Math.round(x * 10) / 10;

        for (let b = from; b <= to; b += bucket) {
            t.push(b);
            const lc = launcher.cnt.get(b);
            const lg = launcher.acc.get(b);
            if (lc && lg) {
                const val = k => { const v = lg.get(k); return v ? round(v.s / lc) : 0; };
                online.push(val(TOTAL));
                idle.push(val(IDLE));
                for (const k of gameSet) games[k].push(val(k));
            } else {
                online.push(null); idle.push(null);
                for (const k of gameSet) games[k].push(null);
            }
            const sc = servers.cnt.get(b);
            const sg = servers.acc.get(b);
            if (sc && sg) {
                const val = k => sg.get(k) || { p: 0, s: 0 };
                svrPlayers.push(round(val(TOTAL).p / sc));
                svrServers.push(round(val(TOTAL).s / sc));
                for (const k of svrSet) {
                    svrGames[k].players.push(round(val(k).p / sc));
                    svrGames[k].servers.push(round(val(k).s / sc));
                }
            } else {
                svrPlayers.push(null); svrServers.push(null);
                for (const k of svrSet) { svrGames[k].players.push(null); svrGames[k].servers.push(null); }
            }
        }

        return {
            range: RANGES[range] ? range : '24h', bucket, from, to, t, online, idle, games,
            servers: { players: svrPlayers, servers: svrServers, games: svrGames },
        };
    }

    function latest() {
        const ts = stmt.latestTs.get().ts;
        if (ts === null) return null;
        const out = { ts, online: 0, idle: 0, games: {} };
        for (const r of stmt.latestRows.all(ts)) {
            if (r.game === TOTAL) out.online = r.n;
            else if (r.game === IDLE) out.idle = r.n;
            else out.games[r.game] = r.n;
        }
        return out;
    }

    function latestServers() {
        const ts = stmt.latestSvrTs.get().ts;
        if (ts === null) return null;
        const out = { ts, players: 0, servers: 0, games: {} };
        for (const r of stmt.latestSvrRows.all(ts)) {
            if (r.game === TOTAL) { out.players = r.players; out.servers = r.servers; }
            else out.games[r.game] = { players: r.players, servers: r.servers };
        }
        return out;
    }

    const peakOf = key => { const r = stmt.getPeak.get(key); return r ? { n: r.n, ts: r.ts } : null; };
    const dailyRow = r => r ? ({ day: dayIso(r.day), dau: r.dau, wau: r.wau, mau: r.mau, new: r.new_launchers, games: JSON.parse(r.games || '{}') }) : null;

    function summary(now) {
        const today = dayOf(now);
        const p24 = stmt.peak24.get(TOTAL, now - DAY);
        const s24 = stmt.svrPeak24.get(TOTAL, now - DAY);
        return {
            since: meta('since'),
            latest: latest(),
            servers: latestServers(),
            peak24h: p24 ? { n: p24.n, ts: p24.ts } : null,
            peakAll: peakOf('online'),
            serversPeak24h: s24 ? { n: s24.n, ts: s24.ts } : null,
            serversPeakAll: peakOf('svr:players'),
            gamePeaks: Object.fromEntries(stmt.gamePeaks.all().map(r => [r.key.slice(5), { n: r.n, ts: r.ts }])),
            today: { day: dayIso(today), ...uniquesFor(today), partial: true },
            yesterday: dailyRow(stmt.dailyOne.get(today - 1)),
        };
    }

    function uniques(now, range) {
        const days = UNIQUE_RANGES[range] === undefined ? 30 : UNIQUE_RANGES[range];
        const today = dayOf(now);
        const from = days ? today - days : 0;
        const rows = stmt.dailyRange.all(from).map(dailyRow);
        rows.push({ day: dayIso(today), ...uniquesFor(today), partial: true });
        return { range: UNIQUE_RANGES[range] === undefined ? '30d' : range, days: rows };
    }

    return {
        seen, sample, maintain, series, summary, uniques,
        close() { db.close(); },
    };
}
