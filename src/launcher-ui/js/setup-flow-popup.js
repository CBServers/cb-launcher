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
                <h3>Setup ${this.currentGameDisplayName}</h3>
                <button class="popup-close" type="button">×</button>
            </div>
            <div class="popup-content">
                <div class="setup-options">
                    <div class="setup-option" onclick="this.querySelector('input').checked = true; this.dispatchEvent(new Event('change', {bubbles: true}))">
                        <input type="radio" name="setup-type" value="existing" id="setup-existing">
                        <div class="radio-custom"></div>
                        <div class="setup-info">
                            <h4>I already have the game installed</h4>
                            <p>Select the folder where ${this.currentGameDisplayName} is installed on your computer.</p>
                        </div>
                    </div>
                    <div class="setup-option" onclick="this.querySelector('input').checked = true; this.dispatchEvent(new Event('change', {bubbles: true}))">
                        <input type="radio" name="setup-type" value="download" id="setup-download">
                        <div class="radio-custom"></div>
                        <div class="setup-info">
                            <h4>Download the game</h4>
                            <p>Download and install ${this.currentGameDisplayName} automatically through the launcher.</p>
                        </div>
                    </div>
                </div>
                <div class="setup-actions">
                    <button class="btn-setup-cancel" type="button">Cancel</button>
                    <button class="btn-setup-continue" type="button" disabled>Continue</button>
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
                            window.showMessageBox("Invalid Game Path",
                                `The selected folder does not contain valid ${this.currentGameDisplayName} game files. Please select the correct game installation folder.`, ["OK"]);
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

    handleDownloadInstallation() {
        // For now, just show a placeholder
        console.log('Download installation will be implemented later');
        alert(`Download functionality for ${this.currentGameDisplayName} will be implemented later.`);
        this.hide();
    }

    getInstallProperty(game) {
        const config = GameUtils.getGameConfig(game);
        return config ? config.installProperty : null;
    }

    triggerInstallationUpdate() {
        // Trigger a custom event that game pages can listen to
        window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
            detail: { game: this.currentGame }
        }));
    }

    static getGameDisplayName(game) {
        const config = GameUtils.getGameConfig(game);
        return config ? config.displayName : game;
    }
}