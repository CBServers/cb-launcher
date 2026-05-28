// Live player counts for library cards — polls api.brad.stream/v1/stats once a minute.

(function () {
    const API_URL = 'https://api.brad.stream/v1/stats';
    const POLL_INTERVAL_MS = 30 * 1000;

    // uiId -> games key
    const MAPPING = {
        'cod4x':    'IW3',
        't4':       'T4',
        't5':       'T5',
        't6':       'T6',
        'boiii':    'T7',
        'bo4':      'T8',
        'iw4x':     'IW4',
        'iw5':      'IW5',
        'iw6x':     'IW6',
        'iw7-mod':  'IW7',
        's1x':      'S1',
        'h1-mod':   'H1',
        'hmw-mod':  'HMW'
    };

    const latestCounts = {};
    let started = false;

    function applyToVisibleCards() {
        if (!window.AppViews) return;
        for (const uiId of Object.keys(MAPPING)) {
            const count = latestCounts[uiId] || 0;
            if (typeof window.AppViews.updateLibraryCardPlayerCount === 'function') {
                window.AppViews.updateLibraryCardPlayerCount(uiId, count);
            }
            if (typeof window.AppViews.updateGamePagePlayerCount === 'function') {
                window.AppViews.updateGamePagePlayerCount(uiId, count);
            }
        }
    }

    async function fetchAndUpdate() {
        try {
            const res = await fetch(API_URL, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const games = json && json.games;
            if (!games || typeof games !== 'object') throw new Error('Malformed response: missing games');

            for (const [uiId, key] of Object.entries(MAPPING)) {
                const entry = games[key];
                latestCounts[uiId] = (entry && typeof entry.players === 'number') ? entry.players : 0;
            }
            applyToVisibleCards();
        } catch (error) {
            console.warn('PlayerCountManager: fetch failed, keeping last known counts.', error);
        }
    }

    window.PlayerCountManager = {
        applyToVisibleCards,

        start() {
            if (started) return;
            started = true;
            fetchAndUpdate();
            setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
        }
    };
})();
