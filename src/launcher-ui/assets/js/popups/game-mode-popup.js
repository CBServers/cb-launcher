class GameModePopup {
    constructor() {
        this.popup = null;
        this.backdrop = null;
        this.currentGame = null;
        this.gameCommands = null;
        this.createPopup();
    }

    createPopup() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'game-mode-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'game-mode-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3>Select Game Mode</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="mode-options" id="mode-options">
                    <!-- Mode options will be dynamically generated -->
                </div>
                <div class="remember-choice">
                    <label class="checkbox-option">
                        <input type="checkbox" id="rememberChoice" />
                        <span class="checkbox-custom"></span>
                        <span>Remember this choice</span>
                    </label>
                </div>
                <div class="popup-actions">
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-play">Play</button>
                </div>
            </div>
        `;

        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.bindEvents();
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    refreshTexts() {
        this.popup.querySelector('.popup-header h3').textContent = this.t('popup.gameMode.title');
        this.popup.querySelector('.remember-choice span:last-child').textContent = this.t('popup.gameMode.rememberChoice');
        this.popup.querySelector('.btn-cancel').textContent = this.t('common.cancel');
        this.popup.querySelector('.btn-play').textContent = this.t('common.play');
    }

    bindEvents() {
        const closeBtn = this.popup.querySelector('.popup-close');
        const cancelBtn = this.popup.querySelector('.btn-cancel');
        const playBtn = this.popup.querySelector('.btn-play');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
        playBtn.addEventListener('click', () => this.handlePlay());

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
        this.refreshTexts();

        this.modeAvailability = await this.loadModeAvailability(game);

        // A remembered mode whose files are missing must not launch; fall through to the popup
        const savedPreference = await this.getSavedPreference(game);
        if (savedPreference && savedPreference !== '' && this.isModeAvailable(savedPreference)) {
            this.launchGame(savedPreference);
            return;
        }

        // Generate mode options based on game's supported modes
        this.generateModeOptions(game, gameConfig);
        await this.loadClientSelections(game, gameConfig);

        this.backdrop.style.display = 'flex';

        // Set default selection (prefer mp, then first available option)
        const radioInputs = this.popup.querySelectorAll('input[name="gameMode"]:not(:disabled)');
        if (radioInputs.length > 0) {
            const mpOption = this.popup.querySelector('input[name="gameMode"][value="mp"]:not(:disabled)');
            if (mpOption) {
                mpOption.checked = true;
            } else {
                radioInputs[0].checked = true;
            }
        }

        this.popup.querySelector('#rememberChoice').checked = false;
    }

    async loadModeAvailability(game) {
        try {
            return await window.executeCommand('get-game-mode-availability', { game: game });
        } catch (error) {
            console.error(`get-game-mode-availability failed for ${game}:`, error);
            return null;
        }
    }

    getModeAvailabilityInfo(mode) {
        if (!this.modeAvailability || !this.modeAvailability.gated || !this.modeAvailability.modes) {
            return null;
        }
        return this.modeAvailability.modes[mode] || null;
    }

    isModeAvailable(mode) {
        const info = this.getModeAvailabilityInfo(mode);
        return !info || info.available !== false;
    }

    hide() {
        this.backdrop.style.display = 'none';
    }

    isVisible() {
        return this.backdrop.style.display === 'flex';
    }

    async handlePlay() {
        const checked = this.popup.querySelector('input[name="gameMode"]:checked');
        if (!checked) {
            return;
        }
        const selectedMode = checked.value;
        const remember = this.popup.querySelector('#rememberChoice').checked;

        if (remember) {
            await this.savePreference(this.currentGame, selectedMode);
        }

        await this.saveClientSelection(selectedMode);

        this.hide();
        this.launchGame(selectedMode);
    }

    launchGame(mode) {
        if (typeof window.executeCommand !== 'function') {
            return;
        }

        const gameId = GameUtils.getUIIdFromBackendId(this.currentGame);

        GameUtils.launchGameWithMode(this.currentGame, gameId, mode).catch(error => {
            console.error(`Failed to launch ${this.currentGame}:`, error);
        });
    }

    generateModeOptions(game, gameConfig) {
        const modeOptionsContainer = this.popup.querySelector('#mode-options');
        modeOptionsContainer.innerHTML = '';

        // Get mode information from GameUtils
        const modeInfo = GameUtils.getModeInfo();

        // Generate options for each supported mode
        gameConfig.supportedModes.forEach((mode, index) => {
            const info = modeInfo[mode] || { name: mode.toUpperCase(), description: this.t('popup.gameMode.playMode', { mode: mode.toUpperCase() }) };
            const isFirst = index === 0;
            const unavailable = !this.isModeAvailable(mode);

            // Modes served by more than one client get an inline picker
            const clients = (gameConfig.modeClients || {})[mode] || [];
            const clientSelector = !unavailable && clients.length > 1 ? `
                <div class="mode-client-select" data-mode="${mode}">
                    ${clients.map(c => `<button type="button" class="client-btn" data-client="${c.id}">${c.name}</button>`).join('')}
                </div>
            ` : '';

            // Missing component: disable the mode and offer an inline install action
            let unavailableNote = '';
            if (unavailable) {
                const availInfo = this.getModeAvailabilityInfo(mode);
                const size = availInfo && availInfo.downloadSize ? GameUtils.formatBytes(availInfo.downloadSize) : null;
                const installLabel = size
                    ? this.t('popup.gameMode.installActionSize', { size: size })
                    : this.t('popup.gameMode.installAction');
                unavailableNote = `
                    <div class="mode-unavailable-note">
                        <span>${this.t('popup.gameMode.notInstalled')}</span>
                        <button type="button" class="mode-install-btn" data-mode="${mode}">${installLabel}</button>
                    </div>
                `;
            }

            const modeOption = document.createElement('label');
            modeOption.className = `mode-option${unavailable ? ' unavailable' : ''}`;
            modeOption.innerHTML = `
                <input type="radio" name="gameMode" value="${mode}" ${unavailable ? 'disabled' : ''} ${isFirst && !unavailable ? 'checked' : ''} />
                <span class="radio-custom"></span>
                <div class="mode-info">
                    <strong>${info.name}</strong>
                    <p>${info.description}</p>
                    ${clientSelector}
                    ${unavailableNote}
                </div>
            `;

            modeOptionsContainer.appendChild(modeOption);
        });

        // Install action: hand off to Manage Install with the missing component pre-checked
        this.popup.querySelectorAll('.mode-install-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const availInfo = this.getModeAvailabilityInfo(btn.dataset.mode);
                this.hide();
                const uiId = GameUtils.getUIIdFromBackendId(this.currentGame);
                if (typeof window.showManageInstall === 'function') {
                    window.showManageInstall(uiId, { preselectComponents: (availInfo && availInfo.missingComponents) || [] });
                }
            });
        });

        // Picking a client also selects its mode
        this.popup.querySelectorAll('.mode-client-select').forEach(select => {
            select.querySelectorAll('.client-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    select.querySelectorAll('.client-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const radio = this.popup.querySelector(`input[name="gameMode"][value="${select.dataset.mode}"]`);
                    if (radio) {
                        radio.checked = true;
                    }
                });
            });
        });
    }

    async loadClientSelections(game, gameConfig) {
        for (const select of this.popup.querySelectorAll('.mode-client-select')) {
            let saved = null;
            try {
                saved = await window.executeCommand('get-game-property', {
                    game: game,
                    suffix: PROPERTY_KEYS.GAME.SELECTED_CLIENT_PREFIX + select.dataset.mode
                });
            } catch (error) { /* fall through to default */ }

            const buttons = select.querySelectorAll('.client-btn');
            const active = saved ? select.querySelector(`.client-btn[data-client="${saved}"]`) : null;
            (active || buttons[0]).classList.add('active');
        }
    }

    async saveClientSelection(mode) {
        const select = this.popup.querySelector(`.mode-client-select[data-mode="${mode}"]`);
        const active = select ? select.querySelector('.client-btn.active') : null;
        if (!active) {
            return;
        }

        try {
            await window.executeCommand('set-game-property', {
                game: this.currentGame,
                suffix: PROPERTY_KEYS.GAME.SELECTED_CLIENT_PREFIX + mode,
                value: active.dataset.client
            });
        } catch (error) {
            console.error(`Failed to save client selection for ${this.currentGame}:`, error);
        }
    }

    async getSavedPreference(game) {
        if (typeof window.executeCommand === 'function') {
            try {
                const result = await window.executeCommand('get-game-property', {
                    game: game,
                    suffix: PROPERTY_KEYS.GAME.GAME_MODE
                });
                return result || null;
            } catch (error) {
                console.log(`No saved preference for ${game}:`, error);
                return null;
            }
        }
        return null;
    }

    async savePreference(game, mode) {
        if (typeof window.executeCommand === 'function') {
            try {
                await window.executeCommand('set-game-property', {
                    game: game,
                    suffix: PROPERTY_KEYS.GAME.GAME_MODE,
                    value: mode
                });
                console.log(`Saved preference for ${game}: ${mode}`);
            } catch (error) {
                console.error(`Failed to save preference for ${game}:`, error);
            }
        }
    }
}

window.GameModePopup = GameModePopup;
