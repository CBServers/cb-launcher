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
                <span class="settings-save-status" aria-live="polite"></span>
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
                    <span class="setting-error" id="game-path-error"></span>
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
                    <div id="launch-flag-rows"></div>
                    <div class="setting-item inline-setting" id="launch-admin-row">
                        <div class="setting-info">
                            <label>Launch as Administrator</label>
                            <span class="setting-description" id="launch-admin-help"></span>
                        </div>
                        <div class="toggle-group small" id="launch-admin-toggle">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                    <div class="setting-item inline-setting" id="plutonium-lan-row" style="display: none;">
                        <div class="setting-info">
                            <label>LAN mode</label>
                            <span class="setting-description" id="plutonium-lan-help"></span>
                        </div>
                        <div class="toggle-group small" id="plutonium-lan-toggle">
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
                    <div class="setting-item inline-setting" id="client-channel-row" style="display: none;">
                        <div class="setting-info">
                            <label for="client-channel-select">Client channel</label>
                            <span class="setting-description" id="client-channel-help"></span>
                        </div>
                        <select id="client-channel-select" class="behavior-dropdown">
                            <option value="release">Release</option>
                            <option value="dev">Dev</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <label for="launch-options-input">Launch Options:</label>
                        <input type="text" id="launch-options-input" class="launch-options-input" />
                    </div>
                </div>

                <div class="popup-actions">
                    <button class="btn-reset">Reset Settings</button>
                    <div style="flex: 1;"></div>
                    <button class="btn-cancel">Close</button>
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
        const resetBtn = this.popup.querySelector('.btn-reset');
        const browseBtn = this.popup.querySelector('#browse-btn');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
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

        // Every control saves as it changes; text inputs fire `change` on blur or Enter
        this.popup.addEventListener('click', async (e) => {
            if (!e.target.classList.contains('toggle-btn') || e.target.classList.contains('active')) {
                return;
            }

            const toggleGroup = e.target.parentElement;
            const enabled = e.target.dataset.value === 'true';
            if (enabled && toggleGroup.dataset.risky === 'true' && !(await this.confirmRiskyFlag(toggleGroup))) {
                return;
            }

            toggleGroup.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            if (toggleGroup.id === 'custom-resolution-toggle') {
                this.updateCustomResolutionVisibility();
            }

            await this.saveToggle(toggleGroup, enabled);
        });

        this.popup.addEventListener('change', (e) => this.handleChange(e.target));

        this.popup.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.matches('input[type="text"], input[type="number"]')) {
                e.target.blur();
            }
        });
    }

    setProperty(suffix, value) {
        return window.executeCommand('set-game-property', { game: this.currentGame, suffix, value });
    }

    setLaunchFlag(id, value) {
        return window.executeCommand('set-launch-flags', { game: this.currentGame, flags: { [id]: value } });
    }

    async persist(save) {
        if (typeof window.executeCommand !== 'function') {
            return false;
        }

        try {
            await save();
            this.showSaveStatus(true);
            return true;
        } catch (error) {
            console.error('Failed to save setting:', error);
            this.showSaveStatus(false);
            return false;
        }
    }

    showSaveStatus(ok) {
        const status = this.popup.querySelector('.settings-save-status');
        status.textContent = this.t(ok ? 'popup.gameSettings.savedStatus' : 'popup.gameSettings.saveFailedStatus');
        status.classList.toggle('is-error', !ok);
        status.classList.add('visible');

        clearTimeout(this.saveStatusTimer);
        this.saveStatusTimer = setTimeout(() => status.classList.remove('visible'), ok ? 1800 : 4000);
    }

    saveToggle(toggleGroup, enabled) {
        if (toggleGroup.classList.contains('launch-flag-toggle')) {
            return this.persist(() => this.setLaunchFlag(toggleGroup.dataset.flagId, enabled));
        }

        switch (toggleGroup.id) {
            case 'launch-admin-toggle': {
                // Stored only when it differs from the game's default
                const adminDefault = this.gameConfig.requiresElevation === true;
                return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.LAUNCH_ADMIN,
                    enabled === adminDefault ? '' : (enabled ? 'true' : 'false')));
            }
            case 'plutonium-lan-toggle':
                return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.PLUTONIUM_LAN, enabled ? 'true' : ''));
            case 'custom-resolution-toggle':
                return this.saveCustomResolution(false);
        }
    }

    handleChange(target) {
        if (target.id === 'play-behavior-select') {
            // "Ask every time" is the absence of a saved mode
            return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.GAME_MODE, target.value === 'ask' ? '' : target.value));
        }
        if (target.classList.contains('mode-client-select')) {
            return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.SELECTED_CLIENT_PREFIX + target.dataset.mode, target.value));
        }
        if (target.classList.contains('launch-flag-select')) {
            return this.persist(() => this.setLaunchFlag(target.dataset.flagId, target.value));
        }
        if (target.id === 'client-channel-select') {
            return this.persist(() => window.executeCommand('set-client-channel', { game: this.currentGame, channel: target.value }));
        }
        if (target.id === 'launch-options-input') {
            return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.LAUNCH_OPTIONS, target.value.trim()));
        }
        if (target.id === 'player-name-override-input') {
            return this.saveNameOverride();
        }
        if (target.id === 'custom-resolution-preset') {
            this.updateCustomResolutionVisibility();
            return this.saveCustomResolution(false);
        }
        if (target.id === 'custom-resolution-width' || target.id === 'custom-resolution-height') {
            return this.saveCustomResolution(true);
        }
    }

    saveNameOverride() {
        const input = this.popup.querySelector('#player-name-override-input');
        const errorEl = this.popup.querySelector('#player-name-override-error');
        const value = input.value.trim();

        if (value.length > 0 && (value.length < 3 || value.length > 16)) {
            errorEl.textContent = this.t('popup.gameSettings.playerNameOverrideError');
            errorEl.classList.add('visible');
            return;
        }

        errorEl.classList.remove('visible');
        return this.persist(() => this.setProperty(PROPERTY_KEYS.GAME.PLAYER_NAME_OVERRIDE, value));
    }

    // An unfinished custom size is left unsaved; the error only shows once the user edits the fields
    saveCustomResolution(showErrors) {
        const activeButton = this.popup.querySelector('#custom-resolution-toggle .toggle-btn.active');
        const enabled = !!activeButton && activeButton.dataset.value === 'true';
        const presetSelect = this.popup.querySelector('#custom-resolution-preset');
        const errorEl = this.popup.querySelector('#custom-resolution-error');

        let width = 0;
        let height = 0;
        if (enabled) {
            if (presetSelect.value === 'custom') {
                width = parseInt(this.popup.querySelector('#custom-resolution-width').value, 10);
                height = parseInt(this.popup.querySelector('#custom-resolution-height').value, 10);
                if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
                    if (showErrors) {
                        errorEl.textContent = this.t('popup.gameSettings.customResolutionError');
                        errorEl.classList.add('visible');
                    }
                    return;
                }
            } else {
                [width, height] = presetSelect.value.split('x').map(Number);
            }
        }

        errorEl.classList.remove('visible');
        return this.persist(async () => {
            await this.setProperty(PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_ENABLED, enabled ? 'true' : 'false');
            if (enabled) {
                await this.setProperty(PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_WIDTH, String(width));
                await this.setProperty(PROPERTY_KEYS.GAME.CUSTOM_RESOLUTION_HEIGHT, String(height));
            }
        });
    }

    // Falls back to the raw argument so a flag the backend adds before its strings still renders
    launchFlagText(group, flag) {
        const key = `popup.gameSettings.${group}.${flag.id}`;
        const text = this.t(key);
        return text && text !== key ? text : (group === 'launchFlags' ? flag.argument : '');
    }

    renderLaunchFlags(flags) {
        const container = this.popup.querySelector('#launch-flag-rows');
        container.innerHTML = '';

        for (const flag of flags) {
            const row = document.createElement('div');
            row.className = 'setting-item inline-setting';

            if (Array.isArray(flag.choices)) {
                row.innerHTML = `
                    <div class="setting-info">
                        <label></label>
                        <span class="setting-description"></span>
                    </div>
                    <select class="behavior-dropdown launch-flag-select"></select>
                `;
                row.querySelector('label').textContent = this.launchFlagText('launchFlags', flag);
                row.querySelector('.setting-description').textContent = this.launchFlagText('launchFlagsHelp', flag);

                const select = row.querySelector('select');
                select.dataset.flagId = flag.id;
                flag.choices.forEach((value, index) => {
                    const key = `popup.gameSettings.launchFlagChoices.${flag.id}.${value}`;
                    const name = this.t(key) !== key ? this.t(key) : value;
                    const option = document.createElement('option');
                    option.value = value;
                    // The first choice is the client's own default
                    option.textContent = index === 0 ? this.t('popup.gameSettings.launchFlagDefault', { name }) : name;
                    select.appendChild(option);
                });
                select.value = flag.value;
                container.appendChild(row);
                continue;
            }

            row.innerHTML = `
                <div class="setting-info">
                    <label></label>
                    <span class="setting-description"></span>
                </div>
                <div class="toggle-group small launch-flag-toggle">
                    <button class="toggle-btn" data-value="false">OFF</button>
                    <button class="toggle-btn" data-value="true">ON</button>
                </div>
            `;
            row.querySelector('label').textContent = this.launchFlagText('launchFlags', flag);
            const help = row.querySelector('.setting-description');
            help.textContent = this.launchFlagText('launchFlagsHelp', flag);
            help.classList.toggle('is-risky', flag.risky === true);

            const toggle = row.querySelector('.launch-flag-toggle');
            toggle.dataset.flagId = flag.id;
            toggle.dataset.risky = flag.risky === true ? 'true' : 'false';
            toggle.querySelector(`[data-value="${flag.enabled ? 'true' : 'false'}"]`).classList.add('active');
            container.appendChild(row);
        }
    }

    async confirmRiskyFlag(toggleGroup) {
        if (typeof window.showMessageBox !== 'function') {
            return true;
        }

        const flag = { id: toggleGroup.dataset.flagId, argument: '' };
        const result = await window.showMessageBox(
            this.t('popup.gameSettings.riskyFlagTitle', { flag: this.launchFlagText('launchFlags', flag) }),
            this.t('popup.gameSettings.riskyFlagBody', { help: this.launchFlagText('launchFlagsHelp', flag) }),
            [this.t('common.cancel'), this.t('popup.gameSettings.riskyFlagConfirm')]
        );
        return result === 1;
    }

    supportsNameOverride() {
        return this.gameConfig.supportsName === true || this.gameConfig.clientKey === 'plutonium';
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
        this.popup.querySelector('#launch-admin-row label').textContent = this.t('popup.gameSettings.launchAdmin');
        this.popup.querySelector('#launch-admin-help').textContent = this.t('popup.gameSettings.launchAdminHelp');
        this.popup.querySelector('#plutonium-lan-row label').textContent = this.t('popup.gameSettings.plutoniumLan');
        this.popup.querySelector('#plutonium-lan-help').textContent = this.t('popup.gameSettings.plutoniumLanHelp');
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
        this.popup.querySelector('label[for="client-channel-select"]').textContent = this.t('popup.gameSettings.clientChannel');
        this.popup.querySelector('#client-channel-help').textContent = this.t('popup.gameSettings.clientChannelHelp');
        this.popup.querySelector('#client-channel-select option[value="release"]').textContent = this.t('popup.gameSettings.clientChannelRelease');
        this.popup.querySelector('#client-channel-select option[value="dev"]').textContent = this.t('popup.gameSettings.clientChannelDev');
        this.popup.querySelector('.btn-reset').textContent = this.t('common.resetSettings');
        this.popup.querySelector('.btn-cancel').textContent = this.t('popup.gameSettings.close');
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

        const isPlutonium = this.gameConfig.clientKey === 'plutonium';
        // Plutonium games take a name only on the LAN path, so the override shows for them too
        const supportsName = this.supportsNameOverride();
        this.popup.querySelector('#plutonium-lan-row').style.display = isPlutonium ? 'flex' : 'none';
        this.popup.querySelector('#player-name-override-help').textContent = this.t(
            isPlutonium && this.gameConfig.supportsName !== true
                ? 'popup.gameSettings.playerNameOverrideHelpLan'
                : 'popup.gameSettings.playerNameOverrideHelp');

        this.renderLaunchFlags([]);
        this.popup.querySelector('#client-channel-row').style.display = 'none';

        this.popup.querySelector('#custom-resolution-row').style.display = this.supportsCustomResolution() ? 'flex' : 'none';
        this.popup.querySelector('#custom-resolution-error').classList.remove('visible');
        this.popup.querySelector('#game-path-error').classList.remove('visible');
        clearTimeout(this.saveStatusTimer);
        this.popup.querySelector('.settings-save-status').classList.remove('visible');

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
        // Esc closes without blurring, so commit a text field that is still being edited
        if (this.popup.contains(document.activeElement) && document.activeElement.matches('input')) {
            document.activeElement.blur();
        }
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

                const [flags, channel] = await Promise.all([
                    window.executeCommand('get-launch-flags', { game: this.currentGame }),
                    window.executeCommand('get-client-channel', { game: this.currentGame })
                ]);
                this.renderLaunchFlags(Array.isArray(flags) ? flags : []);

                const channelAvailable = !!(channel && channel.available);
                this.popup.querySelector('#client-channel-row').style.display = channelAvailable ? 'flex' : 'none';
                if (channelAvailable) {
                    this.popup.querySelector('#client-channel-select').value = channel.channel === 'dev' ? 'dev' : 'release';
                }

                if (this.currentGame !== 'bo3' && this.currentGame !== 'hmw') {
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

                if (this.gameConfig.clientKey === 'plutonium') {
                    const lan = await window.executeCommand('get-game-property', {
                        game: this.currentGame,
                        suffix: PROPERTY_KEYS.GAME.PLUTONIUM_LAN
                    });
                    const lanToggle = this.popup.querySelector('#plutonium-lan-toggle');
                    lanToggle.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('active'));
                    lanToggle.querySelector(`[data-value="${lan === 'true' ? 'true' : 'false'}"]`).classList.add('active');
                }

                // Load player-name override (hidden for games whose backend has no name argument)
                if (this.supportsNameOverride()) {
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
        if (typeof window.executeCommand !== 'function') {
            return;
        }

        const errorEl = this.popup.querySelector('#game-path-error');
        try {
            const folder = await window.executeCommand('browse-folder');
            if (!folder) {
                return;
            }

            const valid = await window.executeCommand('set-game-path', {
                game: this.currentGame,
                path: folder,
                existing_install: true
            });

            // A rejected folder leaves the saved path untouched
            if (!valid) {
                errorEl.textContent = this.t('popup.gameSettings.invalidGamePathBody', { game: this.gameConfig.displayName });
                errorEl.classList.add('visible');
                return;
            }

            errorEl.classList.remove('visible');
            // The backend may have stepped into a subfolder (Xbox app installs keep the game in Content)
            const savedPath = await window.executeCommand('get-game-property', {
                game: this.currentGame,
                suffix: PROPERTY_KEYS.GAME.INSTALL
            });
            this.popup.querySelector('#game-path').value = savedPath || folder;
            this.showSaveStatus(true);
            window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                detail: { game: this.currentGame }
            }));
        } catch (error) {
            console.error('Failed to set game path:', error);
            this.showSaveStatus(false);
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
