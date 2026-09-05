// SQLite backing store for serve.mjs: the KV binding surface plus Durable Object storage,
// one table for both. Uses node:sqlite (Node 22.13+), keeping the zero-npm-dependency property.
import { DatabaseSync } from 'node:sqlite';

// Exclusive upper bound for a prefix range scan (keys here are ASCII, so this never overflows).
function prefixUpper(prefix) {
    return prefix + '￿';
}

// opts.now is injectable for expiry tests.
export function openStore(path, opts = {}) {
    const now = opts.now || Date.now;
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS kv (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            expires_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS kv_expires ON kv (expires_at) WHERE expires_at IS NOT NULL;
    `);

    const stmt = {
        get: db.prepare('SELECT value, expires_at FROM kv WHERE key = ?'),
        put: db.prepare('INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ' +
                        'ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at'),
        del: db.prepare('DELETE FROM kv WHERE key = ?'),
        sweep: db.prepare('DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?'),
        listKeys: db.prepare('SELECT key FROM kv WHERE key >= ? AND key < ? ' +
                             'AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?'),
        range: db.prepare('SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key LIMIT ?'),
        rangeRev: db.prepare('SELECT key, value FROM kv WHERE key >= ? AND key < ? ORDER BY key DESC LIMIT ?'),
    };

    // Workers KV surface as used by src/index.js: string values, expirationTtl,
    // cursor pagination matching Cloudflare's page shape.
    const KV_PAGE = 1000;
    const kv = {
        async get(key) {
            const row = stmt.get.get(key);
            if (!row) return null;
            if (row.expires_at !== null && row.expires_at <= now()) {
                stmt.del.run(key);
                return null;
            }
            return row.value;
        },
        async put(key, value, putOpts) {
            const expires = putOpts && putOpts.expirationTtl
                ? now() + putOpts.expirationTtl * 1000
                : null;
            stmt.put.run(key, String(value), expires);
        },
        async delete(key) {
            stmt.del.run(key);
        },
        async list({ prefix = '', cursor, limit = KV_PAGE } = {}) {
            const from = cursor ? Buffer.from(String(cursor), 'base64').toString('utf8') + '\0' : prefix;
            const rows = stmt.listKeys.all(from, prefixUpper(prefix), now(), limit + 1);
            const complete = rows.length <= limit;
            const keys = rows.slice(0, limit).map(r => ({ name: r.key }));
            const page = { keys, list_complete: complete };
            if (!complete) page.cursor = Buffer.from(keys[keys.length - 1].name, 'utf8').toString('base64');
            return page;
        },
    };

    // Durable Object storage surface (get/put/delete/list with start/end/limit/reverse),
    // namespaced into the same table by an instance prefix. JSON values, no expiry.
    function doStorage(prefix) {
        const full = key => prefix + key;
        return {
            async get(key) {
                const row = stmt.get.get(full(key));
                return row === undefined ? undefined : JSON.parse(row.value);
            },
            async put(keyOrEntries, value) {
                const entries = typeof keyOrEntries === 'object'
                    ? Object.entries(keyOrEntries)
                    : [[keyOrEntries, value]];
                db.exec('BEGIN');
                try {
                    for (const [k, v] of entries) stmt.put.run(full(k), JSON.stringify(v), null);
                    db.exec('COMMIT');
                } catch (e) {
                    db.exec('ROLLBACK');
                    throw e;
                }
            },
            async delete(keys) {
                for (const k of (Array.isArray(keys) ? keys : [keys])) stmt.del.run(full(k));
            },
            async list({ prefix: p = '', start, end, limit, reverse } = {}) {
                let lo = full(p);
                let hi = prefixUpper(lo);
                if (start !== undefined && full(start) > lo) lo = full(start);
                if (end !== undefined && full(end) < hi) hi = full(end);
                const rows = (reverse ? stmt.rangeRev : stmt.range).all(lo, hi, limit || -1);
                return new Map(rows.map(r => [r.key.slice(prefix.length), JSON.parse(r.value)]));
            },
        };
    }

    return {
        kv,
        doStorage,
        sweepExpired() { stmt.sweep.run(now()); },
        close() { db.close(); },
    };
}
