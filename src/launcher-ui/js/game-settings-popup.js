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

                <div class="settings-section" id="play-behavior-section">
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

                <div class="settings-section" id="bo3-cinematic-section" style="display: none;">
                    <h4>Game Options</h4>
                    <div class="setting-item inline-setting">
                        <label>Skip Intro Cinematic</label>
                        <div class="toggle-group small" id="skip-intro-cinematic-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
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

        // Handle toggle button clicks
        this.popup.addEventListener('click', (e) => {
            if (e.target.classList.contains('toggle-btn')) {
                const toggleGroup = e.target.parentElement;
                const buttons = toggleGroup.querySelectorAll('.toggle-btn');

                // Remove active class from all buttons in this group
                buttons.forEach(btn => btn.classList.remove('active'));

                // Add active class to clicked button
                e.target.classList.add('active');
            }
        });
    }

    async show(game, gameConfig) {
        this.currentGame = game;
        this.gameConfig = gameConfig || GameUtils.getGameConfig(game);

        // Update the UI with game-specific information
        this.popup.querySelector('#settings-title').textContent = `${this.gameConfig.displayName} Settings`;
        this.popup.querySelector('#path-label').textContent = `${this.gameConfig.displayName} Installation Folder:`;

        // Show/hide sections based on game
        const playBehaviorSection = this.popup.querySelector('#play-behavior-section');
        const bo3CinematicSection = this.popup.querySelector('#bo3-cinematic-section');

        if (game === 'bo3') {
            // For BO3, hide play behavior and show cinematic option
            playBehaviorSection.style.display = 'none';
            bo3CinematicSection.style.display = 'block';
        } else if (this.gameConfig.hasMultipleModes) {
            // For games with multiple modes, show play behavior and populate with supported modes
            playBehaviorSection.style.display = 'block';
            bo3CinematicSection.style.display = 'none';
            this.populatePlayBehaviorDropdown();
        } else {
            // For single-mode games (other than BO3), hide play behavior
            playBehaviorSection.style.display = 'none';
            bo3CinematicSection.style.display = 'none';
        }

        // Load current settings
        await this.loadCurrentSettings();

        this.backdrop.style.display = 'flex';
    }

    populatePlayBehaviorDropdown() {
        const behaviorSelect = this.popup.querySelector('#play-behavior-select');
        const modeInfo = GameUtils.getModeInfo();

        // Clear existing options
        behaviorSelect.innerHTML = '';

        // Add "Ask me every time" option
        const askOption = document.createElement('option');
        askOption.value = 'ask';
        askOption.textContent = 'Ask me every time';
        behaviorSelect.appendChild(askOption);

        // Add options for each supported mode
        this.gameConfig.supportedModes.forEach(mode => {
            const info = modeInfo[mode] || { name: mode.toUpperCase() };
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = info.name;
            behaviorSelect.appendChild(option);
        });
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

                if (this.currentGame === 'bo3') {
                    // Load BO3 cinematic setting
                    const cinematicKey = this.gameConfig.specialSettings.skipIntroCinematic;
                    const skipIntro = await window.executeCommand('get-property', cinematicKey);
                    const toggleGroup = this.popup.querySelector('#skip-intro-cinematic-toggle');
                    const buttons = toggleGroup.querySelectorAll('.toggle-btn');

                    // Remove active class from all buttons
                    buttons.forEach(btn => btn.classList.remove('active'));

                    // Set active button based on saved value
                    const targetValue = skipIntro === 'true' ? 'true' : 'false';
                    const targetButton = toggleGroup.querySelector(`[data-value="${targetValue}"]`);
                    if (targetButton) {
                        targetButton.classList.add('active');
                    }
                } else {
                    // Load play behavior preference for other games
                    const behaviorKey = this.gameConfig.gameModeProperty;
                    const savedBehavior = await window.executeCommand('get-property', behaviorKey);

                    const behaviorSelect = this.popup.querySelector('#play-behavior-select');
                    if (savedBehavior && savedBehavior !== '') {
                        behaviorSelect.value = savedBehavior;
                    } else {
                        // No saved preference means "ask every time"
                        behaviorSelect.value = 'ask';
                    }
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

        if (typeof window.executeCommand === 'function') {
            try {
                // Validate and save installation path if provided
                if (installPath) {
                    const pathValid = await window.executeCommand('set-game-path', {
                        game: this.currentGame,
                        path: installPath
                    });

                    if (!pathValid) {
                        // Path validation failed - show error message
                        if (typeof window.showMessageBox === 'function') {
                            window.showMessageBox("Invalid Game Path",
                                `The selected folder does not contain valid ${this.gameConfig.displayName} game files. Please select the correct game installation folder.`, ["OK"]);
                        } else {
                            alert(`The selected folder does not contain valid ${this.gameConfig.displayName} game files.`);
                        }
                        return; // Don't save anything if path is invalid
                    }
                }

                // Save other properties using set-property
                const properties = {};

                if (this.currentGame === 'bo3') {
                    // Save BO3 cinematic setting
                    const toggleGroup = this.popup.querySelector('#skip-intro-cinematic-toggle');
                    const activeButton = toggleGroup.querySelector('.toggle-btn.active');
                    const cinematicKey = this.gameConfig.specialSettings.skipIntroCinematic;
                    properties[cinematicKey] = activeButton ? activeButton.dataset.value : 'false';
                } else {
                    // Save play behavior preference for other games
                    const selectedBehavior = this.popup.querySelector('#play-behavior-select').value;
                    const behaviorKey = `game-mode-${this.currentGame}`;
                    if (selectedBehavior === 'ask') {
                        // For "ask every time", we remove the saved preference
                        // This will make the game mode popup show up
                        properties[behaviorKey] = '';
                    } else {
                        // For specific modes, save the preference
                        properties[behaviorKey] = selectedBehavior;
                    }
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

}

window.GameSettingsPopup = GameSettingsPopup;