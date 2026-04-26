// Shared utility functions for the CB Servers Launcher

// Centralized property key constants
const PROPERTY_KEYS = {
    LAUNCHER: {
        RESTORE_LAST_PAGE: 'launcher-restore-last-page',
        SKIP_HASH_VERIFICATION: 'launcher-skip-hash-verification',
        CLOSE_ON_LAUNCH: 'launcher-close-on-launch',
        SKIP_CLIENT_UPDATE: 'launcher-skip-client-update',
        LANGUAGE: 'launcher-language',
        LAST_GAME_PAGE: 'last-game-page'
    },
    GAME: {
        INSTALL: 'install',
        IS_INSTALLED: 'is-installed',
        LAUNCH_OPTIONS: 'launch-options',
        GAME_MODE: 'game-mode',
        SKIP_INTRO_CINEMATIC: 'skip-intro-cinematic',
        DISABLE_CB_EXTENSION: 'disable-cb-extension',
        DETECTED_COMPONENTS: 'detected-components',
        SELECTED_COMPONENTS: 'selected-components'
    }
};

class GameUtils {
    // Single source of truth for game ID mappings (UI ID -> backend ID)
    static UI_TO_BACKEND_MAP = {
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
        'hmw-mod': 'hmw'
    };

    // Generated reverse mapping (backend ID -> UI ID)
    static BACKEND_TO_UI_MAP = Object.fromEntries(
        Object.entries(GameUtils.UI_TO_BACKEND_MAP).map(([ui, backend]) => [backend, ui])
    );

    static GAME_ORDER = ['t4', 'iw4x', 't5', 'iw5', 't6', 'boiii', 'iw6x', 's1x', 'h1-mod', 'iw7-mod', 'hmw-mod'];

    static GAME_CONFIGS = {
        't4': {
            displayName: 'Call of Duty: World at War',
            shortName: 'WaW',
            defaultInstallPath: 'waw_game_files',
            uiId: 't4',
            steamAppId: '10090',
            client: 'Plutonium',
            clientKey: 'plutonium',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: [],
            codeName: 'Plutonium T4',
            version: 'T4',
            localSize: '8.7 GB',
            installStateLabel: 'Ready to play',
            description: 'Call of Duty: World at War enhanced with Plutonium T4. Campaign, multiplayer and zombies stay close to the original game with modern stability patches.',
            credits: 'Campaign, Multiplayer, and Zombies are provided by the T4 client and developed by Plutonium.',
            accent: '#B94E14',
            assetBase: './assets/img/games/t4',
            iconPath: './assets/img/games/t4/capsule.jpg',
            capsulePath: './assets/img/games/t4/capsule.jpg',
            heroImagePath: './assets/img/games/t4/hero.jpg',
            logoPath: './assets/img/games/t4/logo.png'
        },
        't5': {
            displayName: 'Call of Duty: Black Ops',
            shortName: 'BO1',
            defaultInstallPath: 'bo1_game_files',
            uiId: 't5',
            steamAppId: '42700',
            client: 'Plutonium',
            clientKey: 'plutonium',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: [],
            codeName: 'Plutonium T5',
            version: 'T5',
            localSize: '12.4 GB',
            installStateLabel: 'Ready to play',
            description: 'Call of Duty: Black Ops enhanced with Plutonium T5. Campaign, multiplayer and zombies are grouped in one clean client flow.',
            credits: 'Campaign, Multiplayer, and Zombies are provided by the T5 client and developed by Plutonium.',
            accent: '#186AC6',
            assetBase: './assets/img/games/t5',
            iconPath: './assets/img/games/t5/capsule.jpg',
            capsulePath: './assets/img/games/t5/capsule.jpg',
            heroImagePath: './assets/img/games/t5/hero.jpg',
            logoPath: './assets/img/games/t5/logo.png'
        },
        'iw4x': {
            displayName: 'Call of Duty: Modern Warfare 2',
            shortName: 'MW2',
            defaultInstallPath: 'mw2_game_files',
            uiId: 'iw4x',
            steamAppId: '10180',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            specialSettings: [],
            codeName: 'IW4x / IW4-SP',
            version: 'IW4',
            localSize: '11.1 GB',
            installStateLabel: 'Ready to play',
            description: 'Modern Warfare 2 with IW4x multiplayer and IW4-SP support. Built for fast access to classic MW2 sessions and client maintenance.',
            credits: 'Multiplayer is provided by IW4x. Singleplayer is provided by IW4-SP and developed by AlterWare.',
            accent: '#FBC751',
            assetBase: './assets/img/games/iw4x',
            iconPath: './assets/img/games/iw4x/capsule.jpg',
            capsulePath: './assets/img/games/iw4x/capsule.jpg',
            heroImagePath: './assets/img/games/iw4x/hero.jpg',
            logoPath: './assets/img/games/iw4x/logo.png'
        },
        'iw5': {
            displayName: 'Call of Duty: Modern Warfare 3',
            shortName: 'MW3',
            defaultInstallPath: 'mw3_game_files',
            uiId: 'iw5',
            steamAppId: '115300',
            client: 'Plutonium / AlterWare',
            clientKey: 'plutonium',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            specialSettings: [],
            codeName: 'Plutonium IW5 / IW5-Mod',
            version: 'IW5',
            localSize: '14.2 GB',
            installStateLabel: 'Ready to play',
            description: 'Modern Warfare 3 with Plutonium multiplayer and IW5-Mod singleplayer support. Pick a mode only when the client actually needs it.',
            credits: 'Multiplayer is provided by Plutonium. Singleplayer is provided by IW5-Mod and developed by AlterWare.',
            accent: '#09FF00',
            assetBase: './assets/img/games/iw5',
            iconPath: './assets/img/games/iw5/capsule.jpg',
            capsulePath: './assets/img/games/iw5/capsule.jpg',
            heroImagePath: './assets/img/games/iw5/hero.jpg',
            logoPath: './assets/img/games/iw5/logo.png'
        },
        't6': {
            displayName: 'Call of Duty: Black Ops II',
            shortName: 'BO2',
            defaultInstallPath: 'bo2_game_files',
            uiId: 't6',
            steamAppId: '202970',
            client: 'Plutonium',
            clientKey: 'plutonium',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: [],
            codeName: 'Plutonium T6',
            version: 'T6',
            localSize: '15.8 GB',
            installStateLabel: 'Ready to play',
            featured: true,
            description: 'Black Ops II multiplayer and zombies through Plutonium T6, with client updates, verification and base-game linking handled from one detail view.',
            credits: 'Multiplayer and Zombies are provided by the T6 client and developed by Plutonium.',
            accent: '#FE890A',
            assetBase: './assets/img/games/t6',
            iconPath: './assets/img/games/t6/capsule.jpg',
            capsulePath: './assets/img/games/t6/capsule.jpg',
            heroImagePath: './assets/img/games/t6/hero.jpg',
            logoPath: './assets/img/games/t6/logo.png'
        },
        'bo3': {
            displayName: 'Call of Duty: Black Ops III',
            shortName: 'BO3',
            defaultInstallPath: 'bo3_game_files',
            uiId: 'boiii',
            steamAppId: '311210',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: ['skip-intro-cinematic'],
            codeName: 'BOIII',
            version: 'T7',
            localSize: '68.0 GB',
            installStateLabel: 'Update available',
            description: 'Black Ops III with BOIII client support for campaign, multiplayer and zombies. Includes client-specific settings such as intro-skip behavior.',
            credits: 'BOIII is a CB Servers fork of the original BOIII/T7x client developed by momo5502 and AlterWare.',
            accent: '#F3751B',
            assetBase: './assets/img/games/boiii',
            iconPath: './assets/img/games/boiii/capsule.jpg',
            capsulePath: './assets/img/games/boiii/capsule.jpg',
            heroImagePath: './assets/img/games/boiii/hero.jpg',
            logoPath: './assets/img/games/boiii/logo.png'
        },
        'ghosts': {
            displayName: 'Call of Duty: Ghosts',
            shortName: 'Ghosts',
            defaultInstallPath: 'ghosts_game_files',
            uiId: 'iw6x',
            steamAppId: '209160',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            specialSettings: [],
            codeName: 'IW6x',
            version: 'IW6',
            localSize: '31.4 GB',
            installStateLabel: 'Base game missing',
            description: 'Call of Duty: Ghosts with IW6x support for campaign and multiplayer. The launcher keeps install setup and client updates in the same place.',
            credits: 'IW6x is a CB Servers fork of the original IW6x/iw6-mod client developed by AlterWare.',
            accent: '#3B718C',
            assetBase: './assets/img/games/iw6x',
            iconPath: './assets/img/games/iw6x/capsule.jpg',
            capsulePath: './assets/img/games/iw6x/capsule.jpg',
            heroImagePath: './assets/img/games/iw6x/hero.jpg',
            logoPath: './assets/img/games/iw6x/logo.png'
        },
        'aw': {
            displayName: 'Call of Duty: Advanced Warfare',
            shortName: 'AW',
            defaultInstallPath: 'aw_game_files',
            uiId: 's1x',
            steamAppId: '209650',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp', 'zm', 'sv'],
            specialSettings: [],
            codeName: 'S1x',
            version: 'S1',
            localSize: '39.6 GB',
            installStateLabel: 'Ready to play',
            description: 'Advanced Warfare through S1x, with campaign, multiplayer, zombies and survival mode choices presented only when relevant.',
            credits: 'S1x is a CB Servers fork of the original S1x/s1-mod client developed by AlterWare.',
            accent: '#F9D406',
            assetBase: './assets/img/games/s1x',
            iconPath: './assets/img/games/s1x/capsule.jpg',
            capsulePath: './assets/img/games/s1x/capsule.jpg',
            heroImagePath: './assets/img/games/s1x/hero.jpg',
            logoPath: './assets/img/games/s1x/logo.png'
        },
        'mwr': {
            displayName: 'Call of Duty: Modern Warfare Remastered',
            shortName: 'MWR',
            defaultInstallPath: 'mwr_game_files',
            uiId: 'h1-mod',
            steamAppId: '393080',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: true,
            supportedModes: ['sp', 'mp'],
            specialSettings: [],
            codeName: 'H1-Mod',
            version: 'H1',
            localSize: '45.7 GB',
            installStateLabel: 'Ready to play',
            description: 'Modern Warfare Remastered with H1-Mod support. Campaign and multiplayer launch modes stay behind one focused client page.',
            credits: 'H1-Mod is a CB Servers fork of the original H1-Mod client developed by Aurora.',
            accent: '#46D744',
            assetBase: './assets/img/games/h1-mod',
            iconPath: './assets/img/games/h1-mod/capsule.png',
            capsulePath: './assets/img/games/h1-mod/capsule.png',
            heroImagePath: './assets/img/games/h1-mod/hero.png',
            logoPath: './assets/img/games/h1-mod/logo.png'
        },
        'iw': {
            displayName: 'Call of Duty: Infinite Warfare',
            shortName: 'IW',
            defaultInstallPath: 'iw_game_files',
            uiId: 'iw7-mod',
            steamAppId: '292730',
            client: 'AlterWare',
            clientKey: 'alterware',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: [],
            codeName: 'IW7-Mod',
            version: 'IW7',
            localSize: '61.9 GB',
            installStateLabel: 'Ready to play',
            description: 'Infinite Warfare with IW7-Mod support for campaign, multiplayer and zombies. Secondary actions stay close to install maintenance.',
            credits: 'IW7-Mod is a CB Servers fork of the original IW7-Mod client developed by Aurora.',
            accent: '#FFFFFF',
            assetBase: './assets/img/games/iw7-mod',
            iconPath: './assets/img/games/iw7-mod/capsule.jpg',
            capsulePath: './assets/img/games/iw7-mod/capsule.jpg',
            heroImagePath: './assets/img/games/iw7-mod/hero.jpg',
            logoPath: './assets/img/games/iw7-mod/logo.png'
        },
        'hmw': {
            displayName: 'HorizonMW',
            shortName: 'HMW',
            defaultInstallPath: 'mwr_game_files',
            uiId: 'hmw-mod',
            steamAppId: null,
            client: 'HorizonMW',
            clientKey: 'others',
            hasMultipleModes: false,
            supportedModes: [],
            specialSettings: [],
            codeName: 'HMW-Mod',
            version: 'HMW',
            localSize: '48.5 GB',
            installStateLabel: 'Ready to play',
            description: 'HorizonMW is a faithful community remaster of Modern Warfare 2 multiplayer with additional content inspired by MW3.',
            credits: 'HMW-Mod is a CB Servers fork of the original HorizonMW client.',
            accent: '#97838A',
            assetBase: './assets/img/games/hmw-mod',
            iconPath: './assets/img/games/hmw-mod/capsule.png',
            capsulePath: './assets/img/games/hmw-mod/capsule.png',
            heroImagePath: './assets/img/games/hmw-mod/hero.png',
            logoPath: './assets/img/games/hmw-mod/logo.png'
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
            }
        };
    }

    /**
     * Check if a game supports multiple modes
     * @param {string} game - The game identifier (backend ID)
     * @returns {boolean} True if game has multiple modes
     */
    static hasMultipleModes(game) {
        const config = this.getGameConfig(game);
        return config ? config.hasMultipleModes : false;
    }

    /**
     * Get supported modes for a game
     * @param {string} game - The game identifier (backend ID)
     * @returns {array} Array of supported mode strings
     */
    static getSupportedModes(game) {
        const config = this.getGameConfig(game);
        return config ? config.supportedModes : [];
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

        this.getAllGameConfigs().forEach(config => {
            images[config.uiId] = [
                config.iconPath,
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
     * Get capsule path for a UI game ID.
     * @param {string} uiId - The UI game identifier
     * @returns {string} Capsule path or null
     */
    static getCapsulePath(uiId) {
        const config = this.getGameConfigByUIId(uiId);
        return config ? config.capsulePath : null;
    }

    /**
     * Get transparent logo path for a UI game ID.
     * @param {string} uiId - The UI game identifier
     * @returns {string} Logo path or null
     */
    static getLogoPath(uiId) {
        const config = this.getGameConfigByUIId(uiId);
        return config ? config.logoPath : null;
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
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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
    static async trackCommandProgress(config) {
        const {
            gameId,
            command,
            commandArgs = {},
            initialMessage = 'Processing...',
            completeMessage = 'Complete!',
            onComplete = null,
            pollInterval = 100
        } = config;

        let pollIntervalId;

        const cancelOperation = () => {
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                console.log(`${command} cancelled`);
            }
            // Call backend to cancel the update
            window.executeCommand('cancel-update').then(() => {
                console.log('Cancel command sent to backend');
            }).catch(error => {
                console.error('Failed to send cancel command:', error);
            });
        };

        // Show progress bar
        window.ProgressManager.show(gameId, initialMessage, cancelOperation);

        try {
            // Start command and wait for it to initialize
            await window.executeCommand(command, commandArgs);
            console.log(`${command} command handler completed, starting polling`);

            // Poll for progress updates
            return new Promise((resolve, reject) => {
                pollIntervalId = setInterval(async () => {
                    try {
                        const result = await window.executeCommand('get-update-progress');

                        if (!result) {
                            console.log('No progress data received');
                            return;
                        }

                        if (!result.active) {
                            console.log(`${command} no longer active - operation complete`);
                            // Operation complete
                            clearInterval(pollIntervalId);
                            window.ProgressManager.update(100, completeMessage);

                            // Call completion callback if provided
                            if (onComplete) {
                                onComplete();
                            }

                            setTimeout(() => {
                                window.ProgressManager.hide();
                                resolve();
                            }, 1000);
                            return;
                        }

                        // Update progress
                        console.log(`Updating progress: ${result.message}, ${result.progress}`);
                        window.ProgressManager.update(result.progress, result.message);
                    } catch (error) {
                        console.error('Error polling progress:', error);
                        clearInterval(pollIntervalId);
                        window.ProgressManager.hide();
                        reject(error);
                    }
                }, pollInterval);
            });
        } catch (error) {
            console.error(`Failed to start ${command}:`, error);
            window.ProgressManager.hide();
            throw error;
        }
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

        // Build command arguments
        const commandArgs = { game: backendGame };
        if (mode) {
            commandArgs.mode = mode;
        }

        // Track launch progress
        return this.trackCommandProgress({
            gameId: uiGameId,
            command: 'launch-game',
            commandArgs: commandArgs,
            initialMessage: window.LauncherI18n
                ? window.LauncherI18n.t('progress.launching', { game: gameConfig.displayName })
                : `Launching ${gameConfig.displayName}...`,
            completeMessage: window.LauncherI18n ? window.LauncherI18n.t('progress.launchComplete') : 'Launch complete!'
        });
    }
}

// Make GameUtils available globally
window.GameUtils = GameUtils;
