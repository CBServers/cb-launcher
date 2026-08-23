// CB Launcher Steam Workshop catalog.
//
// A cron incrementally scrapes the Steam Workshop (QueryFiles, 100 items per
// page, cursor paging) into a per-game KV catalog; search requests are served
// from that catalog memory-first and never touch Steam. The Steam API key is
// a worker secret spent only by the scrape (~300-400 calls per sweep), so
// user traffic cannot rate-limit it.
//
// Endpoints (all GET):
//   /v1/search?game=bo3&query=&kind=all|map|mod&sort=popular|recent|name&page=1
//       -> { items: [{id,title,author,kind,preview,subscribers,size,updatedAt}], total, scrapedAt }
//   /v1/meta?game=bo3 -> { scrapedAt, count }
//
// KV cost model: see README. The free plan allows 50 subrequests per
// invocation, so each cron run processes a bounded number of pages and
// persists its cursor; a full sweep completes across ~10 runs.

const STEAM_API = 'https://api.steampowered.com';
const GAMES = {
    bo3: { appid: 311210, creatorAppid: 455130 },
};

const PAGE_SIZE = 60;
const SCRAPE_INTERVAL_MS = 12 * 3600_000;
const SCRAPE_ABANDON_MS = 6 * 3600_000;
const PAGES_PER_RUN = 30;
const AUTHOR_CALLS_PER_RUN = 8;
const CATALOG_CACHE_TTL_MS = 300_000;
const RATE_LIMIT_PER_MINUTE = 60;

// Per-isolate, best-effort caches; KV backs every miss.
const catalogCache = new Map(); // game -> { catalog, fetchedAt }
const rateBuckets = new Map(); // `${ip}:${minute}` -> count

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

function checkRateLimit(ip) {
    const bucket = Math.floor(Date.now() / 60000);
    const key = `${ip}:${bucket}`;

    if (rateBuckets.size > 10000) {
        for (const staleKey of rateBuckets.keys()) {
            if (!staleKey.endsWith(`:${bucket}`)) {
                rateBuckets.delete(staleKey);
            }
        }
    }

    const count = (rateBuckets.get(key) || 0) + 1;
    rateBuckets.set(key, count);
    return count <= RATE_LIMIT_PER_MINUTE;
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

export function toCatalogItem(details, authors) {
    if (!details || !details.title || details.banned) {
        return null;
    }

    const tags = (details.tags || []).map(tag => (tag.tag || '').toLowerCase());
    return {
        id: String(details.publishedfileid),
        title: details.title,
        author: authors[details.creator] || '',
        kind: tags.includes('mod') ? 'mod' : 'map',
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

function handleSearch(url, catalog) {
    const { items, total } = searchCatalog(catalog ? catalog.items : [], {
        query: url.searchParams.get('query') || '',
        kind: url.searchParams.get('kind') || 'all',
        sort: url.searchParams.get('sort') || 'popular',
        page: url.searchParams.get('page') || 1,
    });

    return json(200, { items, total, scrapedAt: catalog ? catalog.scrapedAt : null }, { 'Cache-Control': 'max-age=60' });
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

    await env.WORKSHOP.put(`catalog:${game}`, JSON.stringify({ scrapedAt: new Date().toISOString(), items }));
    await env.WORKSHOP.put('authors', JSON.stringify(state.authors));
    await env.WORKSHOP.delete(`scrape:${game}`);
    catalogCache.delete(game);
    console.log(`scraped ${items.length} items for ${game}`);
}

export default {
    async fetch(request, env) {
        if (request.method !== 'GET') {
            return json(405, { error: 'method not allowed' });
        }

        if (!checkRateLimit(request.headers.get('CF-Connecting-IP') || 'unknown')) {
            return json(429, { error: 'rate limited' });
        }

        const url = new URL(request.url);
        const game = url.searchParams.get('game');
        if (!GAMES[game]) {
            return json(400, { error: 'unknown game' });
        }

        const catalog = await getCatalog(env, game);
        switch (url.pathname) {
            case '/v1/search':
                return handleSearch(url, catalog);
            case '/v1/meta':
                return json(200, {
                    scrapedAt: catalog ? catalog.scrapedAt : null,
                    count: catalog ? catalog.items.length : 0,
                });
            default:
                return json(404, { error: 'not found' });
        }
    },

    async scheduled(controller, env) {
        for (const game of Object.keys(GAMES)) {
            await runScrape(env, game);
        }
    },
};
