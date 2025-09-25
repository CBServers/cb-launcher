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
                <div class="mode-options">
                    <label class="mode-option">
                        <input type="radio" name="gameMode" value="sp" />
                        <span class="radio-custom"></span>
                        <div class="mode-info">
                            <strong>Single Player</strong>
                            <p>Play the campaign</p>
                        </div>
                    </label>
                    <label class="mode-option">
                        <input type="radio" name="gameMode" value="mp" checked />
                        <span class="radio-custom"></span>
                        <div class="mode-info">
                            <strong>Multiplayer</strong>
                            <p>Play online with others</p>
                        </div>
                    </label>
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

    async show(game, gameCommands) {
        this.currentGame = game;
        this.gameCommands = gameCommands;

        const savedPreference = await this.getSavedPreference(game);
        if (savedPreference && savedPreference !== '') {
            this.launchGame(savedPreference);
            return;
        }

        this.backdrop.style.display = 'flex';
        this.popup.querySelector('input[name="gameMode"][value="mp"]').checked = true;
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
        const command = this.gameCommands[mode];
        if (command && typeof window.executeCommand === 'function') {
            const installProperty = this.getInstallProperty(this.currentGame);
            window.executeCommand('get-property', installProperty).then(folder => {
                if (!folder) {
                    const gameName = this.getGameDisplayName(this.currentGame);
                    if (typeof window.showMessageBox === 'function') {
                        window.showMessageBox(`⚙ ${gameName} not configured`,
                            `You have not configured your <b>${gameName} installation</b> path.<br><br>Please do so in the settings!`, ["Ok"]).then(index => {
                            if (typeof window.showSettings === 'function') {
                                window.showSettings();
                            }
                        });
                    } else {
                        alert(`${gameName} installation path not configured. Please configure it in settings.`);
                    }
                } else {
                    window.executeCommand(command.launch, command.arg).then(() => {
                        console.log(`Launching ${this.currentGame} in ${mode} mode`);
                    }).catch(error => {
                        console.error(`Failed to launch ${this.currentGame}:`, error);
                    });
                }
            }).catch(error => {
                console.error(`Failed to get ${this.currentGame} install property:`, error);
            });
        }
    }

    getInstallProperty(game) {
        const mapping = {
            'bo3': 'bo3-install',
            'ghosts': 'ghosts-install',
            'aw': 'aw-install'
        };
        return mapping[game];
    }

    getGameDisplayName(game) {
        const mapping = {
            'bo3': 'Black Ops 3',
            'ghosts': 'Call of Duty: Ghosts',
            'aw': 'Advanced Warfare'
        };
        return mapping[game];
    }

    async getSavedPreference(game) {
        const key = `game-mode-${game}`;
        if (typeof window.executeCommand === 'function') {
            try {
                const result = await window.executeCommand('get-property', key);
                return result || null;
            } catch (error) {
                console.log(`No saved preference for ${game}:`, error);
                return null;
            }
        }
        return null;
    }

    async savePreference(game, mode) {
        const key = `game-mode-${game}`;
        if (typeof window.executeCommand === 'function') {
            try {
                const properties = {};
                properties[key] = mode;
                await window.executeCommand('set-property', properties);
                console.log(`Saved preference for ${game}: ${mode}`);
            } catch (error) {
                console.error(`Failed to save preference for ${game}:`, error);
            }
        }
    }
}

window.GameModePopup = GameModePopup;