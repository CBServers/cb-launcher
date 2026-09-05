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
                    <div id="mode-client-rows"></div>
                </div>

                <div class="settings-section" id="game-options-section" style="display: none;">
                    <h4>Game Options</h4>
                    <div class="setting-item inline-setting" id="skip-intro-cinematic-row" style="display: none;">
                        <label>Skip Intro Cinematic</label>
                        <div class="toggle-group small" id="skip-intro-cinematic-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                    <div class="setting-item inline-setting" id="launch-admin-row">
                        <label>Launch as Administrator</label>
                        <div class="toggle-group small" id="launch-admin-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                    <div class="setting-item inline-setting" id="custom-resolution-row" style="display: none;">
                        <label>Custom Resolution</label>
                        <div class="toggle-group small" id="custom-resolution-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                    <div class="setting-item inline-setting" id="custom-resolution-detail-row" style="display: none;">
                        <label for="custom-resolution-preset">Resolution</label>
                        <select id="custom-resolution-preset" class="behavior-dropdown">
                            <option value="1280x720">720p (1280×720)</option>
                            <option value="1920x1080">1080p (1920×1080)</option>
                            <option value="2560x1440">1440p (2560×1440)</option>
                            <option value="3840x2160">4K (3840×2160)</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div class="setting-item inline-setting" id="custom-resolution-custom-row" style="display: none;">
                        <label for="custom-resolution-width">Width × Height</label>
                        <div class="resolution-inputs">
                            <input type="number" id="custom-resolution-width" class="setting-text-input resolution-input" min="1" max="15360" step="1" autocomplete="off" />
                            <span class="resolution-sep">×</span>
                            <input type="number" id="custom-resolution-height" class="setting-text-input resolution-input" min="1" max="8640" step="1" autocomplete="off" />
                        </div>
                    </div>
                    <span class="setting-error" id="custom-resolution-error"></span>
                </div>

                <div class="settings-section" id="player-section" style="display: none;">
                    <h4>Player</h4>
                    <div class="setting-item inline-setting" id="player-name-override-row">
                        <div class="setting-info">
                            <label for="player-name-override-input">In-game name override</label>
                            <span class="setting-description" id="player-name-override-help"></span>
                        </div>
                        <input type="text" id="player-name-override-input" class="setting-text-input" maxlength="16" autocomplete="off" spellcheck="false" />
                    </div>
                    <span class="setting-error" id="player-name-override-error"></span>
                </div>

                <div class="settings-section" id="launch-options-section">
                    <h4>Advanced</h4>
                    <div class="setting-item">
                        <label for="launch-options-input">Launch Options:</label>
                        <input type="text" id="launch-options-input" class="launch-options-input" />
                    </div>
                </div>

                <div class="popup-actions">
                    <button class="btn-reset">Reset Settings</button>
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

                if (toggleGroup.id === 'custom-resolution-toggle') {
                    this.updateCustomResolutionVisibility();
                }
            }
        });

        this.popup.querySelector('#custom-resolution-preset').addEventListener('change', () => {
            this.updateCustomResolutionVisibility();
        });
    }

    supportsCustomResolution() {
        return this.currentGame === 'cod1' || this.currentGame === 'coduo' || this.currentGame === 'cod2x';
    }

    updateCustomResolutionVisibility() {
        const activeToggle = this.popup.querySelector('#custom-resolution-toggle .toggle-btn.active');
        const enabled = activeToggle && activeToggle.dataset.value === 'true';
        const showDetail = this.supportsCustomResolution() && enabled;
        const preset = this.popup.querySelector('#custom-resolution-preset').value;

        this.popup.querySelector('#custom-resolution-detail-row').style.display = showDetail ? 'flex' : 'none';
        this.popup.querySelector('#custom-resolution-custom-row').style.display =
            (showDetail && preset === 'custom') ? 'flex' : 'none';
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    refreshTexts() {
        this.popup.querySelector('.settings-section h4').textContent = this.t('popup.gameSettings.installationPath');
        this.popup.querySelector('#browse-btn').textContent = this.t('common.browse');
        this.popup.querySelector('#game-path').placeholder = this.t('popup.gameSettings.installationPlaceholder');
        this.popup.querySelector('#play-behavior-section h4').textContent = this.t('popup.gameSettings.playButtonBehavior');
        this.popup.querySelector('label[for="play-behavior-select"]').textContent = this.t('popup.gameSettings.playButtonBehaviorLabel');
        this.popup.querySelector('#game-options-section h4').textContent = this.t('popup.gameSettings.gameOptions');
        this.popup.querySelector('#skip-intro-cinematic-row label').textContent = this.t('popup.gameSettings.skipIntroCinematic');
        this.popup.querySelector('#launch-admin-row label').textContent = this.t('popup.gameSettings.launchAdmin');
        this.popup.querySelector('#player-section h4').textContent = this.t('popup.gameSettings.player');
        this.popup.querySelector('#player-name-override-row label').textContent = this.t('popup.gameSettings.playerNameOverride');
        this.popup.querySelector('#player-name-override-help').textContent = this.t('popup.gameSettings.playerNameOverrideHelp');
        this.popup.querySelector('#player-name-override-input').placeholder = this.t('popup.gameSettings.playerNameOverridePlaceholder');
        this.popup.querySelector('#custom-resolution-row label').textContent = this.t('popup.gameSettings.customResolution');
        this.popup.querySelector('label[for="custom-resolution-preset"]').textContent = this.t('popup.gameSettings.customResolutionPreset');
        this.popup.querySelector('label[for="custom-resolution-width"]').textContent = this.t('popup.gameSettings.customResolutionDimensions');
        this.popup.querySelector('#custom-resolution-preset option[value="custom"]').textContent = this.t('popup.gameSettings.customResolutionCustomOption');
        this.popup.querySelector('#launch-options-section h4').textContent = this.t('popup.gameSettings.advanced');
        this.popup.querySelector('label[for="launch-options-input"]').textContent = this.t('popup.gameSettings.launchOptions');
        this.popup.querySelector('.btn-reset').textContent = this.t('common.resetSettings');
        this.popup.querySelector('.btn-cancel').textContent = this.t('common.cancel');
        this.popup.querySelector('.btn-save').textContent = this.t('common.saveSettings');
    }

    async show(game, gameConfig) {
        this.currentGame = game;
        this.gameConfig = gameConfig || GameUtils.getGameConfig(game);
        this.refreshTexts();

        // Update the UI with game-specific information
        this.popup.querySelector('#settings-title').textContent = this.t('popup.gameSettings.titleWithGame', {
            game: this.gameConfig.displayName
        });
        this.popup.querySelector('#path-label').textContent = this.t('popup.gameSettings.installationFolderWithGame', {
            game: this.gameConfig.displayName
        });

        // Show/hide sections based on game
        const playBehaviorSection = this.popup.querySelector('#play-behavior-section');
        const gameOptionsSection = this.popup.querySelector('#game-options-section');
        const playerSection = this.popup.querySelector('#player-section');
        const skipIntroRow = this.popup.querySelector('#skip-intro-cinematic-row');
        const nameOverrideError = this.popup.querySelector('#player-name-override-error');

        if (game === 'bo3' || game === 'hmw') {
            playBehaviorSection.style.display = 'none';
        } else if (this.gameConfig.hasMultipleModes) {
            playBehaviorSection.style.display = 'block';
            this.populatePlayBehaviorDropdown();
        } else {
            playBehaviorSection.style.display = 'none';
        }

        this.populateModeClientRows();

        const supportsName = this.gameConfig.supportsName === true;

        skipIntroRow.style.display = game === 'bo3' ? 'flex' : 'none';

        this.popup.querySelector('#custom-resolution-row').style.display = this.supportsCustomResolution() ? 'flex' : 'none';
        this.popup.querySelector('#custom-resolution-error').classList.remove('visible');

        // Game options always visible: launch-admin applies to every game
        gameOptionsSection.style.display = 'block';
        playerSection.style.display = supportsName ? 'block' : 'none';
        nameOverrideError.classList.remove('visible');

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
        askOption.textContent = this.t('popup.gameSettings.askEveryTime');
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

    // One dropdown per mode served by more than one client (e.g. CoD4 MP: CoD4x / IW3x)
    populateModeClientRows() {
        const container = this.popup.querySelector('#mode-client-rows');
        container.innerHTML = '';

        const modeInfo = GameUtils.getModeInfo();
        for (const [mode, clients] of Object.entries(this.gameConfig.modeClients || {})) {
            if (!clients || clients.length < 2) {
                continue;
            }

            const row = document.createElement('div');
            row.className = 'setting-item';
            const modeName = (modeInfo[mode] || {}).name || mode.toUpperCase();
            row.innerHTML = `
                <label>${this.t('popup.gameSettings.modeClientLabel', { mode: modeName })}</label>
                <select class="behavior-dropdown mode-client-select" data-mode="${mode}">
                    ${clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
                </select>
            `;
            container.appendChild(row);
        }
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
                    suffix: PROPERTY_KEYS.GAME.INSTALL
                });
                this.popup.querySelector('#game-path').value = installPath || '';

                // Load launch options (available for all games)
                const launchOptions = await window.executeCommand('get-game-property', {
                    game: this.currentGame,
                    suffix: PROPERTY_KEYS.GAME.LAUNCH_OPTIONS
                });
                this.popup.querySelector('#launch-options-input').value = launchOptions || '';

                if (this.currentGame === 'bo3') {
                    // Load BO3 cinematic setting
                    const skipIntro = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.SKIP_INTRO_CINEMATIC
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
                } else if (this.currentGame !== 'hmw') {
                    // Load play behavior preference for other games
                    const savedBehavior = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.GAME_MODE
                    });

                    const behaviorSelect = this.popup.querySelector('#play-behavior-select');
                    if (savedBehavior && savedBehavior !== '') {
                        behaviorSelect.value = savedBehavior;
                    } else {
                        // No saved preference means "ask every time"
                        behaviorSelect.value = 'ask';
                    }
                }

                // Load per-mode client selections; unset falls back to the first declared client
                for (const select of this.popup.querySelectorAll('.mode-client-select')) {
                    const saved = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.SELECTED_CLIENT_PREFIX + select.dataset.mode
                    });
                    select.value = saved && [...select.options].some(o => o.value === saved)
                        ? saved
                        : select.options[0].value;
                }

                // Load launch-as-admin setting (all games); unset means the game's default
                const launchAdmin = await window.executeCommand('get-game-property', {
                    game: this.currentGame,
                    suffix: PROPERTY_KEYS.GAME.LAUNCH_ADMIN
                });
                const adminDefault = this.gameConfig.requiresElevation === true;
                const adminEnabled = (launchAdmin === 'true' || launchAdmin === 'false')
                    ? launchAdmin === 'true'
                    : adminDefault;
                const adminToggle = this.popup.querySelector('#launch-admin-toggle');
                adminToggle.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
                adminToggle.querySelector(`[data-value="${adminEnabled ? 'true' : 'false'}"]`).classList.add('active');

                // Load player-name override (hidden for games whose backend has no name argument)
                if (this.gameConfig.supportsName === true) {
                    const overrideName = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.PLAYER_NAME_OVERRIDE
                    });
                    this.popup.querySelector('#player-name-override-input').value = overrideName || '';
                }

                // Load custom resolution (CoD1 / CoDUO / CoD2 only)
                if (this.supportsCustomResolution()) {
                    const [enabled, widthStr, heightStr] = await Promise.all([
                        window.executeCommand('get-game-property', { game: this.currentGame, suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_ENABLED }),
                        window.executeCommand('get-game-property', { game: this.currentGame, suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_WIDTH }),
                        window.executeCommand('get-game-property', { game: this.currentGame, suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_HEIGHT })
                    ]);

                    const toggleGroup = this.popup.querySelector('#custom-resolution-toggle');
                    toggleGroup.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
                    const targetValue = enabled === 'true' ? 'true' : 'false';
                    toggleGroup.querySelector(`[data-value="${targetValue}"]`).classList.add('active');

                    const presetSelect = this.popup.querySelector('#custom-resolution-preset');
                    const widthInput = this.popup.querySelector('#custom-resolution-width');
                    const heightInput = this.popup.querySelector('#custom-resolution-height');
                    const w = parseInt(widthStr, 10);
                    const h = parseInt(heightStr, 10);
                    const key = (w > 0 && h > 0) ? `${w}x${h}` : '';
                    const matchingPreset = key && presetSelect.querySelector(`option[value="${key}"]`);

                    if (matchingPreset) {
                        presetSelect.value = key;
                        widthInput.value = '';
                        heightInput.value = '';
                    } else if (w > 0 && h > 0) {
                        presetSelect.value = 'custom';
                        widthInput.value = w;
                        heightInput.value = h;
                    } else {
                        presetSelect.value = '1920x1080';
                        widthInput.value = '';
                        heightInput.value = '';
                    }

                    this.updateCustomResolutionVisibility();
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
                            window.showMessageBox(
                                this.t('popup.gameSettings.invalidGamePathTitle'),
                                this.t('popup.gameSettings.invalidGamePathBody', { game: this.gameConfig.displayName }),
                                [this.t('common.ok')]
                            );
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
                        suffix: PROPERTY_KEYS.GAME.SKIP_INTRO_CINEMATIC,
                        value: activeButton ? activeButton.dataset.value : 'false'
                    });
                } else if (this.currentGame !== 'hmw') {
                    // Save play behavior preference for other games
                    const selectedBehavior = this.popup.querySelector('#play-behavior-select').value;
                    if (selectedBehavior === 'ask') {
                        // For "ask every time", we remove the saved preference
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: PROPERTY_KEYS.GAME.GAME_MODE,
                            value: ''
                        });
                    } else {
                        // For specific modes, save the preference
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: PROPERTY_KEYS.GAME.GAME_MODE,
                            value: selectedBehavior
                        });
                    }
                }

                // Save per-mode client selections
                for (const select of this.popup.querySelectorAll('.mode-client-select')) {
                    await window.executeCommand('set-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.SELECTED_CLIENT_PREFIX + select.dataset.mode,
                        value: select.value
                    });
                }

                // Save launch-as-admin (all games); store only when it differs from the game's default
                const adminToggle = this.popup.querySelector('#launch-admin-toggle');
                const adminActive = adminToggle.querySelector('.toggle-btn.active');
                const adminEnabled = adminActive ? adminActive.dataset.value === 'true' : false;
                const adminDefault = this.gameConfig.requiresElevation === true;
                await window.executeCommand('set-game-property', {
                    game: this.currentGame,
                    suffix: PROPERTY_KEYS.GAME.LAUNCH_ADMIN,
                    value: adminEnabled === adminDefault ? '' : (adminEnabled ? 'true' : 'false')
                });

                // Save launch options (available for all games)
                const launchOptions = this.popup.querySelector('#launch-options-input').value.trim();
                await window.executeCommand('set-game-property', {
                    game: this.currentGame,
                    suffix: PROPERTY_KEYS.GAME.LAUNCH_OPTIONS,
                    value: launchOptions
                });

                // Save player-name override (only for games whose backend has a name argument)
                if (this.gameConfig.supportsName === true) {
                    const overrideInput = this.popup.querySelector('#player-name-override-input');
                    const errorEl = this.popup.querySelector('#player-name-override-error');
                    const overrideValue = overrideInput.value.trim();

                    if (overrideValue.length > 0 && (overrideValue.length < 3 || overrideValue.length > 16)) {
                        errorEl.textContent = this.t('popup.gameSettings.playerNameOverrideError');
                        errorEl.classList.add('visible');
                        overrideInput.focus();
                        return;
                    }

                    errorEl.classList.remove('visible');
                    await window.executeCommand('set-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.PLAYER_NAME_OVERRIDE,
                        value: overrideValue
                    });
                }

                // Save custom resolution (CoD1 / CoDUO / CoD2 only)
                if (this.supportsCustomResolution()) {
                    const toggleGroup = this.popup.querySelector('#custom-resolution-toggle');
                    const activeButton = toggleGroup.querySelector('.toggle-btn.active');
                    const enabled = activeButton ? activeButton.dataset.value === 'true' : false;
                    const presetSelect = this.popup.querySelector('#custom-resolution-preset');
                    const errorEl = this.popup.querySelector('#custom-resolution-error');

                    let width = 0;
                    let height = 0;
                    if (enabled) {
                        if (presetSelect.value === 'custom') {
                            const widthInput = this.popup.querySelector('#custom-resolution-width');
                            const heightInput = this.popup.querySelector('#custom-resolution-height');
                            width = parseInt(widthInput.value, 10);
                            height = parseInt(heightInput.value, 10);
                            if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
                                errorEl.textContent = this.t('popup.gameSettings.customResolutionError');
                                errorEl.classList.add('visible');
                                widthInput.focus();
                                return;
                            }
                        } else {
                            [width, height] = presetSelect.value.split('x').map(Number);
                        }
                    }

                    errorEl.classList.remove('visible');
                    await window.executeCommand('set-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_ENABLED,
                        value: enabled ? 'true' : 'false'
                    });
                    if (enabled) {
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_WIDTH,
                            value: String(width)
                        });
                        await window.executeCommand('set-game-property', {
                            game: this.currentGame,
                            suffix: PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_HEIGHT,
                            value: String(height)
                        });
                    }
                }

                this.hide();
            } catch (error) {
                console.error('Failed to save settings:', error);
                if (typeof window.showMessageBox === 'function') {
                    window.showMessageBox(
                        this.t('popup.gameSettings.saveFailedTitle'),
                        this.t('popup.gameSettings.saveFailedBody'),
                        [this.t('common.ok')]
                    );
                } else {
                    alert('Failed to save settings. Please try again.');
                }
            }
        }
    }

    async handleReset() {
        if (typeof window.showMessageBox === 'function') {
            const result = await window.showMessageBox(
                this.t('popup.gameSettings.resetTitle'),
                this.t('popup.gameSettings.resetBody', { game: this.gameConfig.displayName }),
                [this.t('common.cancel'), this.t('common.resetSettings')]
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
                        window.showMessageBox(
                            this.t('popup.gameSettings.resetDoneTitle'),
                            this.t('popup.gameSettings.resetDoneBody', { game: this.gameConfig.displayName }),
                            [this.t('common.ok')]
                        );
                    }
                } catch (error) {
                    console.error('Failed to reset settings:', error);
                    if (typeof window.showMessageBox === 'function') {
                        window.showMessageBox(
                            this.t('popup.gameSettings.resetFailedTitle'),
                            this.t('popup.gameSettings.resetFailedBody'),
                            [this.t('common.ok')]
                        );
                    }
                }
            }
        }
    }

}

window.GameSettingsPopup = GameSettingsPopup;
