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
                installProperty: 'bo3-install',
                isInstalledProperty: 'bo3-is-installed',
                isSteamInstallProperty: "bo3-is-steam-install",
                gameModeProperty: 'bo3-game-mode',
                defaultInstallPath: 'bo3_game_files',
                uiId: 'boiii',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: {
                    skipIntroCinematic: 'bo3-skip-intro-cinematic'
                },
                codeName: 'BOIII',
                iconPath: './img/boiii.png',
                heroImagePath: './img/boiii-hero.png'
            },
            'ghosts': {
                displayName: 'Ghosts',
                installProperty: 'ghosts-install',
                isInstalledProperty: 'ghosts-is-installed',
                isSteamInstallProperty: "ghosts-is-steam-install",
                gameModeProperty: 'ghosts-game-mode',
                defaultInstallPath: 'ghosts_game_files',
                uiId: 'iw6x',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp'],
                specialSettings: {},
                codeName: 'IW6X',
                iconPath: './img/iw6x.png',
                heroImagePath: './img/iw6x-hero.png'
            },
            'aw': {
                displayName: 'Advanced Warfare',
                installProperty: 'aw-install',
                isInstalledProperty: 'aw-is-installed',
                isSteamInstallProperty: "aw-is-steam-install",
                gameModeProperty: 'aw-game-mode',
                defaultInstallPath: 'aw_game_files',
                uiId: 's1x',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp', 'zm', 'sv'],
                specialSettings: {},
                codeName: 'S1X',
                iconPath: './img/s1x.png',
                heroImagePath: './img/s1x-hero.png'
            },
            'mwr': {
                displayName: 'Modern Warfare Remastered',
                installProperty: 'mwr-install',
                isInstalledProperty: 'mwr-is-installed',
                isSteamInstallProperty: "mwr-is-steam-install",
                gameModeProperty: 'mwr-game-mode',
                defaultInstallPath: 'mwr_game_files',
                uiId: 'h1-mod',
                hasMultipleModes: true,
                supportedModes: ['sp', 'mp'],
                specialSettings: {},
                codeName: 'H1-MOD',
                iconPath: './img/h1-mod.png',
                heroImagePath: './img/h1-mod-hero.png'
            },
            'iw': {
                displayName: 'Infinite Warfare',
                installProperty: 'iw-install',
                isInstalledProperty: 'iw-is-installed',
                isSteamInstallProperty: "iw-is-steam-install",
                gameModeProperty: 'iw-game-mode',
                defaultInstallPath: 'iw_game_files',
                uiId: 'iw7-mod',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: {},
                codeName: 'IW7-MOD',
                iconPath: './img/iw7-mod.png',
                heroImagePath: './img/iw7-mod-hero.png'
            },
            'hmw': {
                displayName: 'HorizonMW',
                installProperty: 'mwr-install',
                isInstalledProperty: 'hmw-is-installed',
                isSteamInstallProperty: "mwr-is-steam-install",
                gameModeProperty: 'hmw-game-mode',
                defaultInstallPath: 'mwr_game_files',
                uiId: 'hmw-mod',
                hasMultipleModes: false,
                supportedModes: [],
                specialSettings: {},
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
     * Get all reset properties for settings reset
     * @returns {object} Object with all game properties set to empty
     */
    static getResetProperties() {
        const properties = {};

        // Get all game configs and add their properties
        const games = ['bo3', 'ghosts', 'aw', 'mwr', 'iw', 'hmw'];

        games.forEach(game => {
            const config = this.getGameConfig(game);
            if (config) {
                properties[config.installProperty] = '';
                properties[config.isInstalledProperty] = '';
                properties[config.isSteamInstallProperty] = '';
                properties[config.gameModeProperty] = '';

                // Add special settings
                Object.values(config.specialSettings).forEach(settingKey => {
                    properties[settingKey] = '';
                });
            }
        });

        return properties;
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
}

// Make GameUtils available globally
window.GameUtils = GameUtils;