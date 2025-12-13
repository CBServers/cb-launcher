// Shared utility functions for the CB Servers Launcher

class GameUtils {
    /**
     * Get comprehensive game configuration
     * @param {string} game - The game identifier (backend ID like 'bo3', 'aw', etc.)
     * @returns {object} Complete game configuration object
     */
    static getGameConfig(game) {
        const configs = {
            'bo3': {
                displayName: 'Black Ops 3',
                defaultInstallPath: 'bo3_game_files',
                uiId: 'boiii',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: ['skip-intro-cinematic'],
                codeName: 'BOIII',
                iconPath: './img/boiii.png',
                heroImagePath: './img/boiii-hero.png'
            },
            'ghosts': {
                displayName: 'Ghosts',
                defaultInstallPath: 'ghosts_game_files',
                uiId: 'iw6x',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp'],
                specialSettings: [],
                codeName: 'IW6X',
                iconPath: './img/iw6x.png',
                heroImagePath: './img/iw6x-hero.png'
            },
            'aw': {
                displayName: 'Advanced Warfare',
                defaultInstallPath: 'aw_game_files',
                uiId: 's1x',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp', 'zm', 'sv'],
                specialSettings: [],
                codeName: 'S1X',
                iconPath: './img/s1x.png',
                heroImagePath: './img/s1x-hero.png'
            },
            'mwr': {
                displayName: 'Modern Warfare Remastered',
                defaultInstallPath: 'mwr_game_files',
                uiId: 'h1-mod',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp'],
                specialSettings: [],
                codeName: 'H1-MOD',
                iconPath: './img/h1-mod.png',
                heroImagePath: './img/h1-mod-hero.png'
            },
            'iw': {
                displayName: 'Infinite Warfare',
                defaultInstallPath: 'iw_game_files',
                uiId: 'iw7-mod',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: [],
                codeName: 'IW7-MOD',
                iconPath: './img/iw7-mod.png',
                heroImagePath: './img/iw7-mod-hero.png'
            },
            'hmw': {
                displayName: 'HorizonMW',
                defaultInstallPath: 'mwr_game_files',
                uiId: 'hmw-mod',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: [],
                codeName: 'HMW-MOD',
                iconPath: './img/hmw-mod.png',
                heroImagePath: './img/hmw-mod-hero.png'
            }
        };
        return configs[game] || null;
    }

    /**
     * Get game configuration by UI ID (boiii, s1x, etc.)
     * @param {string} uiId - The UI game identifier
     * @returns {object} Complete game configuration object
     */
    static getGameConfigByUIId(uiId) {
        const mapping = {
            'boiii': 'bo3',
            'iw6x': 'ghosts',
            's1x': 'aw',
            'h1-mod': 'mwr',
            'iw7-mod': 'iw',
            'hmw-mod': 'hmw'
        };
        const backendId = mapping[uiId] || uiId;
        return this.getGameConfig(backendId);
    }

    /**
     * Get the game mapping (UI ID to backend ID)
     * @param {string} gameId - The UI game identifier
     * @returns {string} The backend game identifier
     */
    static getGameMapping(gameId) {
        const mapping = {
            'boiii': 'bo3',
            'iw6x': 'ghosts',
            's1x': 'aw',
            'h1-mod': 'mwr',
            'iw7-mod': 'iw',
            'hmw-mod': 'hmw'
        };
        return mapping[gameId] || gameId;
    }

    /**
     * Get the UI ID from backend ID (reverse mapping)
     * @param {string} backendId - The backend game identifier (bo3, ghosts, etc.)
     * @returns {string} The UI game identifier (boiii, iw6x, etc.)
     */
    static getUIIdFromBackendId(backendId) {
        const reverseMapping = {
            'bo3': 'boiii',
            'ghosts': 'iw6x',
            'aw': 's1x',
            'mwr': 'h1-mod',
            'iw': 'iw7-mod',
            'hmw': 'hmw-mod'
        };
        return reverseMapping[backendId] || backendId;
    }

    /**
     * Get mode information with display names and descriptions
     * @returns {object} Mode information object
     */
    static getModeInfo() {
        return {
            'sp': {
                name: 'Singleplayer',
                description: 'Play the campaign'
            },
            'mp': {
                name: 'Multiplayer',
                description: 'Play online with others'
            },
            'sv': {
                name: 'Survival',
                description: 'Survive against waves of enemies'
            },
            'zm': {
                name: 'Zombies',
                description: 'Fight hordes of zombies'
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
     * Get all game images for preloading
     * @returns {object} Object with gameId as key and array of image paths as value
     */
    static getAllGameImages() {
        const images = {};
        const games = ['bo3', 'ghosts', 'aw', 'mwr', 'iw', 'hmw'];

        games.forEach(game => {
            const config = this.getGameConfig(game);
            if (config) {
                images[config.uiId] = [config.iconPath, config.heroImagePath];
            }
        });

        // Add home page image
        images['home'] = ['./img/cb-hero.png'];

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
        return ['boiii', 'iw6x', 's1x', 'h1-mod', 'iw7-mod', 'hmw-mod'];
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
            suffix: 'install'
        });

        if (!folder) {
            const gameName = gameConfig.displayName;
            if (typeof window.showMessageBox === 'function') {
                window.showMessageBox(
                    `${gameName} not configured`,
                    `You have not configured your ${gameName} installation path.`,
                    ["Ok"]
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
            initialMessage: `Launching ${gameConfig.displayName}...`,
            completeMessage: 'Launch complete!'
        });
    }
}

// Make GameUtils available globally
window.GameUtils = GameUtils;