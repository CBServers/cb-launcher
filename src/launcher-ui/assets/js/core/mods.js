// Mod manager facade. Installed list, import, uninstall, folder lookup and
// Workshop installs (anonymous steamcmd) are native commands; search and item
// details hit the workshop worker (see worker/workshop). Preview mode
// (file://, localhost) serves mock data instead.
//
// InstalledMod: { id, name, kind: 'map'|'mod', folder, version, size, installedAt, updateAvailable, source: 'workshop'|'import', workshopId }
// WorkshopItem: { id, title, author, kind, preview, subscribers, size, updatedAt, installed, updateAvailable }
// Job progress:  { active, phase: 'queued'|'preparing'|'downloading'|'copying'|'extracting'|'installing'|'done'|'error', name, percent, error }
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

    window.__modsMock = window.__modsMock || { latency: 450 };

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

    async function pollJob(game, onEvent) {
        for (;;) {
            await delay(300);
            const job = await window.executeCommand('get-mod-progress', { game: backendId(game) });
            if (!job) throw new Error('Lost track of the install.');
            if (job.active) {
                if (onEvent) onEvent(job);
                continue;
            }
            if (job.phase === 'error') throw new Error(job.error || 'The install failed.');
            return { success: true, name: job.name };
        }
    }

    async function install(game, id, onTick, size) {
        if (PREVIEW_MODE) {
            for (let percent = 0; percent <= 100; percent += 25) {
                if (onTick) onTick({ phase: 'downloading', percent });
                await delay(200);
            }
            return { success: true };
        }

        const started = await window.executeCommand('install-workshop-mod', { game: backendId(game), id, size: size || 0 });
        if (!started || !started.success) {
            throw new Error((started && started.error) || 'Failed to start the install.');
        }

        return pollJob(game, onTick);
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

        return pollJob(game, job => onPhase && onPhase(job.phase, job.name));
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
        install,
        update: install,
        uninstall,
        importFolder: (game, path, onPhase) => importFromPath(game, path, 'folder', onPhase),
        importZip: (game, path, onPhase) => importFromPath(game, path, 'zip', onPhase),
        getModsFolder
    };
})();
