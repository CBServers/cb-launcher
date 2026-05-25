// Live player counts for library cards — polls gameserve.rs/api/v1/stats once a minute.

(function () {
    const API_URL = 'https://gameserve.rs/api/v1/stats';
    const POLL_INTERVAL_MS = 60 * 1000;

    // uiId -> array of byGame keys to sum
    const MAPPING = {
        't4':       ['T4', 'T4ZM'],
        't5':       ['T5', 'T5ZM'],
        't6':       ['T6', 'T6ZM'],
        'boiii':    ['T7'],
        'iw4x':     ['IW4'],
        'iw5':      ['IW5'],
        'iw6x':     ['IW6'],
        'iw7-mod':  ['IW7'],
        's1x':      ['S1'],
        'h1-mod':   ['H1'],
        'hmw-mod':  ['H2M'],
        'cod4x':    ['IW3']
    };

    const latestCounts = {};
    let pollTimer = null;
    let started = false;

    function sumKeys(byGame, keys) {
        let total = 0;
        for (const key of keys) {
            const entry = byGame[key];
            if (entry && typeof entry.players === 'number') {
                total += entry.players;
            }
        }
        return total;
    }

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
            const byGame = json && json.data && json.data.current && json.data.current.byGame;
            if (!byGame || typeof byGame !== 'object') throw new Error('Malformed response: missing byGame');

            for (const [uiId, keys] of Object.entries(MAPPING)) {
                latestCounts[uiId] = sumKeys(byGame, keys);
            }
            applyToVisibleCards();
        } catch (error) {
            console.warn('PlayerCountManager: fetch failed, keeping last known counts.', error);
        }
    }

    window.PlayerCountManager = {
        getCount(uiId) {
            return latestCounts[uiId] || 0;
        },

        applyToVisibleCards,

        start() {
            if (started) return;
            started = true;
            fetchAndUpdate();
            pollTimer = setInterval(fetchAndUpdate, POLL_INTERVAL_MS);
        },

        stop() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            started = false;
        }
    };
})();
