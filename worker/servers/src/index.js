// CB Launcher live server lists.
//
// A thin cache/normalization proxy over gameserve.rs, which aggregates the
// community master servers and asks consumers to cache on their side. Each
// game's list is held at the edge for 30 seconds, so launcher traffic reaches
// gameserve.rs a handful of times a minute regardless of user count, and the
// launcher owns its own schema in case the upstream ever changes.
//
// Endpoint (GET):
//   /v1/servers?game=<launcher game key, e.g. t6>
//       -> { servers: [{id,name,map,mode,gametype,players,maxPlayers,bots,ping,region,country,countryName}], fetchedAt }
//   Ping is always null here: the launcher measures it natively per user.

const UPSTREAM = 'https://gameserve.rs/api/v1';

// Launcher game key -> gameserve.rs game ids. Plutonium splits mp/zm into two
// ids; HMW and H2M track different master servers for the same game.
const GAMES = {
    cod1: ['COD1'],
    coduo: ['CODUO'],
    cod2x: ['COD2'],
    cod4x: ['IW3'],
    t4: ['T4', 'T4ZM'],
    t5: ['T5', 'T5ZM'],
    iw4x: ['IW4'],
    iw5: ['IW5'],
    t6: ['T6', 'T6ZM'],
    boiii: ['T7'],
    iw6x: ['IW6'],
    'iw7-mod': ['IW7'],
    s1x: ['S1'],
    'h1-mod': ['H1'],
    'hmw-mod': ['HMW', 'H2M'],
};

const RATE_LIMIT_PER_MINUTE = 60;
const CACHE_SECONDS = 30;

const rateBuckets = new Map(); // `${ip}:${minute}` -> count

const REGION_COUNTRIES = {
    NA: 'us ca mx bs bb bz cr cu do gt hn ht jm ni pa pr sv tt',
    SA: 'ar bo br cl co ec gy pe py sr uy ve',
    EU: 'ad al at ba be bg by ch cy cz de dk ee es fi fr gb ge gi gr hr hu ie is it li lt lu lv mc md me mk mt nl no pl pt ro rs ru se si sk sm tr ua xk',
    AS: 'ae af am az bd bh bn bt cn hk id il in iq ir jo jp kg kh kr kw kz la lb lk mm mn mo my np om ph pk ps qa sa sg sy th tj tm tw uz vn ye',
    OCE: 'au fj nc nz pf pg to vu ws',
    AF: 'ao bf bi bj bw cd cf cg ci cm cv dj dz eg er et ga gh gm gn gq gw ke km lr ls ly ma mg ml mr mu mw mz na ne ng rw sc sd sl sn so ss st sz td tg tn tz ug za zm zw',
};

const regionByCountry = new Map();
for (const [region, countries] of Object.entries(REGION_COUNTRIES)) {
    for (const country of countries.split(' ')) {
        regionByCountry.set(country, region);
    }
}

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

function normalizeServer(server, upstreamId) {
    if (!server || !server.address) {
        return null;
    }

    const players = server.players || {};
    const location = server.location || {};
    return {
        id: server.address,
        name: String(server.name || '').replace(/\^\d/g, '').trim() || server.address,
        map: (server.map && (server.map.display || server.map.raw)) || '',
        mode: server.isZombies || upstreamId.endsWith('ZM') ? 'zm' : 'mp',
        gametype: (server.mode && server.mode.raw) || '',
        players: Number(players.current) || 0,
        maxPlayers: Number(players.max) || 0,
        bots: Number(players.bots) || 0,
        ping: null,
        region: regionByCountry.get(location.countryCode) || '',
        country: location.countryCode || '',
        countryName: location.countryName || '',
    };
}

async function fetchUpstream(upstreamId) {
    const response = await fetch(`${UPSTREAM}/servers?game=${upstreamId}&limit=500`);
    if (!response.ok) {
        throw new Error(`${upstreamId} -> ${response.status}`);
    }

    const body = await response.json();
    return ((body.data || {}).servers || [])
        .map(server => normalizeServer(server, upstreamId))
        .filter(Boolean);
}

async function handleServers(game) {
    const cacheKey = new Request(`https://cache/v1/${game}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) {
        return cached;
    }

    const lists = await Promise.all(GAMES[game].map(fetchUpstream));

    const byAddress = new Map();
    for (const list of lists) {
        for (const server of list) {
            if (!byAddress.has(server.id)) {
                byAddress.set(server.id, server);
            }
        }
    }

    const result = json(200, {
        servers: [...byAddress.values()],
        fetchedAt: new Date().toISOString(),
    }, { 'Cache-Control': `max-age=${CACHE_SECONDS}` });
    await caches.default.put(cacheKey, result.clone());
    return result;
}

export default {
    async fetch(request) {
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

        if (url.pathname !== '/v1/servers') {
            return json(404, { error: 'not found' });
        }

        try {
            return await handleServers(game);
        } catch (error) {
            console.log(`server list failed: ${error}`);
            return json(502, { error: 'upstream unavailable' });
        }
    },
};
