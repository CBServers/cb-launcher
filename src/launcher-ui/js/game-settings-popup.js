class GameSettingsPopup {
    constructor() {
        this.popup = null;
        this.backdrop = null;
        this.currentGame = null;
        this.gameConfig = null;
        this.createPopup();
    }

    createPopup() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'game-settings-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'game-settings-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3 id="settings-title">Game Settings</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="settings-section">
                    <h4>Installation Path</h4>
                    <div class="setting-item">
                        <label id="path-label">Game Installation Folder:</label>
                        <div class="input-group">
                            <input type="text" id="game-path" placeholder="Select installation folder..." readonly />
                            <button id="browse-btn" class="browse-button">Browse</button>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h4>Play Button Behavior</h4>
                    <div class="setting-item">
                        <label for="play-behavior-select">When the Play button is clicked, launch:</label>
                        <select id="play-behavior-select" class="behavior-dropdown">
                            <option value="ask">Ask me every time</option>
                            <option value="sp">Singleplayer</option>
                            <option value="mp">Multiplayer</option>
                        </select>
                    </div>
                </div>

                <div class="popup-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-save">Save Settings</button>
                </div>
            </div>
        `;

        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.bindEvents();
    }

    bindEvents() {
        const closeBtn = this.popup.querySelector('.popup-close');
        const cancelBtn = this.popup.querySelector('.btn-cancel');
        const saveBtn = this.popup.querySelector('.btn-save');
        const browseBtn = this.popup.querySelector('#browse-btn');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
        saveBtn.addEventListener('click', () => this.handleSave());
        browseBtn.addEventListener('click', () => this.handleBrowse());

        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.hide();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible()) {
                this.hide();
            }
        });
    }

    async show(game, gameConfig) {
        this.currentGame = game;
        this.gameConfig = gameConfig;

        // Update the UI with game-specific information
        this.popup.querySelector('#settings-title').textContent = `${gameConfig.displayName} Settings`;
        this.popup.querySelector('#path-label').textContent = `${gameConfig.displayName} Installation Folder:`;

        // Load current settings
        await this.loadCurrentSettings();

        this.backdrop.style.display = 'flex';
    }

    hide() {
        this.backdrop.style.display = 'none';
    }

    isVisible() {
        return this.backdrop.style.display === 'flex';
    }

    async loadCurrentSettings() {
        if (typeof window.executeCommand === 'function') {
            try {
                // Load installation path
                const installPath = await window.executeCommand('get-property', this.gameConfig.installProperty);
                this.popup.querySelector('#game-path').value = installPath || '';

                // Load play behavior preference
                const behaviorKey = `game-mode-${this.currentGame}`;
                const savedBehavior = await window.executeCommand('get-property', behaviorKey);

                const behaviorSelect = this.popup.querySelector('#play-behavior-select');
                if (savedBehavior && savedBehavior !== '') {
                    behaviorSelect.value = savedBehavior;
                } else {
                    // No saved preference means "ask every time"
                    behaviorSelect.value = 'ask';
                }
            } catch (error) {
                console.error('Failed to load current settings:', error);
            }
        }
    }

    async handleBrowse() {
        if (typeof window.executeCommand === 'function') {
            try {
                const folder = await window.executeCommand('browse-folder');
                if (folder) {
                    this.popup.querySelector('#game-path').value = folder;
                }
            } catch (error) {
                console.error('Failed to browse for folder:', error);
            }
        }
    }

    async handleSave() {
        const installPath = this.popup.querySelector('#game-path').value;
        const selectedBehavior = this.popup.querySelector('#play-behavior-select').value;

        if (typeof window.executeCommand === 'function') {
            try {
                const properties = {};

                // Save installation path
                if (installPath) {
                    properties[this.gameConfig.installProperty] = installPath;
                }

                // Save play behavior preference
                const behaviorKey = `game-mode-${this.currentGame}`;
                if (selectedBehavior === 'ask') {
                    // For "ask every time", we remove the saved preference
                    // This will make the game mode popup show up
                    properties[behaviorKey] = '';
                } else {
                    // For specific modes, save the preference
                    properties[behaviorKey] = selectedBehavior;
                }

                await window.executeCommand('set-property', properties);

                this.hide();
            } catch (error) {
                console.error('Failed to save settings:', error);
                if (typeof window.showMessageBox === 'function') {
                    window.showMessageBox("✗ Save Failed",
                        "Failed to save settings. Please try again.", ["OK"]);
                } else {
                    alert('Failed to save settings. Please try again.');
                }
            }
        }
    }

    // Static method to get game configuration
    static getGameConfig(game) {
        const configs = {
            'bo3': {
                displayName: 'Black Ops 3',
                installProperty: 'bo3-install'
            },
            'ghosts': {
                displayName: 'Call of Duty: Ghosts',
                installProperty: 'ghosts-install'
            },
            'aw': {
                displayName: 'Advanced Warfare',
                installProperty: 'aw-install'
            },
            'mwr': {
                displayName: 'Modern Warfare Remastered',
                installProperty: 'mwr-install'
            },
            'iw7': {
                displayName: 'Infinite Warfare',
                installProperty: 'iw7-install'
            },
            'hmw': {
                displayName: 'HorizonMW',
                installProperty: 'hmw-install'
            }
        };
        return configs[game];
    }
}

window.GameSettingsPopup = GameSettingsPopup;