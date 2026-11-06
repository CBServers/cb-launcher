// Mod manager facade. Installed list, import, uninstall, folder lookup and
// catalog installs (anonymous steamcmd for the Steam Workshop, the launcher's
// file-by-file installer for the mod index) are native commands; search and
// item details hit the workshop worker (see worker/workshop). Preview mode
// (file://, localhost) serves mock data instead.
//
// CAPABILITIES: catalog = a Workshop tab (the worker serves the game); steam = that
// catalog is the Steam Workshop, otherwise it is the community mod index; catalogGame = its id
// there, the game's manifest name, when that differs from the backend key.
//
// InstalledMod: { id, name, author, description, kind: 'map'|'mod', folder, version, size, installedAt, updateAvailable, source: 'workshop'|'import'|'steam'|'catalog', workshopId, missingFiles }
// WorkshopItem: { id, title, author, kind, preview, subscribers, size, updatedAt, installed, updateAvailable, version, comingSoon, changesGameFiles }
// Job progress:  { active, phase: 'queued'|'preparing'|'downloading'|'copying'|'extracting'|'installing'|'done'|'error', name, percent, error }
(function () {
    'use strict';

    const CAPABILITIES = {
        boiii:     { catalog: true, steam: true, import: true, folders: ['usermaps', 'mods'], steamAppId: 311210 },
        cod1:      { catalog: true },
        coduo:     { catalog: true },
        cod2x:     { catalog: true, catalogGame: 'cod2' },
        cod4x:     { catalog: true, catalogGame: 'cod4', import: true, folders: ['mods', 'usermaps'] },
        iw4x:      { catalog: true, catalogGame: 'mw2', import: true, folders: ['mods', 'usermaps'] },
        iw6x:      { catalog: true, import: true, folders: ['mods'] },
        s1x:       { catalog: true, import: true, folders: ['mods'] },
        'h1-mod':  { catalog: true, import: true, folders: ['mods', 'usermaps'] },
        'iw7-mod': { catalog: true, import: true, folders: ['mods', 'usermaps'] },
        mw2r:      { catalog: true, import: true, folders: ['mods'] },
        t4:        { catalog: true, catalogGame: 'waw', import: true, folders: ['mods', 'usermaps'] },
        t5:        { catalog: true, catalogGame: 'bo1', import: true, folders: ['mods', 'usermaps'] },
        iw5:       { catalog: true, catalogGame: 'mw3', import: true, folders: ['mods', 'usermaps'] },
        t6:        { catalog: true, catalogGame: 'bo2', import: true, folders: ['mods', 'usermaps'] }
    };

    const MB = 1024 * 1024;
    const GB = 1024 * MB;

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

    // Mock mod index for the other games: slug ids, versions, no subscriber counts.
    const INDEX = [
        { id: 'zombies_declassified', title: 'Zombies Declassified (DLC 5)', author: 'Logo-2K', kind: 'map', size: 9.06 * GB, updatedAt: daysAgo(3), version: 'beta2', changesGameFiles: true },
        { id: 'cargo', title: 'Nazi Zombie Cargo', author: 'SomeMapper', kind: 'map', size: 700 * MB, updatedAt: daysAgo(12), version: '1.2.0', requires: ['cargo_assets'] },
        { id: 'cargo_assets', title: 'Cargo Shared Assets', author: 'SomeMapper', kind: 'mod', size: 10 * MB, updatedAt: daysAgo(40), version: '1.0.0' },
        { id: 'town_reimagined', title: 'Town Reimagined', author: 'Another', kind: 'map', size: 0, updatedAt: daysAgo(2), version: '', comingSoon: true }
    ].map((item, index) => Object.assign({ subscribers: 0, comingSoon: false, changesGameFiles: false, requires: [] }, item, { preview: PREVIEWS[(index + 3) % PREVIEWS.length] }));

    function supports(game) {
        return CAPABILITIES[game] || null;
    }

    function mockCatalog(game) {
        const caps = supports(game);
        return caps && caps.steam ? WORKSHOP : INDEX;
    }

    function backendId(game) {
        return GameUtils.getGameMapping(game);
    }

    function catalogGame(game) {
        const caps = supports(game);
        return (caps && caps.catalogGame) || backendId(game);
    }

    async function workshopFetch(path, params) {
        const query = `${path}?${new URLSearchParams(params)}`;
        const api = window.__modsMock.workshopApi;
        const res = api
            ? await fetch(`${api}${query}`, { cache: 'no-store' })
            : await ServiceHosts.request('workshop', query, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    // Titles reach us exactly as the author wrote them, colour codes included; strip them for display.
    function clean(value) {
        return GameUtils.stripColorCodes(value);
    }

    async function getInstalled(game) {
        const mods = await window.executeCommand('get-installed-mods', { game: backendId(game) });
        if (!Array.isArray(mods)) return [];
        return mods.map(mod => Object.assign(mod, { name: clean(mod.name), author: clean(mod.author), description: clean(mod.description) }));
    }

    function searchMock(game, { query, kind, sort }) {
        const needle = query.trim().toLowerCase();
        const items = mockCatalog(game)
            .filter(item => (kind === 'all' || item.kind === kind)
                && (!needle || item.title.toLowerCase().includes(needle) || item.author.toLowerCase().includes(needle)))
            .sort((a, b) => {
                if (sort === 'recent') return new Date(b.updatedAt) - new Date(a.updatedAt);
                if (sort === 'name') return a.title.localeCompare(b.title);
                return b.subscribers - a.subscribers;
            })
            .map(item => Object.assign(clone(item), { title: clean(item.title), installed: false, updateAvailable: false }));

        return { items, total: items.length };
    }

    async function search(game, options) {
        const caps = supports(game);
        if (!caps || !caps.catalog) return { items: [], total: 0 };

        const opts = {
            query: String((options && options.query) || ''),
            kind: (options && options.kind) || 'all',
            sort: (options && options.sort) || 'popular',
            page: (options && options.page) || 1
        };

        if (PREVIEW_MODE && !window.__modsMock.workshopApi) {
            await delay();
            return searchMock(game, opts);
        }

        try {
            const params = { game: catalogGame(game), ...opts };
            const data = await workshopFetch('/v1/search', params);
            const items = (Array.isArray(data.items) ? data.items : [])
                .map(item => Object.assign(item, { title: clean(item.title), installed: false, updateAvailable: false }));
            return { items, total: Number(data.total) || items.length };
        } catch (error) {
            console.warn('Workshop search failed', error);
            return { items: [], total: 0, failed: true };
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
            if (job.phase === 'cancelled') return { success: false, cancelled: true };
            if (job.phase === 'error') throw new Error(job.error || 'The install failed.');
            return { success: true, name: job.name };
        }
    }

    async function install(game, item, onTick) {
        if (PREVIEW_MODE) {
            window.__modsMock.cancelled = false;
            for (let percent = 0; percent <= 100; percent += 5) {
                if (onTick) onTick({ phase: percent ? 'downloading' : 'preparing', percent, name: item.id });
                if (window.__modsMock.cancelled) return { success: false, cancelled: true };
                await delay(250);
            }
            return { success: true };
        }

        // Required items install alongside the item, like Steam's subscribe flow.
        // An unreachable worker degrades to installing the item alone. The mod
        // index installer resolves its own requirements.
        const caps = supports(game);
        if (caps && caps.steam && !Array.isArray(item.children)) {
            item.children = [];
            try {
                const detail = await getDetails(game, item.id);
                item.children = (Array.isArray(detail.children) ? detail.children : [])
                    .map(child => ({ id: String(child.id), size: Number(child.size) || 0 }));
            } catch (error) {
                console.warn('Could not resolve required items', error);
            }
        }

        const started = await window.executeCommand('install-workshop-mod', { game: backendId(game), id: item.id, size: item.size || 0, children: item.children });
        if (!started || !started.success) {
            const error = new Error((started && started.error) || 'Failed to start the install.');
            error.busy = !!(started && started.busy);
            throw error;
        }

        return pollJob(game, onTick);
    }

    function cancelInstall(game) {
        if (PREVIEW_MODE) window.__modsMock.cancelled = true;
        return window.executeCommand('cancel-mod-install', { game: backendId(game) });
    }

    async function getUpdatedTimes(game, ids) {
        if (PREVIEW_MODE || !ids.length) return {};
        try {
            return await workshopFetch('/v1/updated', { game: catalogGame(game), ids: ids.join(',') });
        } catch (error) {
            return {};
        }
    }

    // Mod index games: { id: version } for each listed id, compared against the version an install recorded.
    async function getVersions(game, ids) {
        if (!ids.length) return {};
        if (PREVIEW_MODE && !window.__modsMock.workshopApi) {
            return Object.fromEntries(INDEX.filter(item => ids.includes(item.id)).map(item => [item.id, item.version]));
        }
        try {
            return await workshopFetch('/v1/updated', { game: catalogGame(game), ids: ids.join(',') });
        } catch (error) {
            return {};
        }
    }

    // CDN-hosted overrides ({ workshopId: { version, size } }): these ids install
    // from our CDN instead of steamCMD, and their update state is version equality
    // against the hosted release rather than Steam's updated time.
    async function getOverrides(game) {
        const caps = supports(game);
        if (!caps || !caps.steam || PREVIEW_MODE) return {};
        try {
            const data = await window.executeCommand('get-mod-overrides', { game: backendId(game) });
            return data && typeof data === 'object' ? data : {};
        } catch (error) {
            return {};
        }
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

    function cleanDetail(detail) {
        detail.title = clean(detail.title);
        if (Array.isArray(detail.children)) {
            detail.children.forEach(child => child.title = clean(child.title));
        }
        return detail;
    }

    async function getDetails(game, id) {
        if (PREVIEW_MODE && !window.__modsMock.workshopApi) {
            await delay();
            const catalog = mockCatalog(game);
            const item = catalog.find(entry => entry.id === id);
            if (!item) throw new Error('Unknown item');
            const index = catalog === INDEX;
            const requires = index ? item.requires : (item.id === '2967301155' ? ['2750100123', '2840561120'] : []);
            return cleanDetail(Object.assign(clone(item), {
                description: '[h1]Preview[/h1]\nThis is placeholder detail text shown in UI preview mode.\n[b]Bold[/b], [i]italic[/i] and a [url=https://cbservers.xyz]link[/url].',
                children: requires.map(childId => catalog.find(entry => entry.id === childId)).filter(Boolean)
                    .map(child => ({ id: child.id, title: child.title, kind: child.kind, size: child.size })),
                screenshots: [],
                views: item.subscribers * 4,
                createdAt: Math.floor(new Date(item.updatedAt).getTime() / 1000) - 86400 * 200,
                updatedAt: Math.floor(new Date(item.updatedAt).getTime() / 1000),
                votes: index ? null : { score: 0.93, up: 1200, down: 90 }
            }));
        }

        return cleanDetail(await workshopFetch('/v1/item', { game: catalogGame(game), id }));
    }

    function getModsFolder(game, folder) {
        return window.executeCommand('get-mods-folder', { game: backendId(game), folder });
    }

    function getModFolder(game, id) {
        return window.executeCommand('get-mod-folder', { game: backendId(game), id });
    }

    window.ModsService = {
        CAPABILITIES,
        supports,
        getInstalled,
        search,
        getDetails,
        install,
        update: install,
        cancelInstall,
        getUpdatedTimes,
        getVersions,
        getOverrides,
        uninstall,
        importFolder: (game, path, onPhase) => importFromPath(game, path, 'folder', onPhase),
        importZip: (game, path, onPhase) => importFromPath(game, path, 'zip', onPhase),
        getModsFolder,
        getModFolder
    };
})();
