class ComponentSelectionPopup {
    constructor() {
        this.popup = null;
        this.backdrop = null;
        this.currentGame = null;
        this.gameConfig = null;
        this.components = null;
        this.installedComponents = [];
        this.selectedComponents = new Set();
        this.originalSelectedComponents = new Set(); // Track original selection
        this.componentSizes = {};
        this.availableSpace = 0;
        this.options = {};
        this.installPath = '';
        this.createPopup();
    }

    createPopup() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'component-selection-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'component-selection-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3 id="component-title">Manage Installation</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="install-path-section component-install-path-section" id="component-install-path-section" hidden>
                    <label id="component-install-location-label">Install Location</label>
                    <div class="input-group">
                        <input type="text" id="component-install-path" readonly />
                        <button class="browse-button" id="component-install-browse" type="button">Browse</button>
                    </div>
                </div>
                <div class="component-selection-section">
                    <div class="section-header">
                        <label id="component-manage-label">Manage Install</label>
                        <button class="btn-refresh" id="btn-refresh" title="Refresh component detection">
                            <svg class="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                            </svg>
                        </button>
                    </div>
                    <div class="components-list" id="components-list">
                        <!-- Components will be dynamically added here -->
                    </div>
                </div>
                <div class="install-download-info-section">
                    <label id="component-download-info-label">Download Info</label>
                    <div class="install-info-section">
                        <div class="install-info-row">
                            <span class="install-info-label" id="component-projected-size-label">Projected Size:</span>
                            <span class="install-info-value loading" id="download-size">Calculating...</span>
                        </div>
                        <div class="install-info-row">
                            <span class="install-info-label" id="component-available-space-label">Available Space:</span>
                            <span class="install-info-value loading" id="available-space">Calculating...</span>
                        </div>
                    </div>
                </div>
                <div class="popup-actions">
                    <button class="btn-uninstall">Uninstall</button>
                    <div class="popup-actions-right">
                        <button class="btn-cancel">Cancel</button>
                        <button class="btn-apply">Apply Changes</button>
                    </div>
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
        this.popup.querySelector('#component-manage-label').textContent = this.t('popup.componentSelection.header');
        this.popup.querySelector('#btn-refresh').title = this.t('popup.componentSelection.refreshTitle');
        this.popup.querySelector('#component-download-info-label').textContent = this.t('popup.componentSelection.downloadInfo');
        this.popup.querySelector('#component-projected-size-label').textContent = this.t('popup.componentSelection.projectedSize');
        this.popup.querySelector('#component-available-space-label').textContent = this.t('popup.componentSelection.availableSpace');
        this.popup.querySelector('#component-install-location-label').textContent = this.t('popup.componentSelection.installLocation');
        this.popup.querySelector('#component-install-browse').textContent = this.t('common.browse');
        this.popup.querySelector('#component-install-path').placeholder = this.t('popup.componentSelection.chooseInstallLocation');
        this.popup.querySelector('#download-size').textContent = this.t('popup.componentSelection.calculating');
        this.popup.querySelector('#available-space').textContent = this.t('popup.componentSelection.calculating');
        this.popup.querySelector('.btn-uninstall').textContent = this.t('popup.componentSelection.uninstall');
        this.popup.querySelector('.btn-cancel').textContent = this.t('common.cancel');
        this.popup.querySelector('.btn-apply').textContent = this.t('common.applyChanges');
    }

    bindEvents() {
        const closeBtn = this.popup.querySelector('.popup-close');
        const cancelBtn = this.popup.querySelector('.btn-cancel');
        const applyBtn = this.popup.querySelector('.btn-apply');
        const refreshBtn = this.popup.querySelector('.btn-refresh');
        const uninstallBtn = this.popup.querySelector('.btn-uninstall');
        const browseBtn = this.popup.querySelector('#component-install-browse');

        closeBtn.addEventListener('click', () => this.hide());
        cancelBtn.addEventListener('click', () => this.hide());
        applyBtn.addEventListener('click', () => this.applyChanges());
        refreshBtn.addEventListener('click', () => this.refreshDetection());
        uninstallBtn.addEventListener('click', () => this.uninstallGame());
        browseBtn.addEventListener('click', () => this.browseInstallPath());

        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.hide();
            }
        });
    }

    async show(game, gameConfig, options = {}) {
        this.currentGame = game;
        this.gameConfig = gameConfig;
        this.options = {
            detectExisting: true,
            preferDefaultComponents: false,
            startDownloadOnApply: false,
            ...options
        };
        this.installPath = '';
        this.refreshTexts();
        this.updateInstallPathSection();

        // Update title
        const title = this.popup.querySelector('#component-title');
        title.textContent = this.t('popup.componentSelection.titleWithGame', {
            game: gameConfig.displayName
        });

        // Fetch components and installed components
        await this.loadComponents();

        this.backdrop.style.display = 'flex';
        setTimeout(() => {
            this.backdrop.classList.add('active');
            this.popup.classList.add('active');
        }, 10);
    }

    hide() {
        this.backdrop.classList.remove('active');
        this.popup.classList.remove('active');

        setTimeout(() => {
            this.backdrop.style.display = 'none';
        }, 300);
    }

    async loadComponents() {
        try {
            // Get all component info in a single request (only 1 manifest fetch)
            // detectExisting: true tells backend to scan for installed components (only for Manage Install)
            const componentInfo = await window.executeCommand('get-game-component-info', {
                game: this.currentGame,
                detectExisting: this.options.detectExisting !== false
            });

            if (!componentInfo) {
                throw new Error('No component information returned');
            }

            this.components = componentInfo.components || {};
            this.componentSizes = componentInfo.sizes || {};

            // Check if detection is in progress
            if (componentInfo.detectionInProgress) {
                // Show loading spinner and poll
                this.showDetectionLoading();

                const pollInterval = setInterval(async () => {
                    const progress = await window.executeCommand('get-update-progress');

                    if (!progress.active) {
                        // Detection complete
                        clearInterval(pollInterval);

                        // Reload component info to get detected results
                        const updatedInfo = await window.executeCommand('get-game-component-info', {
                            game: this.currentGame,
                            detectExisting: true
                        });

                        this.installedComponents = updatedInfo.installed || [];
                        this.hideDetectionLoading();
                        this.finishLoadingComponents();
                    }
                }, 100); // Poll every 100ms
            } else {
                // Cache hit - instant response
                this.installedComponents = componentInfo.installed || [];
                this.finishLoadingComponents();
            }

        } catch (error) {
            console.error('Failed to load components:', error);
            this.showError(this.t('popup.componentSelection.loadError'));
        }
    }

    async finishLoadingComponents() {
        // Get install path and available space
        const installPath = await window.executeCommand('get-game-property', {
            game: this.currentGame,
            suffix: PROPERTY_KEYS.GAME.INSTALL
        });
        this.installPath = installPath || '';
        this.updateInstallPathSection();

        this.availableSpace = 0;
        if (this.installPath) {
            const spaceInfo = await window.executeCommand('get-available-space', { path: this.installPath });
            this.availableSpace = spaceInfo?.availableSpace || 0;
        }

        // Start with empty selection - only check required and installed components
        this.selectedComponents = new Set();

        const shouldUseDefaultSelection = this.options.preferDefaultComponents && this.installedComponents.length === 0;

        if (!shouldUseDefaultSelection) {
            // Select all installed components (they exist on disk)
            for (const comp of this.installedComponents) {
                this.selectedComponents.add(comp);
            }
        }

        // Ensure all required components are always selected. Setup download also selects default-enabled components.
        for (const [compId, compInfo] of Object.entries(this.components)) {
            if (compInfo.required || (shouldUseDefaultSelection && compInfo.defaultEnabled === true)) {
                this.selectedComponents.add(compId);
            }
        }

        // Save original selection for comparison later
        this.originalSelectedComponents = new Set(this.selectedComponents);

        // Render components
        this.renderComponents();
        this.updateSummary();
    }

    requiresInstallPath() {
        return this.options.startDownloadOnApply === true;
    }

    updateInstallPathSection() {
        const section = this.popup.querySelector('#component-install-path-section');
        const input = this.popup.querySelector('#component-install-path');

        if (!section || !input) return;

        section.hidden = !this.requiresInstallPath();
        input.value = this.installPath || '';
    }

    getDefaultDownloadPath(folder) {
        const defaultInstallPath = this.gameConfig ? this.gameConfig.defaultInstallPath : '';
        return defaultInstallPath ? `${folder}\\${defaultInstallPath}` : folder;
    }

    async browseInstallPath() {
        try {
            const folder = await window.executeCommand('browse-folder');
            if (!folder) return;

            this.installPath = this.getDefaultDownloadPath(folder);
            this.updateInstallPathSection();

            this.availableSpace = 0;
            const spaceInfo = await window.executeCommand('get-available-space', { path: this.installPath });
            this.availableSpace = spaceInfo?.availableSpace || 0;
            this.updateSummary();
        } catch (error) {
            console.error('Failed to browse install path:', error);
        }
    }

    showDetectionLoading() {
        // Clear component list and show loading spinner
        const componentsList = this.popup.querySelector('#components-list');
        if (!componentsList) return;

        componentsList.innerHTML = `
            <div class="detection-loading">
                <div class="spinner ${this.currentGame}"></div>
                <div class="loading-text">${this.t('popup.componentSelection.detectingInstalled')}</div>
                <div class="loading-text">${this.t('popup.componentSelection.detectionCanTakeMinutes')}</div>
            </div>
        `;
    }

    hideDetectionLoading() {
        const loadingElement = this.popup.querySelector('.detection-loading');
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    async refreshDetection() {
        // Disable refresh button to prevent spamming
        const refreshBtn = this.popup.querySelector('.btn-refresh');
        if (refreshBtn) {
            refreshBtn.disabled = true;
        }

        try {
            // Clear component list and show loading spinner
            this.showDetectionLoading();

            // Request component info with force refresh
            const componentInfo = await window.executeCommand('get-game-component-info', {
                game: this.currentGame,
                detectExisting: true,
                forceRefresh: true
            });

            if (!componentInfo) {
                throw new Error('No component information returned');
            }

            this.components = componentInfo.components || {};
            this.componentSizes = componentInfo.sizes || {};

            // Check if detection is in progress
            if (componentInfo.detectionInProgress) {
                // Poll for completion
                const pollInterval = setInterval(async () => {
                    const progress = await window.executeCommand('get-update-progress');

                    if (!progress.active) {
                        // Detection complete
                        clearInterval(pollInterval);

                        // Reload component info to get detected results
                        const updatedInfo = await window.executeCommand('get-game-component-info', {
                            game: this.currentGame,
                            detectExisting: true
                        });

                        this.installedComponents = updatedInfo.installed || [];
                        this.hideDetectionLoading();
                        this.finishLoadingComponents();
                    }
                }, 100); // Poll every 100ms
            } else {
                // Instant response (shouldn't happen on force refresh, but handle it)
                this.installedComponents = componentInfo.installed || [];
                this.hideDetectionLoading();
                this.finishLoadingComponents();
            }
        } catch (error) {
            console.error('Failed to refresh detection:', error);
            this.showError(this.t('popup.componentSelection.refreshError'));
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
            }
        }
    }

    renderComponents() {
        const componentsList = this.popup.querySelector('#components-list');
        componentsList.innerHTML = '';

        for (const [compId, compInfo] of Object.entries(this.components)) {
            const isInstalled = this.installedComponents.includes(compId);
            const isSelected = this.selectedComponents.has(compId);
            const isRequired = compInfo.required;
            const size = this.componentSizes[compId] || 0;
            const sizeGB = (size / (1024 * 1024 * 1024)).toFixed(2);

            const componentEl = document.createElement('div');
            componentEl.className = 'component-item';
            if (isInstalled) {
                componentEl.classList.add('installed');
            }

            componentEl.innerHTML = `
                <div class="component-checkbox">
                    <input type="checkbox"
                           id="comp-${compId}"
                           ${isSelected ? 'checked' : ''}
                           ${isRequired ? 'disabled' : ''}
                           data-component="${compId}">
                    <label for="comp-${compId}"></label>
                </div>
                <div class="component-info">
                    <div class="component-header">
                        <span class="component-name">
                            ${compInfo.displayName}
                            ${isRequired ? `<span class="component-badge required">${this.t('popup.componentSelection.required')}</span>` : ''}
                            ${isInstalled ? `<span class="component-badge installed">${this.t('popup.componentSelection.installed')}</span>` : ''}
                        </span>
                        <span class="component-size">${sizeGB} GB</span>
                    </div>
                </div>
            `;

            componentsList.appendChild(componentEl);

            // Add change event listener
            const checkbox = componentEl.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', () => this.handleComponentToggle(compId, checkbox.checked));

            // Make the entire component item clickable (unless it's required/disabled)
            if (!isRequired) {
                componentEl.style.cursor = 'pointer';
                componentEl.addEventListener('click', (e) => {
                    // Don't toggle if clicking directly on the checkbox (it will handle itself)
                    if (e.target === checkbox) {
                        return;
                    }
                    // Toggle the checkbox
                    checkbox.checked = !checkbox.checked;
                    // Trigger change event
                    checkbox.dispatchEvent(new Event('change'));
                });
            }
        }
    }

    handleComponentToggle(componentId, isChecked) {
        if (isChecked) {
            this.selectedComponents.add(componentId);
        } else {
            this.selectedComponents.delete(componentId);
        }

        this.updateSummary();
    }

    updateSummary() {
        // Calculate projected size: total size of ALL selected components
        // (both installed and uninstalled)
        let projectedSize = 0;

        // Track how much of the projected size is already on disk
        let alreadyInstalledSize = 0;

        for (const compId of this.selectedComponents) {
            const componentSize = this.componentSizes[compId] || 0;
            projectedSize += componentSize;

            // Track already installed portion
            if (this.installedComponents.includes(compId)) {
                alreadyInstalledSize += componentSize;
            }
        }

        // Actual download = what we need to fetch from CDN
        const actualDownloadSize = projectedSize - alreadyInstalledSize;

        const projectedSizeGB = (projectedSize / (1024 * 1024 * 1024)).toFixed(2);
        const availableSpaceGB = (this.availableSpace / (1024 * 1024 * 1024)).toFixed(2);

        const downloadSizeEl = this.popup.querySelector('#download-size');
        const availableSpaceEl = this.popup.querySelector('#available-space');
        const applyBtn = this.popup.querySelector('.btn-apply');

        downloadSizeEl.textContent = `${projectedSizeGB} GB`;
        downloadSizeEl.classList.remove('loading');

        availableSpaceEl.textContent = `${availableSpaceGB} GB`;
        availableSpaceEl.classList.remove('loading');

        // Validate against actual download size, not projected size
        // (because some components may already be installed)
        if (this.availableSpace > 0 && actualDownloadSize > 0 && this.availableSpace < actualDownloadSize) {
            availableSpaceEl.classList.add('error');
        } else {
            availableSpaceEl.classList.remove('error');
        }

        if (applyBtn) {
            applyBtn.disabled = this.requiresInstallPath() && !this.installPath;
        }
    }

    async applyChanges() {
        try {
            // Check if any changes were made
            const hasChanges = !this.setsAreEqual(this.selectedComponents, this.originalSelectedComponents);

            const shouldStartDownload = this.options.startDownloadOnApply === true;

            if (!hasChanges && !shouldStartDownload) {
                // Still save current selection to properties (ensures required components are persisted)
                const componentsArray = Array.from(this.selectedComponents);
                await window.executeCommand('set-game-components', {
                    game: this.currentGame,
                    components: componentsArray
                });
                // Close popup without starting verify
                this.hide();
                return;
            }

            // Determine if components are being deselected (potential file deletion)
            const deselectedComponents = this.installedComponents.filter(
                comp => !this.selectedComponents.has(comp)
            );
            const willDeleteFiles = hasChanges && deselectedComponents.length > 0;

            // Show confirmation dialog BEFORE saving
            if (typeof window.showMessageBox === 'function') {
                let message = this.t('popup.componentSelection.confirmChangesBody');

                if (willDeleteFiles) {
                    message += `\n\n${this.t('popup.componentSelection.confirmChangesWarning')}`;
                }

                const result = await window.showMessageBox(
                    this.t('popup.componentSelection.confirmChangesTitle'),
                    message,
                    [this.t('common.cancel'), this.t('common.confirm')]
                );

                // User clicked Cancel (button index 0)
                if (result === 0) {
                    return;
                }
            }

            if (shouldStartDownload) {
                if (!this.installPath) {
                    this.showError(this.t('popup.componentSelection.installPathRequiredBody'));
                    return;
                }

                const pathSet = await window.executeCommand('set-game-path', {
                    game: this.currentGame,
                    path: this.installPath,
                    existing_install: false
                });

                if (!pathSet) {
                    this.showError(this.t('popup.componentSelection.installPathSaveFailed'));
                    return;
                }
            }

            // User confirmed - save selected components
            const componentsArray = Array.from(this.selectedComponents);
            await window.executeCommand('set-game-components', {
                game: this.currentGame,
                components: componentsArray
            });

            // Close popup
            this.hide();

            // Auto-start verification (pass willDeleteFiles to enable component deletion)
            const gameId = GameUtils.getUIIdFromBackendId(this.currentGame);
            if (gameId) {
                verifyGame(gameId, willDeleteFiles);
            }

        } catch (error) {
            console.error('Failed to save component selection:', error);
            this.showError(this.t('popup.componentSelection.saveFailed'));
        }
    }

    async uninstallGame() {
        if (typeof window.showMessageBox === 'function') {
            const result = await window.showMessageBox(
                this.t('popup.componentSelection.confirmUninstallTitle'),
                this.t('popup.componentSelection.confirmUninstallBody', { game: this.gameConfig.displayName }),
                [this.t('common.cancel'), this.t('popup.componentSelection.uninstall')]
            );

            // User clicked Cancel (button index 0)
            if (result === 0) {
                return;
            }
        }

        // Close popup
        this.hide();

        const gameId = GameUtils.getUIIdFromBackendId(this.currentGame);
        const gameDisplayName = this.gameConfig.displayName;

        // Execute uninstall command with progress tracking
        try {
            await GameUtils.trackCommandProgress({
                gameId: gameId,
                command: 'delete-game',
                commandArgs: { game: this.currentGame },
                initialMessage: this.t('popup.componentSelection.uninstalling', { game: gameDisplayName }),
                completeMessage: this.t('progress.uninstallComplete'),
                onComplete: () => {
                    // Refresh game UI
                    if (gameId && typeof refreshGameStatus === 'function') {
                        refreshGameStatus(gameId);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to uninstall game:', error);
        }
    }

    setsAreEqual(setA, setB) {
        if (setA.size !== setB.size) return false;
        for (const item of setA) {
            if (!setB.has(item)) return false;
        }
        return true;
    }

    showError(message) {
        if (typeof window.showMessageBox === 'function') {
            window.showMessageBox(this.t('popup.componentSelection.errorTitle'), message, [this.t('common.ok')]);
        } else {
            alert(message);
        }
    }
}
