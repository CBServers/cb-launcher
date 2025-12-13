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

        const savedPreference = await this.getSavedPreference(game);
        if (savedPreference && savedPreference !== '') {
            this.launchGame(savedPreference);
            return;
        }

        // Generate mode options based on game's supported modes
        this.generateModeOptions(game, gameConfig);

        this.backdrop.style.display = 'flex';

        // Set default selection (prefer mp, then first available option)
        const radioInputs = this.popup.querySelectorAll('input[name="gameMode"]');
        if (radioInputs.length > 0) {
            const mpOption = this.popup.querySelector('input[name="gameMode"][value="mp"]');
            if (mpOption) {
                mpOption.checked = true;
            } else {
                radioInputs[0].checked = true;
            }
        }

        this.popup.querySelector('#rememberChoice').checked = false;
    }

    hide() {
        this.backdrop.style.display = 'none';
    }

    isVisible() {
        return this.backdrop.style.display === 'flex';
    }

    async handlePlay() {
        const selectedMode = this.popup.querySelector('input[name="gameMode"]:checked').value;
        const remember = this.popup.querySelector('#rememberChoice').checked;

        if (remember) {
            await this.savePreference(this.currentGame, selectedMode);
        }

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
            const info = modeInfo[mode] || { name: mode.toUpperCase(), description: `Play ${mode} mode` };
            const isFirst = index === 0;

            const modeOption = document.createElement('label');
            modeOption.className = 'mode-option';
            modeOption.innerHTML = `
                <input type="radio" name="gameMode" value="${mode}" ${isFirst ? 'checked' : ''} />
                <span class="radio-custom"></span>
                <div class="mode-info">
                    <strong>${info.name}</strong>
                    <p>${info.description}</p>
                </div>
            `;

            modeOptionsContainer.appendChild(modeOption);
        });
    }

    getGameDisplayName(game) {
        const config = GameUtils.getGameConfig(game);
        return config ? config.displayName : game;
    }

    async getSavedPreference(game) {
        if (typeof window.executeCommand === 'function') {
            try {
                const result = await window.executeCommand('get-game-property', {
                    game: game,
                    suffix: 'game-mode'
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
                    suffix: 'game-mode',
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