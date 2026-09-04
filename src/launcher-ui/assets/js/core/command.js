const mockMods = {
    installed: {
        bo3: [
            { id: 'usermaps:zm_leviathan', name: 'Leviathan', kind: 'map', folder: 'usermaps', source: 'workshop', version: '1.4', workshopId: '2967301155', installedAt: '2026-07-24T10:00:00Z', size: 2040109465 },
            { id: 'mods:wunderwaffe', name: 'Project Wunderwaffe', kind: 'mod', folder: 'mods', source: 'workshop', version: '2.1', workshopId: '2781201010', installedAt: '2026-08-03T10:00:00Z', size: 503316480, updateAvailable: true },
            { id: 'usermaps:zm_frost', name: 'zm_frost', kind: 'map', folder: 'usermaps', source: 'import', version: '', workshopId: '', installedAt: '2026-08-18T10:00:00Z', size: 650117120 }
        ],
        t4: [
            { id: 'usermaps:nazi_zombie_kino', name: 'nazi_zombie_kino', kind: 'map', folder: 'usermaps', source: 'import', version: '', installedAt: '2026-06-14T10:00:00Z', size: 325058560 },
            { id: 'mods:ugx_mod', name: 'ugx_mod', kind: 'mod', folder: 'mods', source: 'import', version: '', installedAt: '2026-06-15T10:00:00Z', size: 251658240 }
        ],
        t5: [
            { id: 'mods:zm_sumpf_remake', name: 'zm_sumpf_remake', kind: 'mod', folder: 'mods', source: 'import', version: '', installedAt: '2026-08-09T10:00:00Z', size: 429916160 }
        ],
        t6: [
            { id: 'usermaps:zm_buried_lite', name: 'zm_buried_lite', kind: 'map', folder: 'usermaps', source: 'import', version: '', installedAt: '2026-08-14T10:00:00Z', size: 398458880 },
            { id: 'mods:zombie_reloaded', name: 'zombie_reloaded', kind: 'mod', folder: 'mods', source: 'import', version: '', installedAt: '2026-08-20T10:00:00Z', size: 157286400 }
        ]
    },
    job: null
};

function mockModImport(data) {
    const name = String(data.path).replace(/[\\/]+$/, '').split(/[\\/]/).pop().replace(/\.zip$/i, '');
    const kind = /^(zm_|mp_|nazi_zombie_)/i.test(name) ? 'map' : 'mod';
    const folder = kind === 'map' ? 'usermaps' : 'mods';
    const list = mockMods.installed[data.game] || (mockMods.installed[data.game] = []);
    list.unshift({ id: `${folder}:${name}`, name, kind, folder, source: 'import', version: '', installedAt: new Date().toISOString(), size: 314572800 });
    mockMods.job = { active: true, phase: data.kind === 'zip' ? 'extracting' : 'copying', name, error: '', ticks: 4 };
    return { success: true };
}

function mockCommand(command, data) {
    console.log("Mock executeCommand:", command, data || null);

    switch (command) {
        case 'get-channel':
            return 'main';
        case 'get-property':
            return null;
        case 'get-game-property':
            return data && data.suffix === PROPERTY_KEYS.GAME.IS_INSTALLED ? 'false' : '';
        case 'is-game-running':
            return false;
        case 'get-cdn-servers':
            return {
                preference: 'auto',
                recommended: 'eu',
                servers: [
                    { region: 'na', latency: 124 },
                    { region: 'eu', latency: 18 }
                ]
            };
        case 'test-cdn-latency':
            return {
                success: true,
                preference: 'auto',
                recommended: 'eu',
                servers: [
                    { region: 'na', latency: 124 },
                    { region: 'eu', latency: 18 }
                ]
            };
        case 'get-version':
            return {
                version: 'UI preview',
                versionFile: 'UI preview',
                gitHash: '00000000',
                gitBranch: 'preview'
            };
        case 'get-update-progress':
            return { active: false, progress: 100, message: 'Complete' };
        case 'discord-get-status':
            return { status: 'unlinked', profile: null, error: null };
        case 'discord-get-friends':
            return { available: false, registryOk: true, friends: [] };
        case 'discord-link':
        case 'discord-unlink':
            return { started: false };
        case 'browse-folder':
            return 'C:\\Users\\preview\\Downloads\\zm_example_map';
        case 'browse-file':
            return 'C:\\Users\\preview\\Downloads\\zm_example_zip.zip';
        case 'get-mods-folder':
            return `C:\\Games\\${data.game}\\${data.folder}`;
        case 'get-installed-mods':
            return (mockMods.installed[data.game] || []).map(mod => Object.assign({}, mod));
        case 'import-mod':
            return mockModImport(data);
        case 'get-mod-progress':
            if (!mockMods.job) return { active: false, phase: '', name: '', error: '' };
            if (mockMods.job.ticks-- <= 0) mockMods.job.active = false;
            if (!mockMods.job.active) mockMods.job.phase = 'done';
            return mockMods.job;
        case 'uninstall-mod': {
            const list = mockMods.installed[data.game] || [];
            const index = list.findIndex(mod => mod.id === data.id);
            if (index >= 0) list.splice(index, 1);
            return { success: index >= 0 };
        }
        case 'ping-servers':
            return {};
        case 'join-server':
            return { success: true };
        case 'open-folder':
        case 'open-url':
            return true;
        default:
            return null;
    }
}

function isStaticPreviewError(error) {
    return window.location.protocol === 'file:' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost' ||
        error.name === 'SyntaxError';
}

window.executeCommand = function(command, data) {
    if (window.location.protocol === 'file:' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === 'localhost') {
        return Promise.resolve(mockCommand(command, data));
    }

    var object = {
        command: command,
        data: data || null,
    };

    return fetch("/command", {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(object)
    }).then(response => {
        if (!response.ok) {
            throw new Error(`Command endpoint returned ${response.status}`);
        }
        return response.json();
    }).catch(error => {
        if (isStaticPreviewError(error)) {
            return mockCommand(command, data);
        }
        throw error;
    });
};
