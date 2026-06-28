class SetupFlowPopup {
    constructor() {
        this.backdrop = null;
        this.currentGame = null;
        this.currentGameDisplayName = null;
    }

    show(game, gameDisplayName) {
        this.currentGame = game;
        this.currentGameDisplayName = gameDisplayName;
        this.createPopup();
    }

    hide() {
        if (this.backdrop) {
            document.body.removeChild(this.backdrop);
            this.backdrop = null;
        }
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    createPopup() {
        // Remove existing popup if any
        this.hide();

        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'setup-flow-backdrop';

        // Create popup
        const popup = document.createElement('div');
        popup.className = 'setup-flow-popup';

        popup.innerHTML = `
            <div class="popup-header">
                <h3>${this.t('popup.setup.title', { game: this.currentGameDisplayName })}</h3>
                <button class="popup-close" type="button">×</button>
            </div>
            <div class="popup-content">
                <div class="setup-options">
                    <div class="setup-option" onclick="this.querySelector('input').checked = true; this.dispatchEvent(new Event('change', {bubbles: true}))">
                        <input type="radio" name="setup-type" value="existing" id="setup-existing">
                        <div class="radio-custom"></div>
                        <div class="setup-info">
                            <h4>${this.t('popup.setup.alreadyInstalledTitle')}</h4>
                            <p>${this.t('popup.setup.alreadyInstalledBody', { game: this.currentGameDisplayName })}</p>
                        </div>
                    </div>
                    <div class="setup-option" onclick="this.querySelector('input').checked = true; this.dispatchEvent(new Event('change', {bubbles: true}))">
                        <input type="radio" name="setup-type" value="download" id="setup-download">
                        <div class="radio-custom"></div>
                        <div class="setup-info">
                            <h4>${this.t('popup.setup.downloadTitle')}</h4>
                            <p>${this.t('popup.setup.downloadBody', { game: this.currentGameDisplayName })}</p>
                        </div>
                    </div>
                </div>
                <div class="setup-actions">
                    <button class="btn-setup-cancel" type="button">${this.t('common.cancel')}</button>
                    <button class="btn-setup-continue" type="button" disabled>${this.t('common.continue')}</button>
                </div>
            </div>
        `;

        this.backdrop.appendChild(popup);
        document.body.appendChild(this.backdrop);

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close button
        const closeBtn = this.backdrop.querySelector('.popup-close');
        closeBtn.addEventListener('click', () => this.hide());

        // Cancel button
        const cancelBtn = this.backdrop.querySelector('.btn-setup-cancel');
        cancelBtn.addEventListener('click', () => this.hide());

        // Continue button
        const continueBtn = this.backdrop.querySelector('.btn-setup-continue');
        continueBtn.addEventListener('click', () => this.handleContinue());

        // Radio button changes
        const radioButtons = this.backdrop.querySelectorAll('input[name="setup-type"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', () => {
                continueBtn.disabled = false;
            });
        });

        // Setup option clicks
        const setupOptions = this.backdrop.querySelectorAll('.setup-option');
        setupOptions.forEach(option => {
            option.addEventListener('change', () => {
                continueBtn.disabled = false;
            });
        });

        // Click outside to close
        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.hide();
            }
        });
    }

    handleContinue() {
        const selectedOption = this.backdrop.querySelector('input[name="setup-type"]:checked');
        if (!selectedOption) return;

        const setupType = selectedOption.value;

        if (setupType === 'existing') {
            this.handleExistingInstallation();
        } else if (setupType === 'download') {
            this.handleDownloadInstallation();
        }
    }

    async handleExistingInstallation() {
        try {
            // Use the existing browse folder functionality
            if (typeof window.executeCommand === 'function') {
                const folder = await window.executeCommand('browse-folder');
                if (folder) {
                    // Validate and save the installation path
                    const pathValid = await window.executeCommand('set-game-path', {
                        game: this.currentGame,
                        path: folder,
                        existing_install: true
                    });

                    if (!pathValid) {
                        // Path validation failed - show error message
                        if (typeof window.showMessageBox === 'function') {
                            window.showMessageBox(
                                this.t('popup.setup.invalidGamePathTitle'),
                                this.t('popup.setup.invalidGamePathBody', { game: this.currentGameDisplayName }),
                                [this.t('common.ok')]
                            );
                        } else {
                            alert(`The selected folder does not contain valid ${this.currentGameDisplayName} game files.`);
                        }
                        return; // Don't hide popup or trigger update
                    }

                    // Hide popup and trigger page refresh
                    this.hide();
                    this.triggerInstallationUpdate();
                } else {
                    console.log('No folder selected');
                }
            } else {
                console.log('Mock: Would browse for existing installation folder');
                this.hide();
            }
        } catch (error) {
            console.error('Error setting installation path:', error);
        }
    }

    async handleDownloadInstallation() {
        try {
            if (!await window.guardOnline()) return;

            const gameId = this.getGameIdFromMapping(this.currentGame);
            this.hide();

            if (gameId && typeof showManageInstall === 'function') {
                showManageInstall(gameId, {
                    detectExisting: false,
                    preferDefaultComponents: true,
                    startDownloadOnApply: true
                });
            } else {
                console.error('Manage Installation flow is not available for:', this.currentGame);
            }
        } catch (error) {
            console.error('Error opening Manage Installation:', error);
        }
    }

    getGameIdFromMapping(gameMapping) {
        return GameUtils.getUIIdFromBackendId(gameMapping);
    }

    triggerInstallationUpdate() {
        // Trigger a custom event that game pages can listen to
        window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
            detail: { game: this.currentGame }
        }));
    }
}
