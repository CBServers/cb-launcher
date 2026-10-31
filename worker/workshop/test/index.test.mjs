// Mod index source: dist normalization, sync, the index endpoints, the image proxy and the refresh hook.
import worker, { normalizeIndex, syncIndex } from '../src/index.js';
import { checks, fixture, jsonResponse, makeClient, makeEnv, stubFetch } from './harness.mjs';

const check = checks();
const REPO = 'CBServers/mods-index';
const COMMIT = 'a'.repeat(40);
const RAW = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/items/t6`;
const GAMES = ['cod4x', 'iw4x', 'mwr', 'iw', 'mw2r', 't4', 't5', 'iw5', 't6'];
const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function file(path, extra = {}) {
    return { root: 'storage', path, size: 10, hash: '0123456789ABCDEF', url: 'https://github.com/a/b/releases/download/v1/x', ...extra };
}

function item(id, extra = {}) {
    return {
        id, type: 'map', name: id.toUpperCase(), author: 'me', version: '1', description: 'd', requires: [],
        preview: null, screenshots: [], size: 10, changesGameFiles: false, addedAt: 100, updatedAt: 200,
        files: [file(`mods/${id}/mod.ff`)], ...extra,
    };
}

function t6Items(alphaVersion = '2') {
    return [
        item('zm_alpha', {
            version: alphaVersion,
            updatedAt: 300,
            preview: `${RAW}/zm_alpha/main.jpg`,
            screenshots: [`${RAW}/zm_alpha/two.png`, 'https://evil.example/x.png', `${RAW}/other/three.png`],
            requires: ['shared_assets', 'missing'],
            changesGameFiles: true,
            files: [file('mods/zm_alpha/mod.ff'), file('zone/all/zm_alpha.ipak', { root: 'game', url: undefined, parts: ['cdn:mods/t6/zm_alpha/a.001', 'cdn:mods/t6/zm_alpha/a.002'] })],
        }),
        item('shared_assets', { type: 'mod', updatedAt: 100 }),
        item('soon-map', { files: [], updatedAt: 250 }),
        item('bad_path', { files: [file('../escape')] }),
        item('bad_hash', { files: [file('mods/x/a', { hash: 'abc' })] }),
        item('both_links', { files: [file('mods/x/b', { parts: ['https://a', 'https://b'] })] }),
        item('bad_root', { files: [file('mods/x/c', { root: 'appdata' })] }),
        item('zm_alpha', { name: 'duplicate' }),
        item('Bad Id'),
    ].map(entry => JSON.parse(JSON.stringify(entry)));
}

function dist(game, items) {
    return { game, commit: COMMIT, generatedAt: 1793400000, items };
}

// Routed GitHub: the dist ref, the per-game dist files at that ref, and one image.
const github = { distSha: 'd'.repeat(40), failGame: null, alphaVersion: '2' };
const calls = stubFetch([
    {
        test: url => url === `https://api.github.com/repos/${REPO}/git/ref/heads/dist`,
        respond: () => jsonResponse(200, { object: { sha: github.distSha } }),
    },
    {
        test: url => url.includes('/dist/') && url.startsWith(`https://raw.githubusercontent.com/${REPO}/`),
        respond: url => {
            const [, sha, game] = /\/([0-9a-f]{40})\/dist\/([a-z0-9]+)\.json$/.exec(url);
            if (sha !== github.distSha) return jsonResponse(404, {});
            if (game === github.failGame) return jsonResponse(500, {});
            return jsonResponse(200, dist(game, game === 't6' ? t6Items(github.alphaVersion) : []));
        },
    },
    {
        test: url => url === `${RAW}/zm_alpha/main.jpg`,
        respond: () => new Response(IMAGE_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    },
    {
        test: url => url.startsWith('https://raw.githubusercontent.com/'),
        respond: () => new Response('404: Not Found', { status: 404 }),
    },
]);
const rawDistCalls = () => calls.filter(call => call.url.includes('/dist/')).length;

// ── normalizeIndex ──

{
    const real = normalizeIndex(fixture('dist-t6.json'), 't6', REPO);
    const smoke = real.details.smoke;
    check('real publish.py output normalizes', real.items.length === 1 && smoke.files.length === 4 && smoke.size === 188792);
    check('real output keeps parts and roots', smoke.files[3].parts.length === 2 && smoke.files[2].root === 'game' && !smoke.files[3].url);
    check('real output without images has no preview', smoke.preview === '' && smoke.screenshots.length === 0 && !smoke.comingSoon);
}

{
    let threw = 0;
    for (const raw of [dist('t5', []), { ...dist('t6', []), commit: 'abc' }, { game: 't6', commit: COMMIT }, null]) {
        try { normalizeIndex(raw, 't6', REPO); } catch { threw++; }
    }
    check('malformed dist documents are refused', threw === 4);
}

{
    const catalog = normalizeIndex(dist('t6', t6Items()), 't6', REPO);
    check('invalid entries are dropped, the rest kept', JSON.stringify(catalog.items.map(i => i.id)) === JSON.stringify(['zm_alpha', 'shared_assets', 'soon-map']));
    const alpha = catalog.details.zm_alpha;
    check('preview becomes an image path', alpha.preview === `/v1/image/${COMMIT}/t6/zm_alpha/main.jpg`);
    check('only this entry\'s repo images survive', alpha.screenshots.length === 1 && alpha.screenshots[0].endsWith('/zm_alpha/two.png'));
    check('size is summed from files', alpha.size === 20 && alpha.changesGameFiles === true);
    check('coming soon has no files', catalog.details['soon-map'].comingSoon === true && catalog.details['soon-map'].files.length === 0);
}

// ── syncIndex ──

const { env, kv, writes } = makeEnv({ INDEX_REFRESH_SECRET: 'sekrit' });

{
    github.failGame = 'iw';
    let failed = false;
    try { await syncIndex(env); } catch { failed = true; }
    check('one failing game fails the whole sync', failed);
    check('a failed sync writes nothing', writes.length === 0 && !kv.has('index:state'));
    github.failGame = null;
}

{
    const result = await syncIndex(env);
    const t6 = JSON.parse(kv.get('catalog:t6'));
    check('sync stores every game and the state', result.changed && writes.length === GAMES.length + 1 && t6.items.length === 3);
    check('state records the dist commit', JSON.parse(kv.get('index:state')).distCommit === github.distSha);

    const before = rawDistCalls();
    const again = await syncIndex(env);
    check('an unchanged dist ref fetches and writes nothing', !again.changed && rawDistCalls() === before && writes.length === GAMES.length + 1);
}

// ── endpoints ──

const client = makeClient(worker, env);
const viaDev = { 'X-Forwarded-Host': 'workshop.cbservers.dev' };

{
    const res = await client('/v1/search', { params: { game: 't6' }, headers: viaDev });
    const ids = res.b.items.map(i => i.id);
    check('popular sorts index games by recent', JSON.stringify(ids) === JSON.stringify(['zm_alpha', 'soon-map', 'shared_assets']));
    check('search previews use the public host', res.b.items[0].preview === `https://workshop.cbservers.dev/v1/image/${COMMIT}/t6/zm_alpha/main.jpg`);
    check('search items carry version and coming soon', res.b.items[0].version === '2' && res.b.items[1].comingSoon === true);
    check('items without images have an empty preview', res.b.items[2].preview === '');
}

{
    const spoofed = await client('/v1/search', { params: { game: 't6' }, headers: { 'X-Forwarded-Host': 'evil.example' } });
    check('an unknown forwarded host falls back to the request origin', spoofed.b.items[0].preview.startsWith('http://127.0.0.1:8790/v1/image/'));
    const xyz = await client('/v1/search', { params: { game: 't6' }, headers: { 'X-Forwarded-Host': 'workshop.cbservers.xyz' } });
    check('the fallback domain builds its own image URLs', xyz.b.items[0].preview.startsWith('https://workshop.cbservers.xyz/'));
    const mods = await client('/v1/search', { params: { game: 't6', kind: 'mod' } });
    check('kind filter applies', mods.b.total === 1 && mods.b.items[0].id === 'shared_assets');
    const named = await client('/v1/search', { params: { game: 't6', sort: 'name' } });
    check('name sort applies', named.b.items.map(i => i.title).join() === 'SHARED_ASSETS,SOON-MAP,ZM_ALPHA');
}

{
    const res = await client('/v1/item', { params: { game: 't6', id: 'zm_alpha' }, headers: viaDev });
    check('item returns its files with hashes', res.s === 200 && res.b.files.length === 2 && res.b.files[0].hash === '0123456789ABCDEF');
    check('item keeps split parts', res.b.files[1].parts.length === 2 && res.b.files[1].root === 'game');
    check('requires resolve to known children only', res.b.children.length === 1 && res.b.children[0].id === 'shared_assets' && res.b.children[0].size === 10);
    check('item screenshots are absolute', res.b.screenshots[0] === `https://workshop.cbservers.dev/v1/image/${COMMIT}/t6/zm_alpha/two.png`);
    check('item has no Steam stats', res.b.votes === null && res.b.subscribers === 0 && res.b.version === '2' && res.b.author === 'me');
    const soon = await client('/v1/item', { params: { game: 't6', id: 'soon-map' } });
    check('coming soon item', soon.b.comingSoon === true && soon.b.files.length === 0);
    check('unknown item is 404', (await client('/v1/item', { params: { game: 't6', id: 'nope' } })).s === 404);
    check('bad item id is 400', (await client('/v1/item', { params: { game: 't6', id: 'Bad Id' } })).s === 400);
}

{
    const res = await client('/v1/updated', { params: { game: 't6', ids: 'zm_alpha,soon-map,nope,Bad!' } });
    check('updated returns versions for index games', JSON.stringify(res.b) === JSON.stringify({ zm_alpha: '2', 'soon-map': '1' }));
    const meta = await client('/v1/meta', { params: { game: 't6' } });
    check('meta reports count and commit', meta.b.count === 3 && meta.b.commit === COMMIT);
    const empty = await client('/v1/meta', { params: { game: 'iw' } });
    check('games without entries are empty', empty.b.count === 0);
}

{
    const res = await client(`/v1/image/${COMMIT}/t6/zm_alpha/main.jpg`);
    check('image is proxied', res.s === 200 && Buffer.compare(res.b, IMAGE_BYTES) === 0);
    check('image is immutable-cached', res.h.get('Content-Type') === 'image/jpeg' && res.h.get('Cache-Control').includes('immutable'));
    check('upstream 404 is 404', (await client(`/v1/image/${COMMIT}/t6/zm_alpha/missing.png`)).s === 404);
    let refused = 0;
    for (const path of [`/v1/image/${COMMIT}/bo3/x/main.jpg`, `/v1/image/abc/t6/zm_alpha/main.jpg`,
        `/v1/image/${COMMIT}/t6/zm_alpha/..%2Fentry.json`, `/v1/image/${COMMIT}/t6/zm_alpha/entry.json`, `/v1/image/${COMMIT}/t6/zm_alpha`]) {
        if ((await client(path)).s === 404) refused++;
    }
    check('image paths outside entry images are refused', refused === 5);
}

// ── refresh ──

{
    const noSecret = makeClient(worker, makeEnv().env);
    check('refresh is hidden without a secret', (await noSecret('/v1/refresh', { method: 'POST' })).s === 404);
    check('refresh needs POST', (await client('/v1/refresh')).s === 405);
    check('refresh rejects a wrong secret', (await client('/v1/refresh', { method: 'POST', headers: { Authorization: 'Bearer nope' } })).s === 401);
    const ok = await client('/v1/refresh', { method: 'POST', headers: { Authorization: 'Bearer sekrit' } });
    check('refresh syncs', ok.s === 200 && ok.b.changed === false && ok.b.distCommit === github.distSha);
    const again = await client('/v1/refresh', { method: 'POST', headers: { Authorization: 'Bearer sekrit' } });
    check('refresh is throttled', again.s === 429);
}

{
    github.distSha = 'e'.repeat(40);
    github.alphaVersion = '3';
    const result = await syncIndex(env);
    const res = await client('/v1/updated', { params: { game: 't6', ids: 'zm_alpha' } });
    check('a new dist commit replaces the cached catalog', result.changed && res.b.zm_alpha === '3');
}

// ── Steam path and routing ──

{
    await env.WORKSHOP.put('catalog:bo3', JSON.stringify({
        scrapedAt: '2026-10-31T00:00:00.000Z',
        items: [{ id: '123', title: 'T', author: 'a', kind: 'map', preview: 'https://steam.example/x.jpg', subscribers: 5, size: 1, updatedAt: 7 }],
    }));
    const search = await client('/v1/search', { params: { game: 'bo3' }, headers: viaDev });
    check('steam previews are left alone', search.b.items[0].preview === 'https://steam.example/x.jpg');
    const updated = await client('/v1/updated', { params: { game: 'bo3', ids: '123' } });
    check('steam updated still returns times', updated.b['123'] === 7);
    check('unknown game is 400', (await client('/v1/search', { params: { game: 'bo2' } })).s === 400);
    check('POST elsewhere is 405', (await client('/v1/search', { method: 'POST', params: { game: 't6' } })).s === 405);
}

check.done();
