// Zip archive entries: normalization, and the archives=1 gate on search, item and updated.
import worker, { normalizeIndex } from '../src/index.js';
import { checks, makeClient, makeEnv } from './harness.mjs';

const check = checks();
const REPO = 'CBServers/mods-index';
const COMMIT = 'a'.repeat(40);
const HASH = '0123456789ABCDEF';
const ZIP = 'https://github.com/a/b/releases/download/v1/zm_bridge.zip';

function loose(path, extra = {}) {
    return { root: 'storage', path, size: 10, hash: HASH, url: 'https://github.com/a/b/releases/download/v1/x', ...extra };
}

function member(path, name, extra = {}) {
    return { root: 'storage', path, size: 20, hash: HASH, archive: 0, member: name, ...extra };
}

function item(id, extra = {}) {
    return {
        id, type: 'map', name: id, author: 'me', version: '1', description: 'd', requires: [], preview: null, screenshots: [],
        changesGameFiles: false, addedAt: 100, updatedAt: 200, files: [loose(`mods/${id}/mod.ff`)], ...extra,
    };
}

function zipped(id, extra = {}) {
    return item(id, {
        archives: [{ url: ZIP, size: 500, hash: HASH }],
        files: [member(`usermaps/${id}/${id}.ff`, `${id}/${id}.ff`), member(`usermaps/${id}/${id}.iwd`, `${id}/${id}.iwd`)],
        ...extra,
    });
}

const items = [
    item('mp_maps_menu', { type: 'mod' }),
    zipped('zm_bridge', { requires: ['mp_maps_menu'], updatedAt: 300 }),
    item('needs_zip', { requires: ['zm_bridge', 'mp_maps_menu'] }),
    zipped('mixed', { files: [loose('usermaps/mixed/readme.md'), member('usermaps/mixed/mixed.ff', 'mixed.ff')] }),
    zipped('split_zip', { archives: [{ parts: ['https://a/x.001', 'cdn:mods/bo2/split_zip/x.002'], size: 500, hash: HASH }] }),
    zipped('bad_archive_hash', { archives: [{ url: ZIP, size: 500, hash: 'abc' }] }),
    zipped('bad_archive_size', { archives: [{ url: ZIP, size: 0, hash: HASH }] }),
    zipped('bad_archive_link', { archives: [{ url: 'http://insecure/x.zip', size: 500, hash: HASH }] }),
    zipped('both_links', { archives: [{ url: ZIP, parts: ['https://a', 'https://b'], size: 500, hash: HASH }] }),
    zipped('bad_index', { files: [member('usermaps/a/a.ff', 'a.ff', { archive: 1 })] }),
    zipped('fraction_index', { files: [member('usermaps/a/a.ff', 'a.ff', { archive: 0.5 })] }),
    zipped('no_archives', { archives: [] }),
    zipped('member_and_url', { files: [member('usermaps/a/a.ff', 'a.ff', { url: ZIP })] }),
    zipped('member_no_archive', { files: [loose('usermaps/a/a.ff', { member: 'a.ff' })] }),
    zipped('backslash', { files: [member('usermaps/a/a.ff', 'a\\a.ff')] }),
    zipped('absolute', { files: [member('usermaps/a/a.ff', '/a/a.ff')] }),
    zipped('drive', { files: [member('usermaps/a/a.ff', 'C:/a.ff')] }),
    zipped('dotdot', { files: [member('usermaps/a/a.ff', 'x/../a.ff')] }),
    zipped('empty_member', { files: [member('usermaps/a/a.ff', '')] }),
    zipped('unused_archive', { archives: [{ url: ZIP, size: 500, hash: HASH }, { url: ZIP, size: 500, hash: HASH }] }),
    zipped('bad_member_path', { files: [member('../escape', 'a.ff')] }),
].map(entry => JSON.parse(JSON.stringify(entry)));

const KEPT = ['mp_maps_menu', 'zm_bridge', 'needs_zip', 'mixed', 'split_zip'];

// ── normalizeIndex ──

const catalog = normalizeIndex({ game: 'bo2', commit: COMMIT, generatedAt: 1793400000, items }, 'bo2', REPO);

check('malformed archive entries are dropped, the rest kept', JSON.stringify(catalog.items.map(i => i.id)) === JSON.stringify(KEPT));
{
    const bridge = catalog.details.zm_bridge;
    check('archives are normalized', bridge.archives.length === 1 && bridge.archives[0].url === ZIP && bridge.archives[0].size === 500 && bridge.archives[0].hash === HASH);
    check('members keep archive and member, no links', bridge.files.every(f => f.archive === 0 && f.member.startsWith('zm_bridge/') && !f.url && !f.parts));
    check('size is the installed size', bridge.size === 40);
    check('only archive entries are flagged', catalog.items.filter(i => i.archives).map(i => i.id).join() === 'zm_bridge,mixed,split_zip');
    const mixed = catalog.details.mixed;
    check('loose files and members mix', mixed.files[0].url && mixed.files[0].archive === undefined && mixed.files[1].archive === 0 && mixed.size === 30);
    check('split archives keep their parts', catalog.details.split_zip.archives[0].parts.length === 2 && !catalog.details.split_zip.archives[0].url);
    check('loose entries have no archives', catalog.details.mp_maps_menu.archives.length === 0 && !catalog.items[0].archives);
}

// ── endpoints ──

const { env } = makeEnv();
await env.WORKSHOP.put('catalog:bo2', JSON.stringify(catalog));
const client = makeClient(worker, env);
const on = { game: 'bo2', archives: '1' };

{
    const old = await client('/v1/search', { params: { game: 'bo2', sort: 'name' } });
    check('search hides archive entries without archives=1', old.b.total === 2 && old.b.items.map(i => i.id).join() === 'mp_maps_menu,needs_zip');
    const other = await client('/v1/search', { params: { game: 'bo2', archives: 'true' } });
    check('only archives=1 opens the gate', other.b.total === 2);
    const all = await client('/v1/search', { params: { ...on, sort: 'name' } });
    check('search lists archive entries with archives=1', all.b.total === 5);
}

{
    check('item is 404 for an archive entry without archives=1', (await client('/v1/item', { params: { game: 'bo2', id: 'zm_bridge' } })).s === 404);
    const res = await client('/v1/item', { params: { ...on, id: 'zm_bridge' } });
    check('item returns archives and members', res.s === 200 && res.b.archives.length === 1 && res.b.archives[0].hash === HASH
        && res.b.files.length === 2 && res.b.files[0].member === 'zm_bridge/zm_bridge.ff');
    check('archive entry requires resolve', res.b.children.length === 1 && res.b.children[0].id === 'mp_maps_menu');

    const loose = await client('/v1/item', { params: { game: 'bo2', id: 'needs_zip' } });
    check('loose items still serve without archives=1', loose.s === 200 && Array.isArray(loose.b.archives) && loose.b.archives.length === 0);
    check('archive children are hidden without archives=1', loose.b.children.map(c => c.id).join() === 'mp_maps_menu');
    const withZip = await client('/v1/item', { params: { ...on, id: 'needs_zip' } });
    check('archive children show with archives=1', withZip.b.children.map(c => c.id).join() === 'zm_bridge,mp_maps_menu');
}

{
    const ids = 'zm_bridge,mixed,mp_maps_menu';
    const old = await client('/v1/updated', { params: { game: 'bo2', ids } });
    check('updated hides archive entries without archives=1', JSON.stringify(old.b) === JSON.stringify({ mp_maps_menu: '1' }));
    const all = await client('/v1/updated', { params: { ...on, ids } });
    check('updated includes archive entries with archives=1', Object.keys(all.b).length === 3);
}

{
    // Catalogs stored before archive support have no archives field on details; another game dodges the catalog cache.
    const legacy = JSON.parse(JSON.stringify(catalog));
    delete legacy.details.mp_maps_menu.archives;
    await env.WORKSHOP.put('catalog:mw2', JSON.stringify(legacy));
    const res = await client('/v1/item', { params: { game: 'mw2', id: 'mp_maps_menu' } });
    check('a stored catalog without archives still serves items', res.s === 200 && res.b.archives.length === 0);
}

check.done();
