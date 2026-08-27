// Shared utility functions for the CB Servers Launcher

// Centralized property key constants
const PROPERTY_KEYS = {
    LAUNCHER: {
        SKIP_HASH_VERIFICATION: 'launcher-skip-hash-verification',
        CLOSE_ON_LAUNCH: 'launcher-close-on-launch',
        SKIP_CLIENT_UPDATE: 'launcher-skip-client-update',
        SKIP_REDIST_CHECK: 'launcher-skip-redist-check',
        LANGUAGE: 'launcher-language',
        THEME: 'launcher-theme',
        GLOBAL_PLAYER_NAME: 'launcher-global-player-name',
        CDN_CUSTOM_URL: 'launcher-cdn-custom-url',
        PINNED_GAMES: 'launcher-pinned-games',
        CB_COMMUNITY_ENABLED: 'launcher-cb-community-enabled',
            DESKTOP_NOTIFICATIONS: 'launcher-desktop-notifications',
        REDUCE_MOTION: 'launcher-reduce-motion'
    },
    GAME: {
        INSTALL: 'install',
        IS_INSTALLED: 'is-installed',
        LAUNCH_OPTIONS: 'launch-options',
        GAME_MODE: 'game-mode',
        SELECTED_CLIENT_PREFIX: 'selected-client-',
        SKIP_INTRO_CINEMATIC: 'skip-intro-cinematic',
        LAUNCH_ADMIN: 'launch-admin',
        DISABLE_CB_EXTENSION: 'disable-cb-extension',
        DETECTED_COMPONENTS: 'detected-components',
        SELECTED_COMPONENTS: 'selected-components',
        PLAYER_NAME_OVERRIDE: 'player-name-override',
        CUSTOM_RESOLUTION_ENABLED: 'custom-resolution-enabled',
        CUSTOM_RESOLUTION_WIDTH: 'custom-resolution-width',
        CUSTOM_RESOLUTION_HEIGHT: 'custom-resolution-height'
    }
};

class GameUtils {
    // Single source of truth for game ID mappings (UI ID -> backend ID)
    static UI_TO_BACKEND_MAP = {
        'cod1': 'cod1',
        'coduo': 'coduo',
        'cod2x': 'cod2x',
        'cod4x': 'cod4x',
        't4': 't4',
        't5': 't5',
        'iw4x': 'iw4x',
        'iw5': 'iw5',
        't6': 't6',
        'boiii': 'bo3',
        'iw6x': 'ghosts',
        's1x': 'aw',
        'h1-mod': 'mwr',
        'iw7-mod': 'iw',
        'bo4': 'bo4',
        'mw2r': 'mw2r',
        'hmw-mod': 'hmw'
    };

    // Generated reverse mapping (backend ID -> UI ID)
    static BACKEND_TO_UI_MAP = Object.fromEntries(
        Object.entries(GameUtils.UI_TO_BACKEND_MAP).map(([ui, backend]) => [backend, ui])
    );

    static GAME_ORDER = ['cod1', 'coduo', 'cod2x', 'cod4x', 't4', 'iw4x', 't5', 'iw5', 't6', 'iw6x', 's1x', 'boiii', 'iw7-mod', 'h1-mod', 'bo4', 'mw2r', 'hmw-mod'];

    // Friendly aliases accepted by the -launch CLI arg (alias -> UI ID).
    // Covers common CoD names that don't already match a UI ID or backend key.
    static LAUNCH_ARG_ALIASES = {
        'cod4': 'cod4x',
        'waw': 't4',
        'mw2': 'iw4x',
        'bo1': 't5',
        'mw3': 'iw5',
        'bo2': 't6',
        'cod2': 'cod2x'
    };

    static GAME_CONFIGS = {
        'cod4x': {
            displayName: 'Modern Warfare',
            shortName: 'COD4',
            defaultInstallPath: 'cod4_game_files',
            uiId: 'cod4x',
            client: 'IW3x / CoD4x / IW3SP-Mod',
            provider: 'COD4R Project / CoD4x Project / IW3SP-Mod',
            clientKey: 'others',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            // Modes served by more than one client; first entry is the default when no
            // selection is saved, and the choice persists via selected-client-<mode>.
            modeClients: {
                'mp': [
                    { id: 'iw3x', name: 'IW3x' },
                    { id: 'cod4x', name: 'CoD4x' }
                ]
            },
            supportsName: true,
            specialSettings: [],
            version: 'IW3',
            description: 'COD4: Modern Warfare with a choice of IW3x or COD4x multiplayer and IW3SP-Mod for singleplayer. Built for classic MW1 sessions and modern client maintenance.',
            credits: 'Multiplayer is provided by <a href="https://iw3x.com/" target="_blank">IW3x</a>, developed by <a href="https://github.com/Divity" target="_blank">Divity</a>, or by CoD4x. Singleplayer is provided by IW3SP-Mod and developed by JerryALT.',
            accent: '#46D744',
            assetBase: './assets/img/games/cod4x',
            iconPath: './assets/img/games/cod4x/icon.ico',
            capsulePath: './assets/img/games/cod4x/capsule.jpg',
            heroImagePath: './assets/img/games/cod4x/hero.jpg',
            logoPath: './assets/img/games/cod4x/logo.png'
        },
        't4': {
            displayName: 'World at War',
            shortName: 'WaW',
            defaultInstallPath: 'waw_game_files',
            uiId: 't4',
            client: 'T4',
            provider: 'Plutonium',
            clientKey: 'plutonium',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp', 'zm'],
            supportsName: false,
            specialSettings: [],
            version: 'T4',
            description: 'World at War enhanced with Plutonium T4. Campaign, multiplayer and zombies stay close to the original game with modern stability patches.',
            credits: 'Campaign, Multiplayer, and Zombies are provided by the T4 client and developed by Plutonium.',
            accent: '#B94E14',
            assetBase: './assets/img/games/t4',
            iconPath: './assets/img/games/t4/icon.ico',
            capsulePath: './assets/img/games/t4/capsule.jpg',
            heroImagePath: './assets/img/games/t4/hero.jpg',
            logoPath: './assets/img/games/t4/logo.png'
        },
        't5': {
            displayName: 'Black Ops',
            shortName: 'BO1',
            defaultInstallPath: 'bo1_game_files',
            uiId: 't5',
            client: 'T5',
            provider: 'Plutonium',
            clientKey: 'plutonium',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp', 'zm'],
            supportsName: false,
            specialSettings: [],
            version: 'T5',
            description: 'Black Ops enhanced with Plutonium T5. Campaign, multiplayer and zombies are grouped in one clean client flow.',
            credits: 'Campaign, Multiplayer, and Zombies are provided by the T5 client and developed by Plutonium.',
            accent: '#186AC6',
            assetBase: './assets/img/games/t5',
            iconPath: './assets/img/games/t5/icon.ico',
            capsulePath: './assets/img/games/t5/capsule.jpg',
            heroImagePath: './assets/img/games/t5/hero.jpg',
            logoPath: './assets/img/games/t5/logo.png'
        },
        'iw4x': {
            displayName: 'Modern Warfare 2',
            shortName: 'MW2',
            defaultInstallPath: 'mw2_game_files',
            uiId: 'iw4x',
            client: 'IW4x / IW4-SP',
            provider: 'IW4x Project / AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            supportsName: true,
            specialSettings: [],
            version: 'IW4',
            description: 'Modern Warfare 2 with IW4x multiplayer and IW4-SP support. Built for fast access to classic MW2 sessions and client maintenance.',
            credits: 'Multiplayer is provided by IW4x. Singleplayer is provided by IW4-SP and developed by AlterWare.',
            accent: '#FBC751',
            assetBase: './assets/img/games/iw4x',
            iconPath: './assets/img/games/iw4x/icon.ico',
            capsulePath: './assets/img/games/iw4x/capsule.jpg',
            heroImagePath: './assets/img/games/iw4x/hero.jpg',
            logoPath: './assets/img/games/iw4x/logo.png'
        },
        'iw5': {
            displayName: 'Modern Warfare 3',
            shortName: 'MW3',
            defaultInstallPath: 'mw3_game_files',
            uiId: 'iw5',
            client: 'IW5 / IW5-Mod',
            provider: 'Plutonium / AlterWare',
            clientKey: 'plutonium',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            supportsName: true,
            specialSettings: [],
            version: 'IW5',
            description: 'Modern Warfare 3 with Plutonium multiplayer and IW5-Mod singleplayer support. Pick a mode only when the client actually needs it.',
            credits: 'Multiplayer is provided by Plutonium. Singleplayer is provided by IW5-Mod and developed by AlterWare.',
            accent: '#09FF00',
            assetBase: './assets/img/games/iw5',
            iconPath: './assets/img/games/iw5/icon.ico',
            capsulePath: './assets/img/games/iw5/capsule.jpg',
            heroImagePath: './assets/img/games/iw5/hero.jpg',
            logoPath: './assets/img/games/iw5/logo.png'
        },
        't6': {
            displayName: 'Black Ops 2',
            shortName: 'BO2',
            defaultInstallPath: 'bo2_game_files',
            uiId: 't6',
            client: 'T6 / T6SP-Mod',
            provider: 'Plutonium / T6SP-Mod',
            clientKey: 'plutonium',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp', 'zm'],
            supportsName: false,
            specialSettings: [],
            version: 'T6',
            featured: true,
            description: 'Black Ops 2 campaign, multiplayer and zombies through Plutonium T6 and T6SP-Mod, with client updates, verification and base-game linking handled from one detail view.',
            credits: 'Multiplayer and Zombies are provided by the T6 client and developed by Plutonium. Singleplayer is provided by T6SP-Mod and developed by Rattpak.',
            accent: '#FE890A',
            assetBase: './assets/img/games/t6',
            iconPath: './assets/img/games/t6/icon.ico',
            capsulePath: './assets/img/games/t6/capsule.jpg',
            heroImagePath: './assets/img/games/t6/hero.jpg',
            logoPath: './assets/img/games/t6/logo.png'
        },
        'bo3': {
            displayName: 'Black Ops 3',
            shortName: 'BO3',
            defaultInstallPath: 'bo3_game_files',
            uiId: 'boiii',
            client: 'BOIII',
            provider: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: false,
            supportedModes: [],
            supportsName: true,
            specialSettings: ['skip-intro-cinematic'],
            version: 'T7',
            description: 'Black Ops 3 with BOIII client support for campaign, multiplayer and zombies. Includes client-specific settings such as intro-skip behavior.',
            credits: 'BOIII is a CB Servers fork of the original BOIII/T7x client developed by momo5502 and AlterWare.',
            accent: '#F3751B',
            assetBase: './assets/img/games/boiii',
            iconPath: './assets/img/games/boiii/icon.ico',
            capsulePath: './assets/img/games/boiii/capsule.jpg',
            heroImagePath: './assets/img/games/boiii/hero.jpg',
            logoPath: './assets/img/games/boiii/logo.png'
        },
        'ghosts': {
            displayName: 'Ghosts',
            shortName: 'Ghosts',
            defaultInstallPath: 'ghosts_game_files',
            uiId: 'iw6x',
            client: 'IW6x',
            provider: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            supportsName: true,
            specialSettings: [],
            version: 'IW6',
            description: 'Ghosts with IW6x support for campaign and multiplayer. The launcher keeps install setup and client updates in the same place.',
            credits: 'IW6x is a CB Servers fork of the original IW6x/iw6-mod client developed by AlterWare.',
            accent: '#3B718C',
            assetBase: './assets/img/games/iw6x',
            iconPath: './assets/img/games/iw6x/icon.ico',
            capsulePath: './assets/img/games/iw6x/capsule.jpg',
            heroImagePath: './assets/img/games/iw6x/hero.jpg',
            logoPath: './assets/img/games/iw6x/logo.png'
        },
        'aw': {
            displayName: 'Advanced Warfare',
            shortName: 'AW',
            defaultInstallPath: 'aw_game_files',
            uiId: 's1x',
            client: 'S1x',
            provider: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp', 'zm', 'sv'],
            supportsName: true,
            specialSettings: [],
            version: 'S1',
            description: 'Advanced Warfare through S1x, with campaign, multiplayer, zombies and survival mode choices presented only when relevant.',
            credits: 'S1x is a CB Servers fork of the original S1x/s1-mod client developed by AlterWare.',
            accent: '#F9D406',
            assetBase: './assets/img/games/s1x',
            iconPath: './assets/img/games/s1x/icon.ico',
            capsulePath: './assets/img/games/s1x/capsule.jpg',
            heroImagePath: './assets/img/games/s1x/hero.jpg',
            logoPath: './assets/img/games/s1x/logo.png'
        },
        'mwr': {
            displayName: 'Modern Warfare Remastered',
            shortName: 'MWR',
            defaultInstallPath: 'mwr_game_files',
            uiId: 'h1-mod',
            client: 'H1-Mod',
            provider: 'Aurora',
            clientKey: 'aurora',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            supportsName: true,
            specialSettings: [],
            version: 'H1',
            description: 'Modern Warfare Remastered with H1-Mod support. Campaign and multiplayer launch modes stay behind one focused client page.',
            credits: 'H1-Mod is a CB Servers fork of the original H1-Mod client developed by Aurora.',
            accent: '#46D744',
            assetBase: './assets/img/games/h1-mod',
            iconPath: './assets/img/games/h1-mod/icon.ico',
            capsulePath: './assets/img/games/h1-mod/capsule.jpg',
            heroImagePath: './assets/img/games/h1-mod/hero.jpg',
            logoPath: './assets/img/games/h1-mod/logo.png'
        },
        'iw': {
            displayName: 'Infinite Warfare',
            shortName: 'IW',
            defaultInstallPath: 'iw_game_files',
            uiId: 'iw7-mod',
            client: 'IW7-Mod',
            provider: 'Aurora',
            clientKey: 'aurora',
            hasMultipleModes: false,
            supportedModes: [],
            supportsName: true,
            specialSettings: [],
            version: 'IW7',
            description: 'Infinite Warfare with IW7-Mod support for campaign, multiplayer and zombies. Secondary actions stay close to install maintenance.',
            credits: 'IW7-Mod is a CB Servers fork of the original IW7-Mod client developed by Aurora.',
            accent: '#FFFFFF',
            assetBase: './assets/img/games/iw7-mod',
            iconPath: './assets/img/games/iw7-mod/icon.ico',
            capsulePath: './assets/img/games/iw7-mod/capsule.jpg',
            heroImagePath: './assets/img/games/iw7-mod/hero.jpg',
            logoPath: './assets/img/games/iw7-mod/logo.png'
        },
        'bo4': {
            displayName: 'Black Ops 4',
            shortName: 'BO4',
            defaultInstallPath: 'bo4_game_files',
            uiId: 'bo4',
            client: 'Project BO4',
            provider: 'Project BO4',
            clientKey: 'others',
            hasMultipleModes: true,
            supportedModes: ['on', 'off'],
            supportsName: true,
            specialSettings: [],
            version: 'T8',
            description: 'Black Ops 4 with Project BO4 Launcher. Includes online and offline modes for multiplayer and zombies.',
            credits: 'Online and offline play are provided by Project BO4 Launcher, maintained by NotNierPea.',
            accent: '#FE890A',
            assetBase: './assets/img/games/bo4',
            iconPath: './assets/img/games/bo4/icon.ico',
            capsulePath: './assets/img/games/bo4/capsule.jpg',
            heroImagePath: './assets/img/games/bo4/hero.jpg',
            logoPath: './assets/img/games/bo4/logo.png'
        },
        'mw2r': {
            displayName: 'Modern Warfare 2 Campaign Remastered',
            shortName: 'MW2CR',
            defaultInstallPath: 'mw2r_game_files',
            uiId: 'mw2r',
            client: 'H2-Mod',
            provider: 'H2-Mod',
            clientKey: 'others',
            hasMultipleModes: false,
            supportedModes: [],
            supportsName: false,
            specialSettings: [],
            version: 'H2',
            description: 'Modern Warfare 2 Campaign Remastered with H2-Mod support. Run the remastered MW2 campaign with stability and quality-of-life patches.',
            credits: 'MW2 Campaign Remastered support is provided by H2-Mod, developed by Alice.',
            accent: '#FBC751',
            assetBase: './assets/img/games/h2-mod',
            iconPath: './assets/img/games/h2-mod/icon.ico',
            capsulePath: './assets/img/games/h2-mod/capsule.jpg',
            heroImagePath: './assets/img/games/h2-mod/hero.jpg',
            logoPath: './assets/img/games/h2-mod/logo.png'
        },
        'hmw': {
            displayName: 'HorizonMW',
            shortName: 'HMW',
            defaultInstallPath: 'mwr_game_files',
            uiId: 'hmw-mod',
            client: 'HMW-Mod',
            provider: 'HorizonMW',
            clientKey: 'others',
            hasMultipleModes: false,
            supportedModes: [],
            supportsName: true,
            specialSettings: [],
            version: 'HMW',
            description: 'HorizonMW is a faithful community remaster of Modern Warfare 2 multiplayer with additional content inspired by MW3.',
            credits: 'HMW-Mod is a CB Servers fork of the original HorizonMW client.',
            accent: '#97838A',
            assetBase: './assets/img/games/hmw-mod',
            iconPath: './assets/img/games/hmw-mod/icon.ico',
            capsulePath: './assets/img/games/hmw-mod/capsule.jpg',
            heroImagePath: './assets/img/games/hmw-mod/hero.jpg',
            logoPath: './assets/img/games/hmw-mod/logo.png'
        },
        'cod1': {
            displayName: 'Call of Duty',
            shortName: 'CoD',
            defaultInstallPath: 'cod1_game_files',
            uiId: 'cod1',
            client: 'CoD1 v1.1 / CoD1.1x',
            provider: 'COD.PM / CoDExtended',
            clientKey: 'others',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            modeClients: {
                'mp': [
                    { id: 'cod1', name: 'Vanilla' },
                    { id: 'cod1x', name: 'CoD1.1x' }
                ]
            },
            supportsName: true,
            specialSettings: [],
            version: '1.1',
            description: 'Call of Duty (2003) running on the original v1.1 game, with a choice of vanilla or CoD1.1x multiplayer. Jump straight into the classic World War II campaign and multiplayer from one launcher page.',
            credits: 'Game files for the base v1.1 game are provided by <a href="https://cod.pm/" target="_blank">cod.pm</a>. The CoD1.1x multiplayer client is developed by <a href="https://github.com/PrawyCoD1" target="_blank">Prawy</a> (<a href="https://github.com/xtnded/codextended-client" target="_blank">CoDExtended</a>).',
            accent: '#93a8bc',
            assetBase: './assets/img/games/cod1',
            iconPath: './assets/img/games/cod1/icon.ico',
            capsulePath: './assets/img/games/cod1/capsule.jpg',
            heroImagePath: './assets/img/games/cod1/hero.jpg',
            logoPath: './assets/img/games/cod1/logo.png'
        },
        'coduo': {
            displayName: 'United Offensive',
            shortName: 'UO',
            defaultInstallPath: 'coduo_game_files',
            uiId: 'coduo',
            client: 'CoDUO v1.51 / CoDUO1.51x',
            provider: 'COD.PM / CoDExtended',
            clientKey: 'others',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            modeClients: {
                'mp': [
                    { id: 'coduo', name: 'Vanilla' },
                    { id: 'coduox', name: 'CoDUO1.51x' }
                ]
            },
            supportsName: true,
            specialSettings: [],
            version: '1.51',
            description: 'Call of Duty: United Offensive running on the v1.51 game, with a choice of vanilla or CoDUO1.51x multiplayer. The classic UO expansion with new campaigns, weapons and vehicle-based multiplayer, ready to play.',
            credits: 'Game files for the base v1.51 game are provided by <a href="https://cod.pm/" target="_blank">cod.pm</a>. The CoDUO1.51x multiplayer client is developed by <a href="https://github.com/PrawyCoD1" target="_blank">Prawy</a> (<a href="https://github.com/xtnded/codextended-client-uo" target="_blank">CoDExtended</a>).',
            accent: '#ededec',
            assetBase: './assets/img/games/coduo',
            iconPath: './assets/img/games/coduo/icon.ico',
            capsulePath: './assets/img/games/coduo/capsule.png',
            heroImagePath: './assets/img/games/coduo/hero.jpg',
            logoPath: './assets/img/games/coduo/logo.png'
        },
        'cod2x': {
            displayName: 'Call of Duty 2',
            shortName: 'CoD2',
            defaultInstallPath: 'cod2_game_files',
            uiId: 'cod2x',
            client: 'CoD2x',
            provider: 'CoD2x',
            clientKey: 'others',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            supportsName: true,
            requiresElevation: true,
            specialSettings: [],
            version: '1.3',
            description: 'Call of Duty 2 enhanced with the CoD2x client on top of the v1.3 game. Modern fixes and quality-of-life improvements for classic COD2 multiplayer.',
            credits: 'CoD2x is developed by Yctn and eyza. Learn more at <a href="https://cod2x.me/" target="_blank">cod2x.me</a>.',
            accent: '#fadb9f',
            assetBase: './assets/img/games/cod2x',
            iconPath: './assets/img/games/cod2x/icon.ico',
            capsulePath: './assets/img/games/cod2x/capsule.jpg',
            heroImagePath: './assets/img/games/cod2x/hero.jpg',
            logoPath: './assets/img/games/cod2x/logo.png'
        }
    };

    /**
     * Get comprehensive game configuration
     * @param {string} game - The game identifier (backend ID like 'bo3', 'aw', etc.)
     * @returns {object} Complete game configuration object
     */
    static getGameConfig(game) {
        return this.GAME_CONFIGS[game] || null;
    }

    /**
     * Get game configuration by UI ID (boiii, s1x, etc.)
     * @param {string} uiId - The UI game identifier
     * @returns {object} Complete game configuration object
     */
    static getGameConfigByUIId(uiId) {
        const backendId = this.UI_TO_BACKEND_MAP[uiId] || uiId;
        return this.getGameConfig(backendId);
    }

    static isComingSoon(uiId) {
        const config = this.getGameConfigByUIId(uiId);
        return !!(config && config.comingSoon);
    }

    /**
     * Get the game mapping (UI ID to backend ID)
     * @param {string} gameId - The UI game identifier
     * @returns {string} The backend game identifier
     */
    static getGameMapping(gameId) {
        return this.UI_TO_BACKEND_MAP[gameId] || gameId;
    }

    /**
     * Get the UI ID from backend ID (reverse mapping)
     * @param {string} backendId - The backend game identifier (bo3, ghosts, etc.)
     * @returns {string} The UI game identifier (boiii, iw6x, etc.)
     */
    static getUIIdFromBackendId(backendId) {
        return this.BACKEND_TO_UI_MAP[backendId] || backendId;
    }

    /**
     * Get mode information with display names and descriptions
     * @returns {object} Mode information object
     */
    static getModeInfo() {
        const i18n = window.LauncherI18n;

        return {
            'sp': {
                name: i18n ? i18n.t('mode.sp.name') : 'Singleplayer',
                description: i18n ? i18n.t('mode.sp.description') : 'Play the campaign'
            },
            'mp': {
                name: i18n ? i18n.t('mode.mp.name') : 'Multiplayer',
                description: i18n ? i18n.t('mode.mp.description') : 'Play online with others'
            },
            'sv': {
                name: i18n ? i18n.t('mode.sv.name') : 'Survival',
                description: i18n ? i18n.t('mode.sv.description') : 'Survive against waves of enemies'
            },
            'zm': {
                name: i18n ? i18n.t('mode.zm.name') : 'Zombies',
                description: i18n ? i18n.t('mode.zm.description') : 'Fight hordes of zombies'
            },
            'on': {
                name: i18n ? i18n.t('mode.on.name') : 'Online',
                description: i18n ? i18n.t('mode.on.description') : 'Play online with others'
            },
            'off': {
                name: i18n ? i18n.t('mode.off.name') : 'Offline',
                description: i18n ? i18n.t('mode.off.description') : 'Play offline against bots or alone'
            }
        };
    }

    /**
     * Get every game config in UI display order.
     * @returns {array} Ordered game configuration objects
     */
    static getAllGameConfigs() {
        return this.GAME_ORDER
            .map(uiId => this.getGameConfigByUIId(uiId))
            .filter(Boolean);
    }

    /**
     * Get the configured featured game, falling back to the first game.
     * @returns {object|null} Game configuration
     */
    static getFeaturedGame() {
        return this.getAllGameConfigs().find(config => config.featured) || this.getAllGameConfigs()[0] || null;
    }

    /**
     * Get all game images for preloading
     * @returns {object} Object with gameId as key and array of image paths as value
     */
    static getAllGameImages() {
        const images = {};

        // iconPath (.ico) is deliberately excluded: the sidebar <img> tags load those on their own.
        this.getAllGameConfigs().forEach(config => {
            images[config.uiId] = [
                config.capsulePath,
                config.heroImagePath,
                config.logoPath
            ].filter(Boolean);
        });

        // Add home page image
        images['home'] = ['./assets/img/brand/cb-hero.png'];

        return images;
    }

    /**
     * Get icon path for a UI game ID
     * @param {string} uiId - The UI game identifier
     * @returns {string} Icon path or null
     */
    static getIconPath(uiId) {
        const config = this.getGameConfigByUIId(uiId);
        return config ? config.iconPath : null;
    }

    /**
     * Get hero image path for a UI game ID
     * @param {string} uiId - The UI game identifier
     * @returns {string} Hero image path or null
     */
    static getHeroImagePath(uiId) {
        const config = this.getGameConfigByUIId(uiId);
        return config ? config.heroImagePath : null;
    }

    /**
     * Get all game UI IDs
     * @returns {array} Array of all game UI identifiers
     */
    static getAllGameIds() {
        return this.GAME_ORDER.slice();
    }

    /**
     * Get all game-specific active CSS classes
     * @returns {array} Array of active class names for all games
     */
    static getGameActiveClasses() {
        return this.getAllGameIds().map(id => `${id}-active`);
    }

    /**
     * Format bytes into human-readable format
     * @param {number} bytes - Number of bytes
     * @returns {string} Formatted string (e.g., "1.5 GB")
     */
    static escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static formatCount(value) {
        if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(value);
    }

    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    static formatSpeed(bytesPerSec) {
        if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
        return GameUtils.formatBytes(bytesPerSec) + '/s';
    }

    static formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '';

        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;

        if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
        if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
        return `${s}s`;
    }

    /**
     * Track progress of a backend command with polling
     * @param {object} config - Configuration object
     * @param {string} config.gameId - UI game ID (for progress bar theming)
     * @param {string} config.command - Backend command name
     * @param {object} config.commandArgs - Arguments to pass to command
     * @param {string} config.initialMessage - Initial progress message
     * @param {string} config.completeMessage - Completion message
     * @param {function} config.onComplete - Optional callback when complete
     * @param {number} config.pollInterval - Poll interval in ms (default: 100)
     * @returns {Promise} Promise that resolves when operation completes
     */
    static inferQueueOp(command) {
        switch (command) {
            case 'verify-game': return 'verify';
            case 'delete-game': return 'uninstall';
            case 'launch-game': return 'launch';
            default: return command;
        }
    }

    static opBlocksGameButtons(op) {
        return op === 'verify' || op === 'install' || op === 'uninstall';
    }

    static async trackCommandProgress(config) {
        const {
            gameId,
            command,
            commandArgs = {},
            initialMessage = 'Processing...',
            completeMessage = 'Complete!',
            onComplete = null,
            pollInterval = 100,
            op,
            blocksGameButtons
        } = config;

        const resolvedOp = op || GameUtils.inferQueueOp(command);
        const resolvedBlocks = (blocksGameButtons !== undefined)
            ? !!blocksGameButtons
            : GameUtils.opBlocksGameButtons(resolvedOp);

        const runFn = (registerCancel) => new Promise((resolve, reject) => {
            let pollIntervalId;
            let cancelRequested = false;
            let lastBytes = 0, lastTime = 0, emaSpeed = 0; // bytes, ms, bytes/sec
            let startTime = 0, startBytes = 0;             // ms, bytes (download-start baseline)

            const cancelOperation = async () => {
                cancelRequested = true;
                if (pollIntervalId) {
                    clearInterval(pollIntervalId);
                    pollIntervalId = null;
                }
                window.ProgressManager.hide();
                try {
                    await window.executeCommand('cancel-update');
                } catch (error) {
                    console.error('Failed to send cancel command:', error);
                }
                // Poll until the worker actually unwinds before resolving so the
                // queue doesn't advance and reset() before cancellation lands.
                const start = Date.now();
                const cancelTimeoutMs = 5000;
                while (Date.now() - start < cancelTimeoutMs) {
                    try {
                        const status = await window.executeCommand('get-update-progress');
                        if (!status || !status.active) break;
                    } catch (_) { break; }
                    await new Promise(r => setTimeout(r, 100));
                }
                resolve();
            };

            registerCancel(cancelOperation);

            window.ProgressManager.show(gameId, initialMessage, cancelOperation);

            window.executeCommand(command, commandArgs)
                .then(() => {
                    console.log(`${command} command handler completed, starting polling`);
                    if (cancelRequested) return;

                    pollIntervalId = setInterval(async () => {
                        if (cancelRequested) {
                            clearInterval(pollIntervalId);
                            pollIntervalId = null;
                            return;
                        }
                        try {
                            const result = await window.executeCommand('get-update-progress');

                            if (!result) {
                                return;
                            }

                            if (!result.active) {
                                clearInterval(pollIntervalId);
                                pollIntervalId = null;
                                emaSpeed = 0;
                                window.ProgressManager.update(100, completeMessage);

                                if (onComplete) {
                                    try { onComplete(); } catch (cbErr) { console.error('onComplete error:', cbErr); }
                                }

                                setTimeout(() => {
                                    window.ProgressManager.hide();
                                    resolve();
                                }, 1000);
                                return;
                            }

                            // Paused: keep the bar alive at the current percent, just relabel.
                            // Reset the rate so a resumed download re-measures from scratch.
                            if (result.paused) {
                                emaSpeed = 0;
                                lastTime = 0;
                                startTime = 0;
                                const pausedMsg = window.LauncherI18n
                                    ? window.LauncherI18n.t('downloads.statusPausedAt', { percent: Number(result.progress || 0).toFixed(2) })
                                    : `Paused — ${Number(result.progress || 0).toFixed(2)}%`;
                                window.ProgressManager.update(result.progress, pausedMsg, null);
                                return;
                            }

                            // Speed/ETA from byte deltas — only while actually downloading. Verify/delete
                            // also report byte totals, but their "speed" is disk throughput, not a download.
                            let stats = null;
                            const downloaded = Number(result.downloadedBytes) || 0;
                            const total = Number(result.totalBytes) || 0;
                            if (total > 0 && result.mode === 'downloading') {
                                const now = Date.now();

                                // Live, smoothed speed for the MB/s readout.
                                if (lastTime === 0) {
                                    lastTime = now;
                                    lastBytes = downloaded;
                                } else {
                                    const dt = (now - lastTime) / 1000;
                                    if (dt >= 0.25 && downloaded >= lastBytes) {
                                        const inst = (downloaded - lastBytes) / dt;
                                        emaSpeed = emaSpeed ? emaSpeed * 0.7 + inst * 0.3 : inst;
                                        lastBytes = downloaded;
                                        lastTime = now;
                                    }
                                }

                                // Cumulative average (since start) for a smoothly counting-down ETA.
                                if (startTime === 0) {
                                    startTime = now;
                                    startBytes = downloaded;
                                }
                                const elapsed = (now - startTime) / 1000;
                                const avgSpeed = elapsed > 0 ? (downloaded - startBytes) / elapsed : 0;
                                const etaSeconds = avgSpeed > 0 ? (total - downloaded) / avgSpeed : null;

                                stats = { speed: emaSpeed, etaSeconds };
                            } else {
                                // Leaving the download phase (verify/retry) — re-baseline so the next
                                // download phase measures from scratch instead of a stale offset.
                                lastTime = 0;
                                startTime = 0;
                                emaSpeed = 0;
                            }

                            window.ProgressManager.update(result.progress, result.message, stats);
                        } catch (error) {
                            console.error('Error polling progress:', error);
                            clearInterval(pollIntervalId);
                            pollIntervalId = null;
                            window.ProgressManager.hide();
                            reject(error);
                        }
                    }, pollInterval);
                })
                .catch(error => {
                    console.error(`Failed to start ${command}:`, error);
                    window.ProgressManager.hide();
                    reject(error);
                });
        });

        const queue = window.DownloadQueueManager;
        if (!queue) {
            console.warn('DownloadQueueManager unavailable, running command directly');
            return runFn(() => {});
        }

        return queue.enqueue({
            gameId,
            op: resolvedOp,
            command,
            commandArgs,
            blocksGameButtons: resolvedBlocks,
            initialMessage,
            completeMessage,
            runFn
        });
    }

    static expandMissingToPackageIds(missingGroups) {
        const ids = [];
        for (const g of (missingGroups || [])) {
            const archs = (g.archs && g.archs.length) ? g.archs : [''];
            for (const arch of archs) {
                ids.push(arch ? `${g.group_id}_${arch}` : g.group_id);
            }
        }
        return ids;
    }

    static computeRedistAggregate(state, scopeIds) {
        const all = (state && state.packages) || [];
        const packages = (scopeIds && scopeIds.length) ? all.filter(p => scopeIds.includes(p.id)) : all;
        if (packages.length === 0) return { percent: 0, currentName: null };
        const done = packages.filter(p => p.status === 'completed' || p.status === 'installed').length;
        const current = packages.find(p => p.status === 'downloading' || p.status === 'installing');
        const currentPct = current ? (current.status === 'installing' ? 100 : (current.progress || 0)) : 0;
        const percent = Math.min(100, ((done * 100) + currentPct) / packages.length);
        return { percent, currentName: current ? current.name : null };
    }

    static async installRedistsWithProgressBar(missingGroups, uiGameId) {
        const t = (k, vars) => window.LauncherI18n ? window.LauncherI18n.t(k, vars) : k;

        if (!await window.guardOnline()) return false;

        const scopeIds = this.expandMissingToPackageIds(missingGroups);

        let initial;
        try { initial = await window.executeCommand('get-redist-progress'); }
        catch (e) { initial = null; }

        const alreadyRunning = !!(initial && initial.running);

        if (!alreadyRunning) {
            if (scopeIds.length === 0) return true;
            try { await window.executeCommand('install-redist', { ids: scopeIds }); }
            catch (e) { console.error('install-redist failed', e); return false; }
        }

        window.ProgressManager.show(uiGameId, t('installer.installingComponents'), null);

        return new Promise((resolve) => {
            const finish = (success) => {
                if (pollId) clearInterval(pollId);
                window.ProgressManager.hide();
                resolve(success);
            };

            const tick = async () => {
                let state;
                try { state = await window.executeCommand('get-redist-progress'); }
                catch (e) { console.error('get-redist-progress failed', e); finish(false); return; }
                if (!state) return;

                const { percent, currentName } = this.computeRedistAggregate(state, scopeIds);
                const msg = currentName ? t('installer.installingNamed', { name: currentName }) : t('installer.installingComponents');
                window.ProgressManager.update(percent, msg);

                if (state.running === false) {
                    const failed = (state.packages || []).some(p => p.status === 'failed');
                    finish(!failed);
                }
            };

            tick();
            const pollId = setInterval(tick, 500);
        });
    }

    /**
     * Launch a game with optional mode, handling path validation and progress
     * @param {string} backendGame - Backend game ID (bo3, ghosts, etc.)
     * @param {string} uiGameId - UI game ID (boiii, iw6x, etc.) for progress bar
     * @param {string|null} mode - Game mode (sp, mp, zm, sv) or null for default
     * @returns {Promise} Promise that resolves when launch completes
     */
    static async launchGameWithMode(backendGame, uiGameId, mode = null) {
        const gameConfig = this.getGameConfig(backendGame);
        if (!gameConfig) {
            console.error(`No configuration found for game: ${backendGame}`);
            throw new Error('Game configuration not found');
        }

        // Guard against launching while another game is updating (singleton progress_tracker).
        const queue = window.DownloadQueueManager;
        if (queue && queue.isAnyBlockingActive() && !queue.isBusy(uiGameId)) {
            const i18n = window.LauncherI18n;
            const title = i18n ? i18n.t('errors.cannotLaunchTitle') : 'Cannot launch right now';
            const body = i18n ? i18n.t('errors.cannotLaunchBody') : 'Another game is currently updating. Please wait for it to finish or cancel it before launching a different game.';
            if (typeof window.showMessageBox === 'function') {
                window.showMessageBox(title, body, [i18n ? i18n.t('common.ok') : 'OK']);
            }
            throw new Error('Another game is updating');
        }

        // Check if game install path is configured
        const folder = await window.executeCommand('get-game-property', {
            game: backendGame,
            suffix: PROPERTY_KEYS.GAME.INSTALL
        });

        if (!folder) {
            const gameName = gameConfig.displayName;
            const i18n = window.LauncherI18n;
            if (typeof window.showMessageBox === 'function') {
                window.showMessageBox(
                    i18n ? i18n.t('errors.gameNotConfiguredTitle', { game: gameName }) : `${gameName} not configured`,
                    i18n ? i18n.t('errors.gameNotConfiguredBody', { game: gameName }) : `You have not configured your ${gameName} installation path.`,
                    [i18n ? i18n.t('common.ok') : 'OK']
                );
            } else {
                alert(`${gameName} installation path not configured.`);
            }
            throw new Error('Installation path not configured');
        }

        // Hard mode gate: single choke point for the popup, deep links, -launch and library tiles.
        // Fails open when no valid detection cache exists.
        if (mode) {
            let gate = null;
            try { gate = await window.executeCommand('get-game-mode-availability', { game: backendGame }); }
            catch (e) { console.error('get-game-mode-availability failed', e); }

            const modeInfo = gate && gate.gated && gate.modes ? gate.modes[mode] : null;
            if (modeInfo && modeInfo.available === false) {
                const i18n = window.LauncherI18n;
                const tr = (k, vars) => i18n ? i18n.t(k, vars) : k;
                const modeName = (this.getModeInfo()[mode] || {}).name || mode.toUpperCase();
                const choice = typeof window.showMessageBox === 'function'
                    ? await window.showMessageBox(
                        tr('errors.modeNotInstalledTitle', { mode: modeName }),
                        tr('errors.modeNotInstalledBody', { game: gameConfig.displayName, mode: modeName }),
                        [tr('common.install'), tr('common.cancel')])
                    : 1;
                if (choice === 0 && typeof window.showManageInstall === 'function') {
                    window.showManageInstall(uiGameId, { preselectComponents: modeInfo.missingComponents || [] });
                }
                return;
            }
        }

        let skipRedistCheck = false;
        try {
            skipRedistCheck = (await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.SKIP_REDIST_CHECK)) === 'true';
        } catch (e) { /* treat as false */ }

        if (!skipRedistCheck) {
            let missingResp = null;
            try { missingResp = await window.executeCommand('get-missing-redists-for-game', { game: backendGame }); }
            catch (e) { console.error('get-missing-redists-for-game failed', e); }

            const missing = (missingResp && missingResp.missing) || [];
            if (missing.length > 0) {
                const result = window.LaunchRedistModal
                    ? await window.LaunchRedistModal.show(missing, gameConfig.displayName)
                    : { action: 'cancel' };
                if (!result || result.action === 'cancel') return;

                if (result.action === 'skip') {
                    if (result.dontAskAgain) {
                        try {
                            await window.executeCommand('set-property', {
                                [PROPERTY_KEYS.LAUNCHER.SKIP_REDIST_CHECK]: 'true'
                            });
                        } catch (e) { console.error('set-property skip-redist-check failed', e); }
                    }
                } else {
                    const ok = await GameUtils.installRedistsWithProgressBar(missing, uiGameId);
                    if (!ok) {
                        const i18n = window.LauncherI18n;
                        if (typeof window.showToast === 'function') {
                            window.showToast(i18n ? i18n.t('installer.redistInstallFailed') : 'Failed to install required components.', 'error', 6000);
                        }
                        return;
                    }
                }
            }
        }

        // Build command arguments
        const commandArgs = { game: backendGame };
        if (mode) {
            commandArgs.mode = mode;
        }

        // Track launch progress
        const result = await this.trackCommandProgress({
            gameId: uiGameId,
            command: 'launch-game',
            commandArgs: commandArgs,
            initialMessage: window.LauncherI18n
                ? window.LauncherI18n.t('progress.launching', { game: gameConfig.displayName })
                : `Launching ${gameConfig.displayName}...`,
            completeMessage: window.LauncherI18n ? window.LauncherI18n.t('progress.launchComplete') : 'Launch complete!'
        });

        if (window.GameStateManager && typeof window.GameStateManager.markGameLaunched === 'function') {
            window.GameStateManager.markGameLaunched(uiGameId);
        }

        return result;
    }
}

// Make GameUtils available globally
window.GameUtils = GameUtils;

// Offline-mode guard for any network action (verify/download/update).
// Returns true if the action may proceed; false if blocked. If the user
// chooses to go online, relaunches the launcher without -offline.
window.guardOnline = async function guardOnline() {
    if (!window.IS_OFFLINE) return true;

    const t = (k) => window.LauncherI18n ? window.LauncherI18n.t(k) : k;
    if (typeof window.showMessageBox !== 'function') return false;

    const choice = await window.showMessageBox(
        t('offline.blockTitle'),
        t('offline.blockBody'),
        [t('offline.relaunchOnline'), t('common.cancel')]
    );

    if (choice === 0) {
        try { await window.executeCommand('relaunch-online'); } catch (_) {}
    }
    return false;
};
