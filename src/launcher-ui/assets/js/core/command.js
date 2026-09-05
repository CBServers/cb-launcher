const mockMods = {
    installed: {
        bo3: [
            { id: 'usermaps:zm_leviathan', name: '^1[ZM] ^3Leviathan', kind: 'map', folder: 'usermaps', source: 'workshop', version: '1.4', workshopId: '2967301155', installedAt: '2026-07-24T10:00:00Z', size: 2040109465 },
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

// Static-preview state for the CB Friends sub-tab and Community board.
const mockCb = {
    state: 'none', profile: null, recoveryCode: null,
    friends: { friends: [], incoming: [], outgoing: [] },
    lfg: [
        { cbId: 'cb_ally', handle: 'ally', displayName: 'Ally', avatarUrl: '', online: true, game: 'boiii', mode: 'zm', status: '', relation: 'none', note: 'need 2 for EE', slots: 3, joined: 1, iJoined: false },
        { cbId: 'cb_nova', handle: 'nova', displayName: 'Nova', avatarUrl: '', online: true, game: 'iw4x', mode: '', status: '', relation: 'none', note: '', slots: 0, joined: 0, iJoined: false }
    ],
    broadcast: { on: false, game: '', note: '', slots: 0 },
    chatRoom: '',
    chat: {
        all: [{ id: 1, cbId: 'cb_ally', handle: 'ally', displayName: 'Ally', accent: '#F3751B', text: 'anyone on tonight?' }],
        boiii: [{ id: 1, cbId: 'cb_nova', handle: 'nova', displayName: 'Nova', accent: '', text: 'running EE in 10' }]
    },
    viewedProfile: null,
    blocked: [],
    securityEvents: [],
    chatHeads: {},
    playedWith: [],
    dmConversations: [],
    dmMessages: [],
    dmPeer: '',
    modRole: '',
    modReports: [],
    modLog: [],
    modLookup: null
};
function mockPerson(handle, name, extra) {
    return Object.assign({ cbId: 'cb_' + handle, handle, displayName: name || handle, avatarUrl: '', online: false, game: '', mode: '', status: '', relation: '', note: '' }, extra || {});
}

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
            return { status: 'linked', profile: { id: '1', displayName: 'Preview', avatarUrl: '' }, error: null };
        case 'discord-get-friends':
            return { available: true, registryOk: true, joinable: true, friends: [
                { id: '2', displayName: 'Rook', avatarUrl: '', status: 'online', inLauncher: true, joinable: true, directJoin: true, openable: false, sameMatch: false, gameId: 'boiii', activityDetails: 'Black Ops 3 - Team Deathmatch on Nuketown', activityState: 'CB TDM 24/7' },
                { id: '3', displayName: 'Vex', avatarUrl: '', status: 'online', inLauncher: true, joinable: false, directJoin: false, openable: true, sameMatch: false, gameId: 'iw4x', activityDetails: 'Modern Warfare 2', activityState: 'In Menu' },
                { id: '4', displayName: 'Idle Ike', avatarUrl: '', status: 'idle', inLauncher: true, joinable: false, directJoin: false, openable: false, sameMatch: false, gameId: '', activityDetails: '', activityState: '' },
                { id: '5', displayName: 'Ghost', avatarUrl: '', status: 'offline', inLauncher: false, joinable: false, directJoin: false, openable: false, sameMatch: false, gameId: '', activityDetails: '', activityState: '' }
            ] };
        case 'discord-link':
        case 'discord-unlink':
            return { started: false };
        case 'cbfriends-get-status':
            return { state: mockCb.state, profile: mockCb.profile, error: null, hasRecoveryCode: !!mockCb.recoveryCode, joinable: !!(mockCb.presence && mockCb.presence.joinable), presence: mockCb.presence || { game: '' } };
        case 'cbfriends-create-profile':
            mockCb.state = 'ready';
            mockCb.profile = { cbId: 'cb_preview', handle: data.handle, displayName: data.displayName || data.handle, avatarUrl: '' };
            mockCb.recoveryCode = 'AB12-CD34-EF56-7890';
            mockCb.presence = { game: 'boiii', mode: 'mp', mapDisplay: 'Nuketown', gametype: 'Team Deathmatch', serverName: 'CB TDM 24/7', players: 9, maxPlayers: 18, joinable: true };
            mockCb.friends.incoming = [mockPerson('reaper', 'Reaper', { online: false, lastSeen: Date.now() - 3 * 3600 * 1000 })];
            mockCb.friends.friends = [
                mockPerson('nova', 'Nova', { online: true, game: 'boiii', mode: 'mp', mapDisplay: 'Nuketown', gametype: 'Team Deathmatch', serverName: 'CB TDM 24/7', players: 9, maxPlayers: 18, joinable: true, matchId: 'm1' }),
                mockPerson('ghost', 'Ghost', { online: false, lastSeen: Date.now() - 2 * 86400 * 1000 }),
                mockPerson('vex', 'Vex', { online: true, game: 'iw4x' }),
                mockPerson('idle', 'Idle Ike', { online: true })
            ];
            return { started: true };
        case 'cbfriends-get-recovery-code':
            return { code: mockCb.recoveryCode || null };
        case 'cbfriends-update-profile':
            if (mockCb.profile) {
                if (data.displayName) mockCb.profile.displayName = data.displayName;
                if (data.handle) mockCb.profile.handle = data.handle;
                mockCb.profile.bio = data.bio || '';
                mockCb.profile.accent = data.accent || '';
                mockCb.profile.favoriteGame = data.favoriteGame || '';
                if (typeof data.avatarUrl === 'string') mockCb.profile.avatarUrl = data.avatarUrl;
            }
            return { ok: true };
        case 'cbfriends-request-profile': {
            const pool = mockCb.lfg.concat(mockCb.friends.friends, mockCb.friends.incoming);
            const found = pool.find(p => p.cbId === data.cbId);
            mockCb.viewedProfile = found
                ? Object.assign({ bio: 'zombies main, EE runs nightly', accent: '#F3751B', favoriteGame: 'boiii', createdAt: 1750000000 }, found)
                : null;
            return { ok: true };
        }
        case 'cbfriends-get-viewed-profile':
            return { profile: mockCb.viewedProfile || null };
        case 'cbfriends-get-chat-heads':
            return { rooms: mockCb.chatHeads };
        case 'cbfriends-get-played-with':
            return { people: mockCb.playedWith };
        case 'cbfriends-get-dm-list':
            return { conversations: mockCb.dmConversations, unread: 0 };
        case 'cbfriends-get-dm':
            return { peer: mockCb.dmPeer, messages: mockCb.dmMessages };
        case 'cbfriends-set-dm-peer':
            mockCb.dmPeer = data && data.cbId;
            return { ok: true };
        case 'cbfriends-send-dm':
            return { ok: true };
        case 'cbfriends-mod-status':
            return { role: mockCb.modRole };
        case 'cbfriends-mod-get-reports':
            return { reports: mockCb.modReports };
        case 'cbfriends-mod-get-log':
            return { entries: mockCb.modLog };
        case 'cbfriends-mod-get-lookup':
            return { account: mockCb.modLookup };
        case 'cbfriends-set-mod-active':
        case 'cbfriends-mod-lookup':
        case 'cbfriends-mod-resolve':
        case 'cbfriends-mod-mute':
        case 'cbfriends-mod-set-role':
        case 'cbfriends-set-activity':
        case 'cbfriends-load-older-chat':
        case 'cbfriends-report':
        case 'cbfriends-show-person-notification':
        case 'cbfriends-show-invite-notification':
        case 'cbfriends-dismiss-invite-notification':
            return { ok: true };
        case 'cbfriends-block':
            mockCb.blocked.push(mockPerson('blocked' + mockCb.blocked.length, 'Blocked user'));
            return { ok: true };
        case 'cbfriends-unblock':
            mockCb.blocked = mockCb.blocked.filter(p => p.cbId !== data.cbId);
            return { ok: true };
        case 'cbfriends-get-blocked':
            return { blocked: mockCb.blocked };
        case 'cbfriends-get-security-events':
            return { events: mockCb.securityEvents };
        case 'cbfriends-get-invites':
            return { invites: mockCb.invites || [] };
        case 'cbfriends-invite-friend':
        case 'cbfriends-request-join':
        case 'cbfriends-accept-invite':
        case 'cbfriends-decline-invite':
            return { ok: true };
        case 'cbfriends-get-friends':
            return { friends: mockCb.friends.friends, incoming: mockCb.friends.incoming, outgoing: mockCb.friends.outgoing };
        case 'cbfriends-add-friend':
            mockCb.friends.outgoing.push(mockPerson(data.handle, data.handle));
            return { ok: true };
        case 'cbfriends-accept': {
            const i = mockCb.friends.incoming.findIndex(p => p.cbId === data.cbId);
            if (i >= 0) { const p = mockCb.friends.incoming.splice(i, 1)[0]; p.online = true; p.game = 'boiii'; mockCb.friends.friends.push(p); }
            return { ok: true };
        }
        case 'cbfriends-decline':
            mockCb.friends.incoming = mockCb.friends.incoming.filter(p => p.cbId !== data.cbId);
            return { ok: true };
        case 'cbfriends-cancel':
            mockCb.friends.outgoing = mockCb.friends.outgoing.filter(p => p.cbId !== data.cbId);
            return { ok: true };
        case 'cbfriends-remove':
            mockCb.friends.friends = mockCb.friends.friends.filter(p => p.cbId !== data.cbId);
            return { ok: true };
        case 'cbfriends-get-lfg':
            return { posts: mockCb.lfg.filter(p => !mockCb.lfgFilter || p.game === mockCb.lfgFilter) };
        case 'cbfriends-lfg-join': {
            const post = mockCb.lfg.find(p => p.cbId === data.cbId);
            if (post) { post.iJoined = true; post.joined = (post.joined || 0) + 1; }
            return { ok: true };
        }
        case 'cbfriends-set-lfg-filter':
            mockCb.lfgFilter = (data && data.game) || '';
            return { ok: true };
        case 'cbfriends-set-chat-room':
            mockCb.chatRoom = (data && data.room) || '';
            return { ok: true };
        case 'cbfriends-get-chat':
            return { messages: mockCb.chat[mockCb.chatRoom] || [], hasMore: false };
        case 'cbfriends-send-chat': {
            const list = mockCb.chat[data.room] || (mockCb.chat[data.room] = []);
            list.push({ id: list.length + 1, cbId: 'cb_preview', handle: 'divity', displayName: 'Divity', text: data.text });
            return { ok: true };
        }
        case 'cbfriends-get-broadcast':
            return mockCb.broadcast;
        case 'cbfriends-set-broadcast': {
            mockCb.broadcast = { on: !!(data && data.on), game: (data && data.game) || '', note: (data && data.note) || '', slots: (data && data.slots) || 0 };
            mockCb.lfg = mockCb.lfg.filter(p => p.relation !== 'self');
            if (mockCb.broadcast.on) {
                mockCb.lfg.push(Object.assign(mockPerson('divity', 'Divity', {
                    online: true, game: mockCb.broadcast.game, note: mockCb.broadcast.note,
                    slots: mockCb.broadcast.slots, joined: 0, iJoined: false
                }), { relation: 'self' }));
            }
            return { ok: true };
        }
        case 'cbfriends-post-lfg':
        case 'cbfriends-set-community-active':
            return { ok: true };
        case 'cbfriends-clear-lfg':
            mockCb.lfg = mockCb.lfg.filter(p => p.relation !== 'self');
            return { ok: true };
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
