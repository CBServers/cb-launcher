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

    async handleDownloadInstallation() {
        try {
            // Check if install path is already set (e.g., from a previous cancelled download)
            const gameConfig = GameUtils.getGameConfig(this.currentGame);
            if (!gameConfig) {
                console.error('Game config not found');
                return;
            }

            let fullPath = null;

            if (typeof window.executeCommand === 'function') {
                // Check for existing install path
                const existingPath = await window.executeCommand('get-game-property', {
                    game: this.currentGame,
                    suffix: 'install'
                });

                if (existingPath && existingPath.trim() !== '') {
                    // Path already exists, use it directly
                    console.log('Using existing install path:', existingPath);
                    fullPath = existingPath;
                } else {
                    // No existing path, browse for folder
                    const folder = await window.executeCommand('browse-folder');
                    if (!folder) {
                        console.log('No folder selected');
                        return;
                    }

                    // Append defaultInstallPath to the selected folder
                    const defaultInstallPath = gameConfig.defaultInstallPath || '';

                    // Combine folder with default install path
                    console.log('Selected folder:', folder);
                    fullPath = defaultInstallPath
                        ? `${folder}\\${defaultInstallPath}`
                        : folder;
                    console.log('Full path:', fullPath);
                }

                // Show install confirmation popup with download info
                this.showInstallConfirmation(fullPath);
            } else {
                console.log('Mock: Would browse for download location folder');
                this.hide();
            }
        } catch (error) {
            console.error('Error selecting download location:', error);
        }
    }

    async showInstallConfirmation(installPath) {
        // Hide the setup flow popup first
        this.hide();

        // Create install confirmation backdrop
        const installBackdrop = document.createElement('div');
        installBackdrop.className = 'install-confirm-backdrop';

        // Create install confirmation popup
        const installPopup = document.createElement('div');
        installPopup.className = 'install-confirm-popup';

        installPopup.innerHTML = `
            <div class="popup-header">
                <h3>Install ${this.currentGameDisplayName}</h3>
                <button class="popup-close" type="button">×</button>
            </div>
            <div class="popup-content">
                <div class="install-path-section">
                    <label>Install Location</label>
                    <div class="input-group">
                        <input type="text" id="install-path-display" value="${installPath}" readonly />
                        <button class="browse-button" id="install-browse-btn" type="button">Browse</button>
                    </div>
                </div>
                <div class="component-selection-section">
                    <label>Select Components</label>
                    <div class="components-list-compact" id="install-components-list">
                        <div class="detection-loading">
                            <div class="spinner"></div>
                            <div class="loading-text">Loading components...</div>
                        </div>
                    </div>
                </div>
                <div class="install-download-info-section">
                    <label>Download Info</label>
                    <div class="install-info-section">
                        <div class="install-info-row">
                            <span class="install-info-label">Projected Size:</span>
                            <span class="install-info-value loading" id="install-game-size">Loading...</span>
                        </div>
                        <div class="install-info-row">
                            <span class="install-info-label">Available Space:</span>
                            <span class="install-info-value loading" id="install-available-space">Loading...</span>
                        </div>
                    </div>
                </div>
                <div class="install-actions">
                    <button class="btn-install-cancel" type="button">Cancel</button>
                    <button class="btn-install" type="button" id="btn-confirm-install" disabled>Install</button>
                </div>
            </div>
        `;

        installBackdrop.appendChild(installPopup);
        document.body.appendChild(installBackdrop);

        // Keep track of current install path
        let currentInstallPath = installPath;

        // Setup event listeners
        const closeBtn = installBackdrop.querySelector('.popup-close');
        const cancelBtn = installBackdrop.querySelector('.btn-install-cancel');
        const installBtn = installBackdrop.querySelector('#btn-confirm-install');
        const browseBtn = installBackdrop.querySelector('#install-browse-btn');
        const pathDisplay = installBackdrop.querySelector('#install-path-display');

        const hideInstallPopup = () => {
            document.body.removeChild(installBackdrop);
        };

        closeBtn.addEventListener('click', hideInstallPopup);
        cancelBtn.addEventListener('click', hideInstallPopup);

        // Browse button click handler
        browseBtn.addEventListener('click', async () => {
            try {
                if (typeof window.executeCommand === 'function') {
                    const folder = await window.executeCommand('browse-folder');
                    if (folder) {
                        // Append defaultInstallPath to the selected folder
                        const gameConfig = GameUtils.getGameConfig(this.currentGame);
                        const defaultInstallPath = gameConfig ? gameConfig.defaultInstallPath : '';

                        // Combine folder with default install path
                        const newPath = defaultInstallPath
                            ? `${folder}\\${defaultInstallPath}`
                            : folder;

                        // Update the path display
                        currentInstallPath = newPath;
                        pathDisplay.value = newPath;

                        // Refresh download info with new path
                        await updateDownloadInfo(newPath);
                    }
                }
            } catch (error) {
                console.error('Error browsing for new path:', error);
            }
        });

        // Click outside to close
        installBackdrop.addEventListener('click', (e) => {
            if (e.target === installBackdrop) {
                hideInstallPopup();
            }
        });

        // Component selection state
        let components = {};
        let componentSizes = {};
        let selectedComponents = new Set();

        // Function to load and render components
        const loadComponents = async () => {
            try {
                if (typeof window.executeCommand === 'function') {
                    const componentInfo = await window.executeCommand('get-game-component-info', {
                        game: this.currentGame,
                        detectExisting: false
                    });

                    if (componentInfo) {
                        components = componentInfo.components || {};
                        componentSizes = componentInfo.sizes || {};

                        // Select only components with defaultEnabled: true
                        selectedComponents = new Set();
                        for (const [compId, compInfo] of Object.entries(components)) {
                            if (compInfo.defaultEnabled === true) {
                                selectedComponents.add(compId);
                            }
                        }

                        renderComponents();
                    }
                }
            } catch (error) {
                console.error('Failed to load components:', error);
            }
        };

        // Function to render components in the list
        const renderComponents = () => {
            const componentsList = installBackdrop.querySelector('#install-components-list');
            componentsList.innerHTML = '';

            for (const [compId, compInfo] of Object.entries(components)) {
                const isSelected = selectedComponents.has(compId);
                const isRequired = compInfo.required;
                const size = componentSizes[compId] || 0;
                const sizeGB = (size / (1024 * 1024 * 1024)).toFixed(2);

                const componentEl = document.createElement('div');
                componentEl.className = 'component-item';

                componentEl.innerHTML = `
                    <div class="component-checkbox">
                        <input type="checkbox"
                               id="install-comp-${compId}"
                               ${isSelected ? 'checked' : ''}
                               ${isRequired ? 'disabled' : ''}
                               data-component="${compId}">
                        <label for="install-comp-${compId}"></label>
                    </div>
                    <div class="component-info">
                        <div class="component-header">
                            <span class="component-name">
                                ${compInfo.displayName}
                                ${isRequired ? '<span class="component-badge required">Required</span>' : ''}
                            </span>
                            <span class="component-size">${sizeGB} GB</span>
                        </div>
                    </div>
                `;

                componentsList.appendChild(componentEl);

                // Add change event listener
                const checkbox = componentEl.querySelector('input[type="checkbox"]');
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedComponents.add(compId);
                    } else {
                        selectedComponents.delete(compId);
                    }
                    updateDownloadInfo(currentInstallPath);
                });

                // Make the entire component item clickable (unless it's required/disabled)
                if (!isRequired) {
                    componentEl.style.cursor = 'pointer';
                    componentEl.addEventListener('click', (e) => {
                        if (e.target === checkbox) {
                            return;
                        }
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change'));
                    });
                }
            }
        };

        // Load components first
        await loadComponents();

        // Function to update download info based on selected components
        const updateDownloadInfo = async (path) => {
            const gameSizeEl = installBackdrop.querySelector('#install-game-size');
            const availableSpaceEl = installBackdrop.querySelector('#install-available-space');

            // Reset to loading state
            gameSizeEl.textContent = 'Loading...';
            availableSpaceEl.textContent = 'Loading...';
            gameSizeEl.className = 'install-info-value loading';
            availableSpaceEl.className = 'install-info-value loading';
            installBtn.disabled = true;

            try {
                // Calculate projected size from selected components
                let projectedSize = 0;
                for (const compId of selectedComponents) {
                    projectedSize += componentSizes[compId] || 0;
                }

                if (typeof window.executeCommand === 'function') {
                    // Get available space
                    const spaceInfo = await window.executeCommand('get-available-space', { path: path });
                    const availableSpace = spaceInfo?.availableSpace || 0;

                    // Update projected size
                    gameSizeEl.textContent = GameUtils.formatBytes(projectedSize);
                    gameSizeEl.classList.remove('loading');

                    // Update available space
                    availableSpaceEl.textContent = GameUtils.formatBytes(availableSpace);
                    availableSpaceEl.classList.remove('loading');

                    // Check if there's enough space
                    if (availableSpace > 0 && availableSpace < projectedSize) {
                        availableSpaceEl.classList.add('error');
                        installBtn.disabled = true;

                        // Show error message
                        if (typeof window.showMessageBox === 'function') {
                            window.showMessageBox("Insufficient Space",
                                `Not enough space available. You need ${GameUtils.formatBytes(projectedSize)} but only have ${GameUtils.formatBytes(availableSpace)} available.`, ["OK"]);
                        }
                    } else if (availableSpace > 0 && availableSpace < projectedSize * 1.1) {
                        // Less than 10% overhead, show warning
                        availableSpaceEl.classList.add('warning');
                        installBtn.disabled = false;
                    } else {
                        installBtn.disabled = false;
                    }
                } else {
                    // Mock for development
                    console.log('Mock: Would get download info');
                    gameSizeEl.textContent = GameUtils.formatBytes(projectedSize);
                    gameSizeEl.classList.remove('loading');
                    installBtn.disabled = false;
                }
            } catch (error) {
                console.error('Error getting download info:', error);
                gameSizeEl.textContent = 'Error';
                availableSpaceEl.textContent = 'Error';
                gameSizeEl.classList.remove('loading');
                availableSpaceEl.classList.remove('loading');
            }
        };

        // Get initial download info
        await updateDownloadInfo(currentInstallPath);

        // Install button click handler
        installBtn.addEventListener('click', async () => {
            try {
                hideInstallPopup();

                if (typeof window.executeCommand === 'function') {
                    // Save selected components first
                    const componentsArray = Array.from(selectedComponents);
                    await window.executeCommand('set-game-components', {
                        game: this.currentGame,
                        components: componentsArray
                    });

                    // Set the game path with existing_install = false
                    const pathSet = await window.executeCommand('set-game-path', {
                        game: this.currentGame,
                        path: currentInstallPath,
                        existing_install: false
                    });

                    if (pathSet) {
                        // Trigger game installation update event
                        this.triggerInstallationUpdate();

                        // Start the download by calling verify-files
                        // The verify-files command will detect missing files and download them
                        await this.startGameDownload();
                    } else {
                        if (typeof window.showMessageBox === 'function') {
                            window.showMessageBox("Installation Error",
                                `Failed to set installation path for ${this.currentGameDisplayName}.`, ["OK"]);
                        }
                    }
                } else {
                    console.log('Mock: Would start installation');
                }
            } catch (error) {
                console.error('Error starting installation:', error);
                if (typeof window.showMessageBox === 'function') {
                    window.showMessageBox("Installation Error",
                        `An error occurred while starting the installation: ${error.message}`, ["OK"]);
                }
            }
        });
    }

    async startGameDownload() {
        const gameId = this.getGameIdFromMapping(this.currentGame);

        if (!gameId) {
            console.error('Could not determine game ID for:', this.currentGame);
            return;
        }

        return GameUtils.trackCommandProgress({
            gameId: gameId,
            command: 'verify-game',
            commandArgs: { game: this.currentGame },
            initialMessage: `Downloading ${window.GameInstallationManager.getGameDisplayName(gameId)}...`,
            completeMessage: 'Download complete!',
            onComplete: () => {
                // Trigger UI update to show PLAY buttons now that download is complete
                this.triggerInstallationUpdate();
            }
        }).catch(error => {
            console.error('Failed to start download:', error);
        });
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

    static getGameDisplayName(game) {
        const config = GameUtils.getGameConfig(game);
        return config ? config.displayName : game;
    }
}