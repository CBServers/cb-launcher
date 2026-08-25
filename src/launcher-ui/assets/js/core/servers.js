// Server browser service. UI-only phase: getServers() is the single seam where
// real master-server fetching plugs in later (native command or worker call
// keyed by GameUtils.getGameMapping); until then it serves generated mock data.
// Fixtures are deterministic per game so ids stay stable across sessions and
// favorites survive relaunches; only players/bots/ping change per refresh.
//
// Server: { id: 'ip:port', name, map, mode: 'mp'|'zm', gametype, players, maxPlayers, bots, ping, locked, region }
(function () {
    'use strict';

    const CAPABILITIES = {
        cod4x:     { modes: ['mp'] },
        t4:        { modes: ['mp', 'zm'] },
        t5:        { modes: ['mp', 'zm'] },
        iw4x:      { modes: ['mp'] },
        iw5:       { modes: ['mp'] },
        t6:        { modes: ['mp', 'zm'] },
        boiii:     { modes: ['mp', 'zm'] },
        iw6x:      { modes: ['mp'] },
        s1x:       { modes: ['mp'] },
        'h1-mod':  { modes: ['mp'] },
        'hmw-mod': { modes: ['mp'] }
    };

    const FAVORITES_KEY = 'cb_server_favorites';

    window.__serversMock = window.__serversMock || { latency: 600 };

    const MAPS = {
        cod4x:     { mp: ['mp_crash', 'mp_backlot', 'mp_crossfire', 'mp_strike', 'mp_vacant', 'mp_overgrown', 'mp_shipment'] },
        t4:        { mp: ['mp_castle', 'mp_dome', 'mp_makin', 'mp_asylum', 'mp_seelow', 'mp_outskirts'], zm: ['nazi_zombie_prototype', 'nazi_zombie_asylum', 'nazi_zombie_sumpf', 'nazi_zombie_factory'] },
        t5:        { mp: ['mp_array', 'mp_cracked', 'mp_firingrange', 'mp_havoc', 'mp_nuked', 'mp_villa'], zm: ['zombie_theater', 'zombie_pentagon', 'zombie_cosmodrome', 'zombie_moon'] },
        iw4x:      { mp: ['mp_rust', 'mp_terminal', 'mp_highrise', 'mp_afghan', 'mp_favela', 'mp_skidrow'] },
        iw5:       { mp: ['mp_dome', 'mp_seatown', 'mp_bootleg', 'mp_hardhat', 'mp_paris', 'mp_lambeth'] },
        t6:        { mp: ['mp_raid', 'mp_hijacked', 'mp_express', 'mp_meltdown', 'mp_carrier', 'mp_nuketown_2020'], zm: ['zm_transit', 'zm_buried', 'zm_prison', 'zm_tomb'] },
        boiii:     { mp: ['mp_apartments', 'mp_biodome', 'mp_sector', 'mp_stronghold', 'mp_metro'], zm: ['zm_zod', 'zm_castle', 'zm_island', 'zm_stalingrad', 'zm_genesis'] },
        iw6x:      { mp: ['mp_strikezone', 'mp_warhawk', 'mp_sovereign', 'mp_flooded', 'mp_prisonbreak'] },
        s1x:       { mp: ['mp_bio_lab', 'mp_comeback', 'mp_detroit', 'mp_greenband', 'mp_riot'] },
        'h1-mod':  { mp: ['mp_crash', 'mp_crossfire', 'mp_shipment', 'mp_broadcast', 'mp_citystreets', 'mp_showdown'] },
        'hmw-mod': { mp: ['mp_rust', 'mp_terminal', 'mp_highrise', 'mp_quarry', 'mp_subbase', 'mp_estate'] }
    };

    const GAMETYPES = {
        mp: ['tdm', 'dom', 'sd', 'conf', 'koth', 'ctf', 'dm'],
        zm: ['zclassic', 'zstandard', 'zsurvival', 'zgrief']
    };

    const NAME_HEADS = ['Frontline', 'Overwatch', 'Night Ops', 'Iron Sights', 'Warzone', 'Bulletworks', 'Ghost Division', 'Task Force', 'Vanguard', 'Redline', 'Sandbox', 'Old School'];
    const NAME_TAILS = ['24/7', 'EU Mix', 'NA Central', 'Hardcore', 'Vanilla', 'No Rules', 'Community', 'Ranked', 'Casual Nights', 'Sniper Lobby', 'FFA Madness', 'Stock Maps'];
    const REGIONS = ['NA', 'NA', 'EU', 'EU', 'AS', 'OCE'];
    const MAX_PLAYERS = [8, 12, 16, 18, 18, 24, 32];

    function delay() {
        return new Promise(resolve => setTimeout(resolve, window.__serversMock.latency));
    }

    function hash(text) {
        let value = 2166136261;
        for (let i = 0; i < text.length; i++) {
            value ^= text.charCodeAt(i);
            value = Math.imul(value, 16777619);
        }
        return value >>> 0;
    }

    function mulberry32(seed) {
        return function () {
            seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function pick(rng, list) {
        return list[Math.floor(rng() * list.length)];
    }

    function supports(game) {
        return CAPABILITIES[game] || null;
    }

    function buildServer(game, index, rng) {
        const caps = CAPABILITIES[game];
        const mode = pick(rng, caps.modes);
        const maps = (MAPS[game] && MAPS[game][mode]) || ['mp_unknown'];
        const maxPlayers = pick(rng, MAX_PLAYERS);

        let name = `${pick(rng, NAME_HEADS)} | ${pick(rng, NAME_TAILS)} #${index + 1}`;
        if (index === 0) {
            name = `[CB] The Absurdly Long Community Server Name That Never Ends ${game.toUpperCase()} 24/7`;
        }

        const server = {
            id: `${140 + Math.floor(rng() * 60)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${1 + Math.floor(rng() * 254)}:${27016 + index}`,
            name,
            map: pick(rng, maps),
            mode,
            gametype: mode === 'zm' ? pick(rng, GAMETYPES.zm) : pick(rng, GAMETYPES.mp),
            maxPlayers,
            locked: index === 5 || rng() < 0.08,
            region: pick(rng, REGIONS),
            players: Math.floor(Math.random() * (maxPlayers + 1)),
            bots: 0,
            ping: 15 + Math.floor(Math.random() * 120)
        };

        // Fixed indices keep every UI state demonstrable on each refresh:
        // an empty server, a full one, a bot-heavy one and a distant one.
        if (index === 1) server.players = 0;
        if (index === 2) server.players = server.maxPlayers;
        if (index === 3) server.bots = Math.max(2, Math.floor(server.maxPlayers / 3));
        if (index === 4) server.ping = 190 + Math.floor(Math.random() * 120);

        server.players = Math.max(server.players, server.bots);
        return server;
    }

    async function getServers(game) {
        if (!supports(game)) return [];
        await delay();

        const count = 15 + (hash(game) % 12);
        const servers = [];
        for (let i = 0; i < count; i++) {
            servers.push(buildServer(game, i, mulberry32(hash(`${game}:${i}`))));
        }
        return servers;
    }

    function readFavorites() {
        try {
            const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
            return stored && typeof stored === 'object' ? stored : {};
        } catch (error) {
            return {};
        }
    }

    function writeFavorites(favorites) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch (error) {
            // Storage can be unavailable; favorites just stop persisting.
        }
    }

    function getFavorites(game) {
        const list = readFavorites()[game];
        return Array.isArray(list) ? list : [];
    }

    function isFavorite(game, id) {
        return getFavorites(game).includes(id);
    }

    function toggleFavorite(game, id) {
        const favorites = readFavorites();
        const list = Array.isArray(favorites[game]) ? favorites[game] : [];
        const added = !list.includes(id);
        favorites[game] = added ? list.concat(id) : list.filter(entry => entry !== id);
        writeFavorites(favorites);
        return added;
    }

    window.ServersService = {
        CAPABILITIES,
        supports,
        getServers,
        getFavorites,
        isFavorite,
        toggleFavorite
    };
})();
