// Mod manager facade backed by mock data until native support exists.
// Each method maps to one future command (backend game id in payloads):
//   getInstalled    -> get-installed-mods { game }                    InstalledMod[]
//   search          -> workshop-search    { game, query, kind, sort } { items: WorkshopItem[], total }
//   getSteamStatus  -> steam-get-status   { game }                    { owned, loggedIn, username }
//   install/update  -> install-mod / update-mod { game, id }, progress polled via get-mod-progress { game }
//   uninstall       -> uninstall-mod      { game, id }                { success }
//   importFolder/Zip-> import-mod         { game, path, kind }        { success, mod }
//   getModsFolder   -> get-mods-folder    { game, folder }            path
//
// InstalledMod: { id, name, kind: 'map'|'mod', version, size, installedAt, updateAvailable, source: 'workshop'|'import', workshopId? }
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

    function installedMod(fields) {
        return Object.assign({
            version: '—',
            installedAt: new Date().toISOString(),
            updateAvailable: false,
            source: 'import'
        }, fields);
    }

    const INSTALLED = {
        boiii: [
            installedMod({ id: 'ws:2967301155', workshopId: '2967301155', name: 'Leviathan',           kind: 'map', version: '1.4', size: 1.9 * GB, installedAt: daysAgo(30), source: 'workshop' }),
            installedMod({ id: 'ws:2781201010', workshopId: '2781201010', name: 'Project Wunderwaffe', kind: 'mod', version: '2.1', size: 480 * MB, installedAt: daysAgo(20), source: 'workshop', updateAvailable: true }),
            installedMod({ id: 'local:zm_frost', name: 'zm_frost', kind: 'map', size: 620 * MB, installedAt: daysAgo(5) })
        ],
        t4: [
            installedMod({ id: 'local:nazi_zombie_kino', name: 'nazi_zombie_kino', kind: 'map', size: 310 * MB, installedAt: daysAgo(70) }),
            installedMod({ id: 'local:ugx_mod', name: 'UGX Mod 1.1', kind: 'mod', version: '1.1', size: 240 * MB, installedAt: daysAgo(69) })
        ],
        t5: [
            installedMod({ id: 'local:zm_sumpf_remake', name: 'zm_sumpf_remake', kind: 'map', size: 410 * MB, installedAt: daysAgo(14) })
        ],
        t6: [
            installedMod({ id: 'local:zm_buried_lite', name: 'zm_buried_lite', kind: 'map', size: 380 * MB, installedAt: daysAgo(9) }),
            installedMod({ id: 'local:zombie_reloaded', name: 'Zombie Reloaded', kind: 'mod', version: '0.9', size: 150 * MB, installedAt: daysAgo(3) })
        ]
    };

    function installedFor(game) {
        if (!INSTALLED[game]) INSTALLED[game] = [];
        return INSTALLED[game];
    }

    function findInstalled(game, predicate) {
        return installedFor(game).find(predicate) || null;
    }

    function upsertInstalled(game, mod) {
        const list = installedFor(game);
        const index = list.findIndex(entry => entry.id === mod.id);
        if (index >= 0) list.splice(index, 1);
        list.unshift(mod);
        return clone(mod);
    }

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

    async function getInstalled(game) {
        await delay(180);
        return clone(installedFor(game));
    }

    async function search(game, options) {
        const caps = supports(game);
        if (!caps || !caps.workshop) return { items: [], total: 0 };

        await delay();

        const query = String((options && options.query) || '').trim().toLowerCase();
        const kind = (options && options.kind) || 'all';
        const sort = (options && options.sort) || 'popular';

        const items = WORKSHOP
            .filter(item => (kind === 'all' || item.kind === kind)
                && (!query || item.title.toLowerCase().includes(query) || item.author.toLowerCase().includes(query)))
            .sort((a, b) => {
                if (sort === 'recent') return new Date(b.updatedAt) - new Date(a.updatedAt);
                if (sort === 'name') return a.title.localeCompare(b.title);
                return b.subscribers - a.subscribers;
            })
            .map(item => {
                const installed = findInstalled(game, mod => mod.workshopId === item.id);
                return Object.assign(clone(item), {
                    installed: !!installed,
                    updateAvailable: !!(installed && installed.updateAvailable)
                });
            });

        return { items, total: items.length };
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

        const existing = findInstalled(game, mod => mod.workshopId === workshopId);
        if (existing) return markUpdated(existing);

        return upsertInstalled(game, installedMod({
            id: 'ws:' + workshopId,
            workshopId,
            name: item.title,
            kind: item.kind,
            version: '1.0',
            size: item.size,
            source: 'workshop'
        }));
    }

    function markUpdated(mod) {
        mod.updateAvailable = false;
        mod.installedAt = new Date().toISOString();
        return clone(mod);
    }

    async function update(game, id, onTick) {
        const mod = findInstalled(game, entry => entry.id === id);
        if (!mod) throw new Error('Unknown mod ' + id);
        await runFakeTransfer(game, id, onTick);
        return markUpdated(mod);
    }

    async function uninstall(game, id) {
        await delay(250);
        const list = installedFor(game);
        const index = list.findIndex(entry => entry.id === id);
        if (index >= 0) list.splice(index, 1);
        return { success: index >= 0 };
    }

    async function importFromPath(game, path, kind) {
        await delay(kind === 'zip' ? 900 : 600);
        const name = String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/\.zip$/i, '') || 'imported_mod';
        const mod = upsertInstalled(game, installedMod({
            id: 'local:' + name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
            name,
            kind: /^(zm_|mp_|nazi_zombie_)/i.test(name) ? 'map' : 'mod',
            size: 300 * MB + Math.floor(Math.random() * 900 * MB),
            importKind: kind
        }));
        return { success: true, mod };
    }

    async function getModsFolder(game, folder) {
        let root = null;
        try {
            root = await window.executeCommand('get-game-property', {
                game: GameUtils.getGameMapping(game),
                suffix: PROPERTY_KEYS.GAME.INSTALL
            });
        } catch (error) {
            root = null;
        }
        return (root || 'C:\\Games\\' + game).replace(/[\\/]+$/, '') + '\\' + folder;
    }

    window.ModsService = {
        CAPABILITIES,
        supports,
        getInstalled,
        search,
        getSteamStatus,
        install,
        update,
        uninstall,
        importFolder: (game, path) => importFromPath(game, path, 'folder'),
        importZip: (game, path) => importFromPath(game, path, 'zip'),
        getModsFolder,
        onProgress
    };
})();
