// Mod manager facade. Installed list, import, uninstall and folder lookup are
// native commands; search hits the workshop worker (see worker/workshop);
// install/update/getSteamStatus stay mocked until the steamcmd runner exists:
//   install/update  -> install-mod / update-mod { game, id }
//
// InstalledMod: { id, name, kind: 'map'|'mod', folder, version, size, installedAt, updateAvailable, source: 'workshop'|'import', workshopId }
// WorkshopItem: { id, title, author, kind, preview, subscribers, size, updatedAt, installed, updateAvailable }
// Progress:     { game, id, phase: 'downloading'|'extracting'|'done', percent }
(function () {
    'use strict';

    const CAPABILITIES = {
        boiii: { workshop: true,  import: true, folders: ['usermaps', 'mods'], steamAppId: 311210 },
        t4:    { workshop: false, import: true, folders: ['mods', 'usermaps'] },
        t5:    { workshop: false, import: true, folders: ['mods'] },
        t6:    { workshop: false, import: true, folders: ['mods', 'usermaps'] }
    };

    const MB = 1024 * 1024;
    const GB = 1024 * MB;

    const WORKSHOP_API = 'https://workshop.cbservers.xyz';
    const PREVIEW_MODE = window.location.protocol === 'file:'
        || window.location.hostname === 'localhost'
        || window.location.hostname === '127.0.0.1';

    window.__modsMock = window.__modsMock || { steamOwned: true, steamLoggedIn: true, latency: 450 };

    const listeners = new Set();

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, typeof ms === 'number' ? ms : window.__modsMock.latency));
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function daysAgo(days) {
        return new Date(Date.now() - days * 86400000).toISOString();
    }

    const PREVIEWS = [
        'linear-gradient(135deg, #2b1d0e 0%, #f3751b 100%)',
        'linear-gradient(135deg, #0f1b2b 0%, #3b718c 100%)',
        'linear-gradient(135deg, #1d0f2b 0%, #6c63ff 100%)',
        'linear-gradient(135deg, #0e2b1a 0%, #00d26a 100%)',
        'linear-gradient(135deg, #2b0e14 0%, #ff4d5e 100%)',
        'linear-gradient(135deg, #2b230e 0%, #ffb23f 100%)'
    ];

    const WORKSHOP = [
        { id: '2967301155', title: 'Leviathan',                  author: 'DTZxPorter',       kind: 'map', subscribers: 412380, size: 1.9 * GB, updatedAt: daysAgo(41) },
        { id: '2830188521', title: 'Zombies in Spaceland Remake', author: 'Sphynx',           kind: 'map', subscribers: 301220, size: 2.6 * GB, updatedAt: daysAgo(12) },
        { id: '2901120402', title: 'Rave in the Redwoods',       author: 'Natesmithzombies', kind: 'map', subscribers: 240515, size: 1.4 * GB, updatedAt: daysAgo(90) },
        { id: '2911012771', title: 'Der Eisendrache Reimagined', author: 'Scobalula',        kind: 'map', subscribers: 188004, size: 2.1 * GB, updatedAt: daysAgo(3) },
        { id: '2781201010', title: 'Project Wunderwaffe',        author: 'Harry Bo21',       kind: 'mod', subscribers: 154880, size: 480 * MB, updatedAt: daysAgo(7) },
        { id: '2750100123', title: 'Perk Overhaul',              author: 'Ardivee',          kind: 'mod', subscribers: 96312,  size: 212 * MB, updatedAt: daysAgo(120) },
        { id: '2990123001', title: 'Nuketown Zombies 1.0',       author: 'Rollonmath42',     kind: 'map', subscribers: 88140,  size: 960 * MB, updatedAt: daysAgo(2) },
        { id: '2703330909', title: 'Crash Site',                 author: 'Frost Iceforge',   kind: 'map', subscribers: 75002,  size: 1.1 * GB, updatedAt: daysAgo(200) },
        { id: '2994001287', title: 'Custom Weapons Pack',        author: 'JBird632',         kind: 'mod', subscribers: 61288,  size: 640 * MB, updatedAt: daysAgo(15) },
        { id: '2888112230', title: 'Tranzit Reimagined',         author: 'Logical',          kind: 'map', subscribers: 58011,  size: 2.8 * GB, updatedAt: daysAgo(33) },
        { id: '2840561120', title: 'Chaos Perks',                author: 'Ardivee',          kind: 'mod', subscribers: 42019,  size: 88 * MB,  updatedAt: daysAgo(60) },
        { id: '2999871123', title: 'Office Complex',             author: 'Abnormal202',      kind: 'map', subscribers: 23455,  size: 740 * MB, updatedAt: daysAgo(1) }
    ].map((item, index) => Object.assign(item, { preview: PREVIEWS[index % PREVIEWS.length] }));

    function emit(event) {
        listeners.forEach(listener => {
            try { listener(event); } catch (error) { console.error(error); }
        });
    }

    function onProgress(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function runFakeTransfer(game, id, onTick) {
        const publish = event => {
            if (onTick) onTick(event);
            emit(event);
        };
        return new Promise(resolve => {
            let percent = 0;
            const tick = () => {
                percent = Math.min(100, percent + 4 + Math.random() * 9);
                publish({ game, id, phase: percent >= 100 ? 'extracting' : 'downloading', percent: Math.floor(percent) });
                if (percent < 100) {
                    setTimeout(tick, 140 + Math.random() * 160);
                    return;
                }
                setTimeout(() => {
                    publish({ game, id, phase: 'done', percent: 100 });
                    resolve();
                }, 350);
            };
            tick();
        });
    }

    function supports(game) {
        return CAPABILITIES[game] || null;
    }

    function backendId(game) {
        return GameUtils.getGameMapping(game);
    }

    async function workshopFetch(path, params) {
        const api = window.__modsMock.workshopApi || WORKSHOP_API;
        const res = await fetch(`${api}${path}?${new URLSearchParams(params)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function getInstalled(game) {
        const mods = await window.executeCommand('get-installed-mods', { game: backendId(game) });
        return Array.isArray(mods) ? mods : [];
    }

    function searchMock({ query, kind, sort }) {
        const needle = query.trim().toLowerCase();
        const items = WORKSHOP
            .filter(item => (kind === 'all' || item.kind === kind)
                && (!needle || item.title.toLowerCase().includes(needle) || item.author.toLowerCase().includes(needle)))
            .sort((a, b) => {
                if (sort === 'recent') return new Date(b.updatedAt) - new Date(a.updatedAt);
                if (sort === 'name') return a.title.localeCompare(b.title);
                return b.subscribers - a.subscribers;
            })
            .map(item => Object.assign(clone(item), { installed: false, updateAvailable: false }));

        return { items, total: items.length };
    }

    async function search(game, options) {
        const caps = supports(game);
        if (!caps || !caps.workshop) return { items: [], total: 0 };

        const opts = {
            query: String((options && options.query) || ''),
            kind: (options && options.kind) || 'all',
            sort: (options && options.sort) || 'popular',
            page: (options && options.page) || 1
        };

        if (PREVIEW_MODE && !window.__modsMock.workshopApi) {
            await delay();
            return searchMock(opts);
        }

        try {
            const params = { game: backendId(game), ...opts };
            const data = await workshopFetch('/v1/search', params);
            const items = (Array.isArray(data.items) ? data.items : [])
                .map(item => Object.assign(item, { installed: false, updateAvailable: false }));
            return { items, total: Number(data.total) || items.length };
        } catch (error) {
            console.warn('Workshop search failed', error);
            return { items: [], total: 0 };
        }
    }

    async function getSteamStatus() {
        await delay(120);
        const { steamOwned, steamLoggedIn } = window.__modsMock;
        return { owned: !!steamOwned, loggedIn: !!steamLoggedIn, username: steamLoggedIn ? 'preview_user' : null };
    }

    async function install(game, workshopId, onTick) {
        const item = WORKSHOP.find(entry => entry.id === workshopId);
        if (!item) throw new Error('Unknown workshop item ' + workshopId);

        await runFakeTransfer(game, workshopId, onTick);
        return { success: true };
    }

    async function update(game, id, onTick) {
        await runFakeTransfer(game, id, onTick);
        return { success: true };
    }

    async function uninstall(game, id) {
        const result = await window.executeCommand('uninstall-mod', { game: backendId(game), id });
        if (!result || !result.success) {
            throw new Error((result && result.error) || 'Failed to uninstall the mod.');
        }
        return result;
    }

    async function importFromPath(game, path, kind, onPhase) {
        const started = await window.executeCommand('import-mod', { game: backendId(game), path, kind });
        if (!started || !started.success) {
            throw new Error((started && started.error) || 'Failed to start the import.');
        }

        for (;;) {
            await delay(300);
            const job = await window.executeCommand('get-mod-progress', { game: backendId(game) });
            if (!job) throw new Error('Lost track of the import.');
            if (job.active) {
                if (onPhase) onPhase(job.phase, job.name);
                continue;
            }
            if (job.phase === 'error') throw new Error(job.error || 'Import failed.');
            return { success: true, name: job.name };
        }
    }

    async function getDetails(game, id) {
        if (PREVIEW_MODE && !window.__modsMock.workshopApi) {
            await delay();
            const item = WORKSHOP.find(entry => entry.id === id);
            if (!item) throw new Error('Unknown item');
            return Object.assign(clone(item), {
                description: '[h1]Preview[/h1]\nThis is placeholder detail text shown in UI preview mode.\n[b]Bold[/b], [i]italic[/i] and a [url=https://cbservers.xyz]link[/url].',
                screenshots: [],
                views: item.subscribers * 4,
                createdAt: Math.floor(new Date(item.updatedAt).getTime() / 1000) - 86400 * 200,
                updatedAt: Math.floor(new Date(item.updatedAt).getTime() / 1000),
                votes: { score: 0.93, up: 1200, down: 90 }
            });
        }

        return workshopFetch('/v1/item', { game: backendId(game), id });
    }

    function getModsFolder(game, folder) {
        return window.executeCommand('get-mods-folder', { game: backendId(game), folder });
    }

    window.ModsService = {
        CAPABILITIES,
        supports,
        getInstalled,
        search,
        getDetails,
        getSteamStatus,
        install,
        update,
        uninstall,
        importFolder: (game, path, onPhase) => importFromPath(game, path, 'folder', onPhase),
        importZip: (game, path, onPhase) => importFromPath(game, path, 'zip', onPhase),
        getModsFolder,
        onProgress
    };
})();
