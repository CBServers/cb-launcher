// Live player counts for library cards and game pages, from two sources that cannot be merged:
// players in public servers (servers worker, from the master lists) and people running the game
// from the launcher (cbfriends stats, from presence beats and anonymous pulses). Neither is a
// subset of the other, so the UI shows one, both or neither per the appearance setting. The
// anonymous pulse is unaffected by that setting; it only decides what is drawn.

(function () {
    const SERVERS_URL = 'https://servers.cbservers.xyz/v1/player-counts';
    const CBFRIENDS_URL = 'https://social.cbservers.xyz';
    const POLL_INTERVAL_MS = 30 * 1000;
    const MODES = ['both', 'servers', 'launcher', 'off'];

    // uiId -> { servers, launcher }, null while a source has never answered.
    const latestCounts = {};
    let mode = 'both';
    let started = false;
    let statsUrl = CBFRIENDS_URL + '/v1/stats';

    function entry(uiId) {
        if (!latestCounts[uiId]) latestCounts[uiId] = { servers: null, launcher: null };
        return latestCounts[uiId];
    }

    function applyToVisibleCards() {
        if (!window.AppViews) return;
        const ids = new Set(Object.keys(latestCounts));
        if (window.GameUtils && Array.isArray(window.GameUtils.GAME_ORDER)) {
            window.GameUtils.GAME_ORDER.forEach(id => ids.add(id));
        }
        for (const uiId of ids) {
            const counts = entry(uiId);
            if (typeof window.AppViews.updateLibraryCardPlayerCount === 'function') {
                window.AppViews.updateLibraryCardPlayerCount(uiId, counts);
            }
            if (typeof window.AppViews.updateGamePagePlayerCount === 'function') {
                window.AppViews.updateGamePagePlayerCount(uiId, counts);
            }
        }
    }

    async function fetchServerCounts() {
        const res = await fetch(SERVERS_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const games = json && json.games;
        if (!games || typeof games !== 'object') throw new Error('Malformed response: missing games');
        for (const uiId of Object.keys(games)) {
            const players = games[uiId] && games[uiId].players;
            entry(uiId).servers = typeof players === 'number' ? players : 0;
        }
    }

    async function fetchLauncherCounts() {
        const res = await fetch(statsUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const launcher = json && json.launcher;
        if (!launcher || typeof launcher !== 'object') throw new Error('Malformed response: missing launcher');
        // A game absent from this answer has nobody in it, unlike the servers feed where absence means unknown.
        for (const uiId of Object.keys(latestCounts)) {
            if (!(uiId in launcher)) entry(uiId).launcher = 0;
        }
        for (const uiId of Object.keys(launcher)) {
            const count = launcher[uiId];
            entry(uiId).launcher = typeof count === 'number' ? count : 0;
        }
    }

    async function fetchAndUpdate() {
        const results = await Promise.allSettled([fetchServerCounts(), fetchLauncherCounts()]);
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const source = index === 0 ? 'servers' : 'launcher';
                console.warn(`PlayerCountManager: ${source} count fetch failed, keeping last known counts.`, result.reason);
            }
        });
        applyToVisibleCards();
    }

    async function resolveStatsUrl() {
        if (typeof window.executeCommand !== 'function') return;
        try {
            const result = await window.executeCommand('cbfriends-get-url');
            if (result && typeof result.url === 'string' && result.url) {
                statsUrl = result.url.replace(/\/+$/, '') + '/v1/stats';
            }
        } catch (_) { /* production URL stays */ }
    }

    window.PlayerCountManager = {
        MODES,
        applyToVisibleCards,

        getMode() {
            return mode;
        },

        setMode(next) {
            mode = MODES.includes(next) ? next : 'both';
            applyToVisibleCards();
        },

        getCounts(uiId) {
            return entry(uiId);
        },

        async start() {
            if (started) return;
            started = true;
            await resolveStatsUrl();
            fetchAndUpdate();
            setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
        }
    };
})();
