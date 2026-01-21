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

                <div class="settings-section" id="hmw-cb-extension-section" style="display: none;">
                    <h4>Game Options</h4>
                    <div class="setting-item inline-setting">
                        <label>Disable CB Extension</label>
                        <div class="toggle-group small" id="disable-cb-extension-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                </div>

                <div class="settings-section" id="launch-options-section">
                    <h4>Advanced</h4>
                    <div class="setting-item">
                        <label for="launch-options-input">Launch Options:</label>
                        <input type="text" id="launch-options-input" class="launch-options-input" />
                    </div>
                </div>

                <div class="popup-actions">
                    <button class="btn-reset">Reset Game Settings</button>
                    <div style="flex: 1;"></div>
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
        const resetBtn = this.popup.querySelector('.btn-reset');
        const browseBtn = this.popup.querySelector('#browse-btn');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
        saveBtn.addEventListener('click', () => this.handleSave());
        resetBtn.addEventListener('click', () => this.handleReset());
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
        const hmwExtensionSection = this.popup.querySelector('#hmw-cb-extension-section');

        if (game === 'bo3') {
            // For BO3, hide play behavior and show cinematic option
            playBehaviorSection.style.display = 'none';
            bo3CinematicSection.style.display = 'block';
            hmwExtensionSection.style.display = 'none';
        } else if (game === 'hmw') {
            // For HMW, show CB extension option
            playBehaviorSection.style.display = 'none';
            bo3CinematicSection.style.display = 'none';
            hmwExtensionSection.style.display = 'block';
        } else if (this.gameConfig.hasMultipleModes) {
            // For games with multiple modes, show play behavior and populate with supported modes
            playBehaviorSection.style.display = 'block';
            bo3CinematicSection.style.display = 'none';
            hmwExtensionSection.style.display = 'none';
            this.populatePlayBehaviorDropdown();
        } else {
            // For single-mode games (other than BO3), hide play behavior
            playBehaviorSection.style.display = 'none';
            bo3CinematicSection.style.display = 'none';
            hmwExtensionSection.style.display = 'none';
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
                const installPath = await window.executeCommand('get-game-property', {
                    game: this.currentGame,
                    suffix: 'install'
                });
                this.popup.querySelector('#game-path').value = installPath || '';

                // Load launch options (available for all games)
                const launchOptions = await window.executeCommand('get-game-property', {
                    game: this.currentGame,
                    suffix: 'launch-options'
                });
                this.popup.querySelector('#launch-options-input').value = launchOptions || '';

                if (this.currentGame === 'bo3') {
                    // Load BO3 cinematic setting
                    const skipIntro = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: 'skip-intro-cinematic'
                    });
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
                } else if (this.currentGame === 'hmw') {
                    // Load HMW CB extension setting
                    const disableExt = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: 'disable-cb-extension'
                    });
                    const toggleGroup = this.popup.querySelector('#disable-cb-extension-toggle');
                    const buttons = toggleGroup.querySelectorAll('.toggle-btn');

                    // Remove active class from all buttons
                    buttons.forEach(btn => btn.classList.remove('active'));

                    // Set active button based on saved value
                    const targetValue = disableExt === 'true' ? 'true' : 'false';
                    const targetButton = toggleGroup.querySelector(`[data-value="${targetValue}"]`);
                    if (targetButton) {
                        targetButton.classList.add('active');
                    }
                } else {
                    // Load play behavior preference for other games
                    const savedBehavior = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: 'game-mode'
                    });

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
                        path: installPath,
                        existing_install: true
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

                // Save other properties using set-game-property
                if (this.currentGame === 'bo3') {
                    // Save BO3 cinematic setting
                    const toggleGroup = this.popup.querySelector('#skip-intro-cinematic-toggle');
                    const activeButton = toggleGroup.querySelector('.toggle-btn.active');
                    await window.executeCommand('set-game-property', {
                        game: this.currentGame,
                        suffix: 'skip-intro-cinematic',
                        value: activeButton ? activeButton.dataset.value : 'false'
                    });
                } else if (this.currentGame === 'hmw') {
                    // Save HMW CB extension setting
                    const toggleGroup = this.popup.querySelector('#disable-cb-extension-toggle');
                    const activeButton = toggleGroup.querySelector('.toggle-btn.active');
                    await window.executeCommand('set-game-property', {
                        game: this.currentGame,
                        suffix: 'disable-cb-extension',
                        value: activeButton ? activeButton.dataset.value : 'false'
                    });
                } else {
                    // Save play behavior preference for other games
                    const selectedBehavior = this.popup.querySelector('#play-behavior-select').value;
                    if (selectedBehavior === 'ask') {
                        // For "ask every time", we remove the saved preference
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: 'game-mode',
                            value: ''
                        });
                    } else {
                        // For specific modes, save the preference
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: 'game-mode',
                            value: selectedBehavior
                        });
                    }
                }

                // Save launch options (available for all games)
                const launchOptions = this.popup.querySelector('#launch-options-input').value.trim();
                await window.executeCommand('set-game-property', {
                    game: this.currentGame,
                    suffix: 'launch-options',
                    value: launchOptions
                });

                this.hide();
            } catch (error) {
                console.error('Failed to save settings:', error);
                if (typeof window.showMessageBox === 'function') {
                    window.showMessageBox("Save Failed",
                        "Failed to save settings. Please try again.", ["OK"]);
                } else {
                    alert('Failed to save settings. Please try again.');
                }
            }
        }
    }

    async handleReset() {
        if (typeof window.showMessageBox === 'function') {
            const result = await window.showMessageBox(
                "Reset Game Settings",
                `Are you sure you want to reset all settings for ${this.gameConfig.displayName}? This will clear the installation path and all game preferences.`,
                ["Cancel", "Reset"]
            );

            if (result === 1) {
                try {
                    // Reset all game settings using the reset-game-settings command
                    await window.executeCommand('reset-game-settings', {
                        game: this.currentGame
                    });

                    // Trigger UI refresh
                    window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                        detail: { game: this.currentGame }
                    }));

                    this.hide();

                    if (typeof window.showMessageBox === 'function') {
                        window.showMessageBox("Settings Reset",
                            `${this.gameConfig.displayName} settings have been reset to defaults!`, ["OK"]);
                    }
                } catch (error) {
                    console.error('Failed to reset settings:', error);
                    if (typeof window.showMessageBox === 'function') {
                        window.showMessageBox("Reset Failed",
                            "Failed to reset settings. Please try again.", ["OK"]);
                    }
                }
            }
        }
    }

}

window.GameSettingsPopup = GameSettingsPopup;