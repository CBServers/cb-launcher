// CB Launcher mod catalog.
//
// Two sources share the endpoints. Steam games (`source:'steam'`): a cron
// incrementally scrapes the Steam Workshop (QueryFiles, 100 items per page,
// cursor paging) into a per-game KV catalog; search requests are served from
// that catalog memory-first and never touch Steam. The Steam API key is a
// worker secret spent only by the scrape (~300-400 calls per sweep), so user
// traffic cannot rate-limit it. Index games (`source:'index'`): the cron (or
// POST /v1/refresh) resolves the `dist` branch of the mods-index repo and, when
// its commit changed, stores every game's dist/<game>.json from that commit.
//
// Endpoints (GET unless noted):
//   /v1/search?game=bo3&query=&kind=all|map|mod&sort=popular|recent|name&page=1
//       -> { items: [{id,title,author,kind,preview,subscribers,size,updatedAt}], total, scrapedAt }
//          index items also carry version, comingSoon, changesGameFiles; popular sorts as recent
//   /v1/meta?game=bo3 -> { scrapedAt, count }  (index games add commit)
//   /v1/item?game=bo3&id=<publishedfileid>
//       -> { id, title, kind, preview, description, screenshots, subscribers, size, views, createdAt, updatedAt, votes,
//            children: [{id,title,kind,size}] }  (required items, one level deep)
//          index items add author, version, comingSoon, changesGameFiles and files:
//            [{ root, path, size, hash, url | parts }]
//   /v1/updated?game=bo3&ids=<comma list> -> { "<id>": <updatedAt unix>, ... }  (index games: "<id>": "<version>")
//   /v1/image/<commit>/<game>/<id>/<file> -> an index image, proxied from the repo at that commit
//   POST /v1/refresh (Authorization: Bearer INDEX_REFRESH_SECRET) -> re-syncs the index now
//
// KV cost model: see README. The free plan allows 50 subrequests per
// invocation, so each cron run processes a bounded number of pages and
// persists its cursor; a full sweep completes across ~10 runs.

const STEAM_API = 'https://api.steampowered.com';
const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';
const DEFAULT_INDEX_REPO = 'CBServers/mods-index';
const INDEX_GAMES = ['cod1', 'coduo', 'cod2', 'cod4', 'mw2', 'ghosts', 'aw', 'mwr', 'iw', 'mw2r', 'waw', 'bo1', 'mw3', 'bo2'];
const GAMES = {
    bo3: { source: 'steam', appid: 311210, creatorAppid: 455130 },
    ...Object.fromEntries(INDEX_GAMES.map(game => [game, { source: 'index' }])),
};
const STEAM_GAMES = Object.keys(GAMES).filter(game => GAMES[game].source === 'steam');

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STEAM_ID_RE = /^\d{1,20}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const HASH_RE = /^[0-9A-F]{16}$/;
const IMAGE_RE = /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png)$/;
const PUBLIC_HOST_RE = /^workshop\.cbservers\.(dev|xyz)$/;
const USER_AGENT = 'cb-workshop-worker';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REFRESH_MIN_INTERVAL_MS = 10_000;
const IMAGE_RATE_LIMIT_PER_MINUTE = 600;

const PAGE_SIZE = 60;
const SCRAPE_INTERVAL_MS = 3600_000;
const UPDATED_IDS_MAX = 100;
const SCRAPE_ABANDON_MS = 6 * 3600_000;
const PAGES_PER_RUN = 30;
const MIN_RESCRAPE_RATIO = 0.5;
const AUTHOR_CALLS_PER_RUN = 8;
const CATALOG_CACHE_TTL_MS = 300_000;
const RATE_LIMIT_PER_MINUTE = 60;

// Per-isolate, best-effort caches; KV backs every miss.
const catalogCache = new Map(); // game -> { catalog, fetchedAt }
const rateBuckets = new Map(); // `${scope}:${ip}:${minute}` -> count
let lastRefreshAt = 0;

function json(status, body, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            ...extraHeaders,
        },
    });
}

function checkRateLimit(ip, scope = 'api', limit = RATE_LIMIT_PER_MINUTE) {
    const bucket = Math.floor(Date.now() / 60000);
    const key = `${scope}:${ip}:${bucket}`;

    if (rateBuckets.size > 10000) {
        for (const staleKey of rateBuckets.keys()) {
            if (!staleKey.endsWith(`:${bucket}`)) {
                rateBuckets.delete(staleKey);
            }
        }
    }

    const count = (rateBuckets.get(key) || 0) + 1;
    rateBuckets.set(key, count);
    return count <= limit;
}

// Exported (with toCatalogItem) so the fixture test can run them outside the worker.
export function searchCatalog(items, { query = '', kind = 'all', sort = 'popular', page = 1 } = {}) {
    const needle = String(query).trim().toLowerCase();

    const matches = items.filter(item =>
        (kind === 'all' || item.kind === kind)
        && (!needle || item.title.toLowerCase().includes(needle) || item.author.toLowerCase().includes(needle)));

    matches.sort((a, b) => {
        if (sort === 'recent') return b.updatedAt - a.updatedAt;
        if (sort === 'name') return a.title.localeCompare(b.title);
        return b.subscribers - a.subscribers;
    });

    const pageIndex = Math.max(1, Number(page) || 1) - 1;
    return {
        items: matches.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
        total: matches.length,
    };
}

function kindFromTags(details) {
    const tags = (details.tags || []).map(tag => (tag.tag || '').toLowerCase());
    return tags.includes('mod') ? 'mod' : 'map';
}

function usableDetails(details) {
    return !!(details && details.title && !details.banned && Number(details.result || 1) === 1);
}

export function toItemDetail(details) {
    if (!usableDetails(details)) {
        return null;
    }

    return {
        id: String(details.publishedfileid),
        title: details.title,
        kind: kindFromTags(details),
        preview: details.preview_url || '',
        description: details.file_description || '',
        screenshots: (details.previews || [])
            .filter(preview => preview.preview_type === 0 && preview.url)
            .map(preview => preview.url),
        subscribers: Number(details.lifetime_subscriptions || details.subscriptions || 0),
        size: Number(details.file_size || 0),
        views: Number(details.views || 0),
        createdAt: Number(details.time_created || 0),
        updatedAt: Number(details.time_updated || 0),
        votes: {
            score: Number((details.vote_data || {}).score || 0),
            up: Number((details.vote_data || {}).votes_up || 0),
            down: Number((details.vote_data || {}).votes_down || 0),
        },
    };
}

export function toCatalogItem(details, authors) {
    if (!details || !details.title || details.banned) {
        return null;
    }

    return {
        id: String(details.publishedfileid),
        title: details.title,
        author: authors[details.creator] || '',
        kind: kindFromTags(details),
        preview: details.preview_url || '',
        subscribers: Number(details.lifetime_subscriptions || details.subscriptions || 0),
        size: Number(details.file_size || 0),
        updatedAt: Number(details.time_updated || 0),
    };
}

async function getCatalog(env, game) {
    const cached = catalogCache.get(game);
    if (cached && Date.now() - cached.fetchedAt < CATALOG_CACHE_TTL_MS) {
        return cached.catalog;
    }

    const catalog = await env.WORKSHOP.get(`catalog:${game}`, 'json');
    catalogCache.set(game, { catalog, fetchedAt: Date.now() });
    return catalog;
}

function handleSearch(url, catalog, game, origin) {
    const index = GAMES[game].source === 'index';
    const sort = url.searchParams.get('sort') || 'popular';
    const { items, total } = searchCatalog(catalog ? catalog.items : [], {
        query: url.searchParams.get('query') || '',
        kind: url.searchParams.get('kind') || 'all',
        // Index entries have no subscriber counts yet.
        sort: index && sort === 'popular' ? 'recent' : sort,
        page: url.searchParams.get('page') || 1,
    });

    return json(200, {
        items: index ? items.map(item => ({ ...item, preview: absoluteImage(origin, item.preview) })) : items,
        total,
        scrapedAt: catalog ? catalog.scrapedAt : null,
    }, { 'Cache-Control': 'max-age=60' });
}

function handleUpdated(url, catalog, game) {
    const index = GAMES[game].source === 'index';
    const ids = (url.searchParams.get('ids') || '').split(',').filter(id => SLUG_RE.test(id)).slice(0, UPDATED_IDS_MAX);
    const byId = new Map((catalog ? catalog.items : []).map(item => [item.id, index ? item.version : item.updatedAt]));
    const result = {};
    for (const id of ids) {
        if (byId.has(id)) {
            result[id] = byId.get(id);
        }
    }

    return json(200, result, { 'Cache-Control': 'max-age=300' });
}

// Required items of a workshop item, resolved to displayable entries. Catalog
// first (no extra Steam call in the common case), one batched GetDetails for
// the rest. Ids Steam cannot describe are shipped bare so the launcher can
// still download them.
async function resolveChildren(env, game, ids) {
    const catalog = await getCatalog(env, game);
    const byId = new Map(((catalog && catalog.items) || []).map(item => [item.id, item]));
    const resolved = [];
    const missing = [];
    for (const id of ids) {
        const item = byId.get(id);
        if (item) {
            resolved.push({ id, title: item.title, kind: item.kind, size: item.size });
        } else {
            missing.push(id);
        }
    }

    if (missing.length) {
        try {
            const params = { key: env.STEAM_API_KEY, appid: GAMES[game].appid, includetags: true };
            missing.forEach((id, index) => { params[`publishedfileids[${index}]`] = id; });
            const response = await steamGet('/IPublishedFileService/GetDetails/v1/', params);
            for (const details of response.publishedfiledetails || []) {
                if (usableDetails(details)) {
                    resolved.push({
                        id: String(details.publishedfileid),
                        title: details.title,
                        kind: kindFromTags(details),
                        size: Number(details.file_size || 0),
                    });
                }
            }
        } catch (error) {
            console.log(`child lookup failed: ${error}`);
            for (const id of missing) {
                resolved.push({ id, title: '', kind: '', size: 0 });
            }
        }
    }

    return resolved;
}

async function handleItem(request, env, url, game) {
    const id = url.searchParams.get('id') || '';
    if (GAMES[game].source === 'index') {
        return handleIndexItem(await getCatalog(env, game), id, publicOrigin(request, url));
    }

    if (!STEAM_ID_RE.test(id)) {
        return json(400, { error: 'invalid id' });
    }

    // v2: payload gained `children`; the bump keeps stale edge entries out.
    const cacheKey = new Request(`https://cache/v2/${game}/${id}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) {
        return cached;
    }

    const response = await steamGet('/IPublishedFileService/GetDetails/v1/', {
        key: env.STEAM_API_KEY,
        'publishedfileids[0]': id,
        appid: GAMES[game].appid,
        includetags: true,
        includeadditionalpreviews: true,
        includevotes: true,
        includechildren: true,
    });

    const raw = (response.publishedfiledetails || [])[0];
    const detail = toItemDetail(raw);
    if (!detail) {
        return json(404, { error: 'not found' });
    }

    const childIds = [...new Set((raw.children || [])
        .map(child => String(child.publishedfileid))
        .filter(childId => /^\d{1,20}$/.test(childId) && childId !== id))].slice(0, 20);
    detail.children = childIds.length ? await resolveChildren(env, game, childIds) : [];

    const result = json(200, detail, { 'Cache-Control': 'max-age=3600' });
    await caches.default.put(cacheKey, result.clone());
    return result;
}

// ── Mod index ───────────────────────────────────────────────────────────

function indexRepo(env) {
    return (env && env.INDEX_REPO) || DEFAULT_INDEX_REPO;
}

// Image URLs are built on whichever of our hostnames served the request, so they follow the launcher's failover.
function publicOrigin(request, url) {
    const forwarded = (request.headers.get('X-Forwarded-Host') || '').split(',')[0].trim().toLowerCase();
    if (PUBLIC_HOST_RE.test(forwarded)) return `https://${forwarded}`;
    if (PUBLIC_HOST_RE.test(url.hostname)) return `https://${url.hostname}`;
    return url.origin;
}

function absoluteImage(origin, path) {
    return path ? `${origin}${path}` : '';
}

function safeRelativePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 200 && !path.startsWith('/')
        && !/[\\:<>"|?*\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
}

function normalizeFile(file) {
    if (!file || typeof file !== 'object') return null;
    const size = Number(file.size);
    if (!['game', 'storage'].includes(file.root) || !safeRelativePath(file.path)
        || !Number.isSafeInteger(size) || size < 0 || !HASH_RE.test(file.hash || '')) {
        return null;
    }

    const validUrl = value => typeof value === 'string' && /^(https:\/\/|cdn:)/.test(value);
    const result = { root: file.root, path: file.path, size, hash: file.hash };
    if (validUrl(file.url) && file.parts === undefined) {
        result.url = file.url;
    } else if (Array.isArray(file.parts) && file.parts.length >= 2 && file.parts.every(validUrl) && file.url === undefined) {
        result.parts = file.parts.slice();
    } else {
        return null;
    }
    return result;
}

// raw.githubusercontent URL pinned to the build commit -> our /v1/image path; anything else is dropped.
function imagePath(url, repo, commit, game, id) {
    const prefix = `${GITHUB_RAW}/${repo}/${commit}/items/${game}/${id}/`;
    if (typeof url !== 'string' || !url.startsWith(prefix)) return '';
    const file = url.slice(prefix.length);
    return IMAGE_RE.test(file) ? `/v1/image/${commit}/${game}/${id}/${file}` : '';
}

// A dist/<game>.json becomes the { scrapedAt, items } shape the Steam path stores (so search is shared),
// plus `details` for /v1/item. The repo's CI already validated it; this only refuses what the launcher must never see.
export function normalizeIndex(raw, game, repo) {
    if (!raw || typeof raw !== 'object' || raw.game !== game || !COMMIT_RE.test(raw.commit || '') || !Array.isArray(raw.items)) {
        throw new Error(`dist/${game}.json is malformed`);
    }

    const catalog = {
        scrapedAt: new Date(Number(raw.generatedAt || 0) * 1000).toISOString(),
        commit: raw.commit,
        items: [],
        details: {},
    };

    for (const entry of raw.items) {
        if (!entry || !SLUG_RE.test(entry.id || '') || catalog.details[entry.id] || typeof entry.name !== 'string') {
            continue;
        }
        const files = (Array.isArray(entry.files) ? entry.files : []).map(normalizeFile);
        if (files.some(file => !file)) {
            console.log(`index ${game}/${entry.id}: dropped, a file failed validation`);
            continue;
        }

        const images = [entry.preview, ...(Array.isArray(entry.screenshots) ? entry.screenshots : [])]
            .map(url => imagePath(url, repo, raw.commit, game, entry.id));
        const item = {
            id: entry.id,
            title: entry.name,
            author: String(entry.author || ''),
            kind: entry.type === 'mod' ? 'mod' : 'map',
            preview: images[0] || '',
            subscribers: 0,
            size: files.reduce((total, file) => total + file.size, 0),
            updatedAt: Number(entry.updatedAt || 0),
            version: String(entry.version || ''),
            comingSoon: files.length === 0,
            changesGameFiles: !!entry.changesGameFiles,
        };
        catalog.items.push(item);
        catalog.details[entry.id] = {
            ...item,
            description: String(entry.description || ''),
            screenshots: images.slice(1).filter(Boolean),
            createdAt: Number(entry.addedAt || 0),
            requires: (Array.isArray(entry.requires) ? entry.requires : []).filter(id => SLUG_RE.test(id) && id !== entry.id),
            files,
        };
    }

    return catalog;
}

async function githubGet(env, url, accept) {
    const headers = { 'User-Agent': USER_AGENT, Accept: accept };
    if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`${url} -> ${response.status}`);
    }
    return response.json();
}

// All games come from one dist commit or none do; a failure keeps the stored catalogs and retries next run.
export async function syncIndex(env) {
    const repo = indexRepo(env);
    const ref = await githubGet(env, `${GITHUB_API}/repos/${repo}/git/ref/heads/dist`, 'application/vnd.github+json');
    const distCommit = ref && ref.object && ref.object.sha;
    if (!COMMIT_RE.test(distCommit || '')) {
        throw new Error('dist ref has no commit');
    }

    const state = (await env.WORKSHOP.get('index:state', 'json')) || {};
    if (state.distCommit === distCommit) {
        return { changed: false, distCommit };
    }

    const catalogs = {};
    for (const game of INDEX_GAMES) {
        const raw = await githubGet(env, `${GITHUB_RAW}/${repo}/${distCommit}/dist/${game}.json`, 'application/json');
        catalogs[game] = normalizeIndex(raw, game, repo);
    }

    for (const game of INDEX_GAMES) {
        await env.WORKSHOP.put(`catalog:${game}`, JSON.stringify(catalogs[game]));
        catalogCache.delete(game);
    }
    await env.WORKSHOP.put('index:state', JSON.stringify({ distCommit, syncedAt: new Date().toISOString() }));
    console.log(`index synced to dist ${distCommit.slice(0, 7)}: ${INDEX_GAMES.map(game => `${game}=${catalogs[game].items.length}`).join(' ')}`);
    return { changed: true, distCommit };
}

function handleIndexItem(catalog, id, origin) {
    if (!SLUG_RE.test(id)) {
        return json(400, { error: 'invalid id' });
    }

    const entry = catalog && catalog.details ? catalog.details[id] : null;
    if (!entry) {
        return json(404, { error: 'not found' });
    }

    const children = entry.requires
        .map(childId => catalog.details[childId])
        .filter(Boolean)
        .map(child => ({ id: child.id, title: child.title, kind: child.kind, size: child.size }));

    return json(200, {
        id: entry.id,
        title: entry.title,
        author: entry.author,
        kind: entry.kind,
        version: entry.version,
        preview: absoluteImage(origin, entry.preview),
        description: entry.description,
        screenshots: entry.screenshots.map(path => absoluteImage(origin, path)),
        subscribers: 0,
        size: entry.size,
        views: 0,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        votes: null,
        comingSoon: entry.comingSoon,
        changesGameFiles: entry.changesGameFiles,
        children,
        files: entry.files,
    }, { 'Cache-Control': 'max-age=60' });
}

// Only images inside an entry folder of the index repo, at an exact commit, so the URL is immutable.
async function handleImage(env, pathname) {
    const match = /^\/v1\/image\/([0-9a-f]{40})\/([a-z0-9]+)\/([a-z0-9][a-z0-9_-]{0,63})\/([^/]+)$/.exec(pathname);
    if (!match || GAMES[match[2]]?.source !== 'index' || !IMAGE_RE.test(match[4])) {
        return json(404, { error: 'not found' });
    }

    const [, commit, game, id, file] = match;
    const response = await fetch(`${GITHUB_RAW}/${indexRepo(env)}/${commit}/items/${game}/${id}/${file}`, {
        headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
        return json(response.status === 404 ? 404 : 502, { error: 'image unavailable' });
    }

    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_IMAGE_BYTES) {
        return json(502, { error: 'image too large' });
    }

    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

function secretMatches(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string' || given.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
}

async function handleRefresh(request, env) {
    if (!env.INDEX_REFRESH_SECRET) {
        return json(404, { error: 'not found' });
    }
    const auth = request.headers.get('Authorization') || '';
    if (!secretMatches(auth.replace(/^Bearer /, ''), env.INDEX_REFRESH_SECRET)) {
        return json(401, { error: 'unauthorized' });
    }
    if (Date.now() - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) {
        return json(429, { error: 'refreshed moments ago' });
    }
    lastRefreshAt = Date.now();

    try {
        return json(200, await syncIndex(env));
    } catch (error) {
        console.log(`index refresh failed: ${error}`);
        return json(502, { error: 'sync failed' });
    }
}

// ── Scrape ──────────────────────────────────────────────────────────────

async function steamGet(path, params) {
    const url = new URL(`${STEAM_API}${path}`);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${path} -> ${response.status}`);
    }

    return (await response.json()).response || {};
}

async function resolveAuthors(env, steamIds, authors) {
    let calls = 0;
    const unknown = [...new Set(steamIds)].filter(id => id && !(id in authors));

    while (unknown.length && calls < AUTHOR_CALLS_PER_RUN) {
        const batch = unknown.splice(0, 100);
        calls++;
        try {
            const response = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', {
                key: env.STEAM_API_KEY,
                steamids: batch.join(','),
            });
            for (const player of response.players || []) {
                authors[player.steamid] = player.personaname || '';
            }
        } catch (error) {
            console.log(`author lookup failed: ${error}`);
            break;
        }
    }
}

async function runScrape(env, game) {
    const config = GAMES[game];
    const now = Date.now();

    let state = await env.WORKSHOP.get(`scrape:${game}`, 'json');
    if (state && now - state.startedAt > SCRAPE_ABANDON_MS) {
        state = null;
    }

    if (!state) {
        const catalog = await getCatalog(env, game);
        if (catalog && now - Date.parse(catalog.scrapedAt) < SCRAPE_INTERVAL_MS) {
            return;
        }

        const authors = (await env.WORKSHOP.get('authors', 'json')) || {};
        state = { cursor: '*', items: [], authors, startedAt: now };
    }

    for (let pages = 0; pages < PAGES_PER_RUN; pages++) {
        const response = await steamGet('/IPublishedFileService/QueryFiles/v1/', {
            key: env.STEAM_API_KEY,
            appid: config.appid,
            creator_appid: config.creatorAppid,
            cursor: state.cursor,
            numperpage: 100,
            query_type: 1,
            return_metadata: 1,
            return_previews: 1,
            return_tags: 1,
        });

        const details = response.publishedfiledetails || [];
        state.items.push(...details);

        if (!response.next_cursor || response.next_cursor === state.cursor || !details.length) {
            state.cursor = null;
            break;
        }

        state.cursor = response.next_cursor;
    }

    await resolveAuthors(env, state.items.map(item => item.creator), state.authors);

    if (state.cursor) {
        await env.WORKSHOP.put(`scrape:${game}`, JSON.stringify(state));
        return;
    }

    const items = state.items
        .map(details => toCatalogItem(details, state.authors))
        .filter(Boolean);

    // A Steam outage yields an empty or truncated page set; never let it replace a good catalog.
    const previous = await getCatalog(env, game);
    const previousCount = previous ? previous.items.length : 0;
    if (items.length < previousCount * MIN_RESCRAPE_RATIO) {
        await env.WORKSHOP.delete(`scrape:${game}`);
        console.warn(`scrape for ${game} returned ${items.length} items vs ${previousCount} cached, keeping cached catalog`);
        return;
    }

    await env.WORKSHOP.put(`catalog:${game}`, JSON.stringify({ scrapedAt: new Date().toISOString(), items }));
    await env.WORKSHOP.put('authors', JSON.stringify(state.authors));
    await env.WORKSHOP.delete(`scrape:${game}`);
    catalogCache.delete(game);
    console.log(`scraped ${items.length} items for ${game}`);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

        if (url.pathname === '/v1/refresh') {
            return request.method === 'POST' ? handleRefresh(request, env) : json(405, { error: 'method not allowed' });
        }

        if (request.method !== 'GET') {
            return json(405, { error: 'method not allowed' });
        }

        if (url.pathname.startsWith('/v1/image/')) {
            if (!checkRateLimit(ip, 'image', IMAGE_RATE_LIMIT_PER_MINUTE)) {
                return json(429, { error: 'rate limited' });
            }
            try {
                return await handleImage(env, url.pathname);
            } catch (error) {
                console.log(`image proxy failed: ${error}`);
                return json(502, { error: 'image unavailable' });
            }
        }

        if (!checkRateLimit(ip)) {
            return json(429, { error: 'rate limited' });
        }

        const game = url.searchParams.get('game');
        if (!GAMES[game]) {
            return json(400, { error: 'unknown game' });
        }

        switch (url.pathname) {
            case '/v1/search':
                return handleSearch(url, await getCatalog(env, game), game, publicOrigin(request, url));
            case '/v1/item':
                try {
                    return await handleItem(request, env, url, game);
                } catch (error) {
                    console.log(`item lookup failed: ${error}`);
                    return json(502, { error: GAMES[game].source === 'index' ? 'catalog unavailable' : 'steam unavailable' });
                }
            case '/v1/updated':
                return handleUpdated(url, await getCatalog(env, game), game);
            case '/v1/meta': {
                const catalog = await getCatalog(env, game);
                const meta = {
                    scrapedAt: catalog ? catalog.scrapedAt : null,
                    count: catalog ? catalog.items.length : 0,
                };
                if (GAMES[game].source === 'index') meta.commit = catalog ? catalog.commit : null;
                return json(200, meta);
            }
            default:
                return json(404, { error: 'not found' });
        }
    },

    async scheduled(controller, env) {
        for (const game of STEAM_GAMES) {
            try {
                await runScrape(env, game);
            } catch (error) {
                console.log(`scrape for ${game} failed: ${error}`);
            }
        }
        try {
            await syncIndex(env);
        } catch (error) {
            console.log(`index sync failed: ${error}`);
        }
    },
};
