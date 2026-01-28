window.addEventListener("load", initialize);

// Handle case where executeCommand might not be available
if (typeof window.executeCommand === 'function') {
    window.channel = window.executeCommand("get-channel");
} else {
    // Fallback for testing without the CEF backend
    window.channel = Promise.resolve("main");
    window.executeCommand = function(command, ...args) {
        console.log("Mock executeCommand:", command, ...args);
        return Promise.resolve(null);
    };
}

// Session-only console visibility state (resets on launcher restart)
let consoleVisible = false;

// Game data is now handled individually in each page's HTML file

function sleep(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}

function makeSleep(milliseconds) {
    return () => sleep(milliseconds);
}

function waitForAllImages() {
    return new Promise(resolve => {
        function waitForAllImagesInternal() {
            const images = document.querySelectorAll('img');

            for (var i = 0; i < images.length; ++i) {
                if (!images[i].complete) {
                    window.requestAnimationFrame(waitForAllImagesInternal);
                    return;
                }
            }

            resolve();
        }

        waitForAllImagesInternal();
    });
}

function addStyleElement(css) {
    var head = document.head || document.getElementsByTagName('head')[0],
        style = document.createElement('style');

    head.appendChild(style);

    style.type = 'text/css';
    if (style.styleSheet) {
        // This is required for IE8 and below.
        style.styleSheet.cssText = css;
    } else {
        style.appendChild(document.createTextNode(css));
    }
}

function getOtherChannel(channel) {
    if (channel == "main") {
        return "dev";
    }
    return "main";
}

function adjustChannelElements() {
    window.channel.then(channel => {
        addStyleElement(`.channel-${getOtherChannel(channel)}{display: none;}`);
    });
}

// All game-specific functionality is now handled in individual page files

function initialize() {
    // Remove hidden class immediately to show the UI
    document.body.classList.remove('hidden');

    // Preload all game images first
    preloadGameImages().then(() => {
        console.log('All game images preloaded');
        // Load sidebar icons safely
        loadSidebarIcons();
    });

    initializeNavigation()
        .then(() => waitForAllImages())
        .then(makeSleep(300))
        .then(() => {
            // Try to call show command, but don't break if it fails
            try {
                window.executeCommand("show");
            } catch (error) {
                console.log("Show command not available:", error);
            }

            // Start game state polling
            if (window.GameStateManager) {
                window.GameStateManager.startPolling();
            }
        });

    document.querySelector("#minimize-button").onclick = () => {
        try {
            window.executeCommand("minimize");
        } catch (error) {
            console.log("Minimize command not available:", error);
        }
    };

    document.querySelector("#close-button").onclick = () => {
        try {
            window.executeCommand("close");
        } catch (error) {
            console.log("Close command not available:", error);
        }
    };

    // Handle external links on support and game pages - open in default browser
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        // Only handle links within support-page, game pages, and settings-page
        const isInTargetPage = link.closest('#support-page') || link.closest('.game-page') || link.closest('#settings-page');
        if (!isInTargetPage) return;

        // Only handle http/https links
        if (link.href && link.href.startsWith('http')) {
            e.preventDefault();
            window.executeCommand('open-url', { url: link.href });
        }
    });

    adjustChannelElements();
}

window.showSettings = function() {
    document.querySelector("#settings").click();
}

async function initializeNavigation() {
    // Handle home navigation
    const homeElement = document.querySelector("#home");
    homeElement.addEventListener("click", handleHomeClick);

    // Handle game navigation
    const gameElements = document.querySelectorAll(".game-item");
    gameElements.forEach(el => {
        el.addEventListener("click", handleGameClick);
    });

    // Handle settings navigation
    const settingsElement = document.querySelector("#settings");
    settingsElement.addEventListener("click", handleSettingsClick);

    // Handle support navigation
    const supportElement = document.querySelector("#support");
    supportElement.addEventListener("click", handleSupportClick);

    // Try to load last game page if restore setting is enabled
    let pageToLoad = "home";
    try {
        if (typeof window.executeCommand === 'function') {
            // Check if restore-last-page setting is enabled (default: true)
            const restoreEnabled = await window.executeCommand('get-property', 'launcher-restore-last-page');

            // Default to true if not set, or if explicitly set to 'true'
            const shouldRestore = restoreEnabled === null || restoreEnabled === 'true';

            if (shouldRestore) {
                const lastGamePage = await window.executeCommand('get-property', 'last-game-page');
                // Verify it's a valid game page
                if (lastGamePage && GameUtils.getAllGameIds().includes(lastGamePage)) {
                    pageToLoad = lastGamePage;
                    console.log(`Restoring last game page: ${lastGamePage}`);

                    // Set the appropriate navigation item as active
                    const gameItem = document.querySelector(`.game-item[data-game="${lastGamePage}"]`);
                    if (gameItem) {
                        removeActiveNavigation();
                        gameItem.classList.add("active");
                        gameItem.classList.add(`${lastGamePage}-active`);
                    }
                }
            } else {
                console.log('Restore last page disabled, loading home');
            }
        }
    } catch (error) {
        console.error('Failed to load last game page:', error);
    }

    // Initialize with the determined page
    return loadNavigationPage(pageToLoad);
}

function removeActiveNavigation() {
    // Remove active from nav items
    const activeNavItem = document.querySelector(".nav-item.active");
    if (activeNavItem) {
        activeNavItem.classList.remove("active");
    }

    // Remove active from game items and game-specific classes
    const activeGameItem = document.querySelector(".game-item.active");
    if (activeGameItem) {
        activeGameItem.classList.remove("active");
        // Remove all game-specific active classes
        activeGameItem.classList.remove(...GameUtils.getGameActiveClasses());
    }
}

function handleHomeClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("home");
}

function handleGameClick(e) {
    try {
        const el = this;
        const gameId = el.dataset.game;

        if (!gameId) {
            console.error("No game ID found in data-game attribute");
            return;
        }

        if (el.classList.contains("active")) {
            return;
        }

        removeActiveNavigation();
        el.classList.add("active");
        // Add game-specific active class for color matching
        el.classList.add(`${gameId}-active`);
        loadNavigationPage(gameId).catch(error => {
            console.error(`Failed to load game page ${gameId}:`, error);
            // Remove active class if loading failed
            el.classList.remove("active", `${gameId}-active`);
        });
    } catch (error) {
        console.error("Error in handleGameClick:", error);
    }
}

function handleSettingsClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("settings");
}

function handleSupportClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("support");
}

// setInnerHTML function removed - no longer needed with single page approach

function loadBackgroundImage(gameId) {
    const heroSection = document.querySelector(`.hero-section.${gameId}`);
    if (!heroSection || !gameId) return;

    const imagePath = GameUtils.getHeroImagePath(gameId);
    if (!imagePath) return;

    if (preloadedImages[imagePath]) {
        // Image is already preloaded, apply immediately
        heroSection.style.backgroundImage = `url('${imagePath}')`;
        heroSection.style.backgroundSize = 'cover';
        heroSection.style.backgroundPosition = 'center';
        heroSection.style.backgroundRepeat = 'no-repeat';
        console.log(`Background image loaded for ${gameId} (from cache)`);
    } else {
        // Fallback to loading on demand
        const img = new Image();
        img.onload = function() {
            heroSection.style.backgroundImage = `url('${imagePath}')`;
            heroSection.style.backgroundSize = 'cover';
            heroSection.style.backgroundPosition = 'center';
            heroSection.style.backgroundRepeat = 'no-repeat';
            console.log(`Background image loaded for ${gameId}`);
        };
        img.onerror = function() {
            console.log(`Background image failed to load for ${gameId}, using gradient fallback`);
            heroSection.style.backgroundImage = 'none';
        };
        img.src = imagePath;
    }
}

function loadHomeBackgroundImage() {
    const heroSection = document.querySelector('.hero-section.home');
    if (!heroSection) return;

    const imagePath = './img/cb-hero.png';

    if (preloadedImages[imagePath]) {
        // Image is already preloaded, apply immediately
        heroSection.style.backgroundImage = `url('${imagePath}')`;
        heroSection.style.backgroundSize = 'cover';
        heroSection.style.backgroundPosition = 'center';
        heroSection.style.backgroundRepeat = 'no-repeat';
        console.log('CB hero background image loaded (from cache)');
    } else {
        // Fallback to loading on demand
        const img = new Image();
        img.onload = function() {
            heroSection.style.backgroundImage = `url('${imagePath}')`;
            heroSection.style.backgroundSize = 'cover';
            heroSection.style.backgroundPosition = 'center';
            heroSection.style.backgroundRepeat = 'no-repeat';
            console.log('CB hero background image loaded');
        };
        img.onerror = function() {
            console.log('CB hero background image failed to load, using gradient fallback');
            heroSection.style.backgroundImage = 'none';
        };
        img.src = imagePath;
    }
}

// Cache for preloaded images
const preloadedImages = {};

function preloadGameImages() {
    const imageMap = GameUtils.getAllGameImages();

    return Promise.all(
        Object.entries(imageMap).map(([gameId, imagePaths]) => {
            return Promise.all(
                imagePaths.map(imagePath => {
                    return new Promise((resolve) => {
                        const img = new Image();
                        img.onload = function() {
                            preloadedImages[imagePath] = img;
                            console.log(`Preloaded image: ${imagePath}`);
                            resolve(true);
                        };
                        img.onerror = function() {
                            console.log(`Failed to preload image: ${imagePath}`);
                            resolve(false);
                        };
                        img.src = imagePath;
                    });
                })
            );
        })
    );
}

function loadSidebarIcons() {
    const gameIds = GameUtils.getAllGameIds();

    gameIds.forEach(gameId => {
        const thumbnail = document.querySelector(`.${gameId}-thumb`);
        if (!thumbnail) return;

        const imagePath = GameUtils.getIconPath(gameId);
        if (preloadedImages[imagePath]) {
            // Image is already preloaded, apply immediately
            thumbnail.style.backgroundImage = `url('${imagePath}')`;
            console.log(`Sidebar icon loaded for ${gameId} (from cache)`);
        } else {
            // Fallback to loading on demand
            const img = new Image();
            img.onload = function() {
                thumbnail.style.backgroundImage = `url('${imagePath}')`;
                console.log(`Sidebar icon loaded for ${gameId}`);
            };
            img.onerror = function() {
                console.log(`Sidebar icon failed to load for ${gameId}, using gradient fallback`);
            };
            img.src = imagePath;
        }
    });
}

// Game Installation Manager
window.GameInstallationManager = {
    async checkInstallation(gameId) {
        const installStatus = await checkGameInstallation(gameId);
        return installStatus.status === 'installed';
    },

    getInstallProperty(gameId) {
        const config = GameUtils.getGameConfigByUIId(gameId);
        return config ? config.installProperty : null;
    },

    getGameMapping(gameId) {
        return GameUtils.getGameMapping(gameId);
    },

    getGameDisplayName(gameId) {
        const config = GameUtils.getGameConfigByUIId(gameId);
        return config ? config.displayName : gameId;
    }
};

// Game State Manager - Continuously monitors game states and updates UI
window.GameStateManager = {
    pollInterval: null,
    isPolling: false,
    gameStates: {},
    pollIntervalMs: 500, // Check every half second

    async checkGameRunning(gameId) {
        // Check if a game is currently running
        // This requires a backend command to check process status
        try {
            if (typeof window.executeCommand === 'function') {
                const gameMapping = GameUtils.getGameMapping(gameId);
                const isRunning = await window.executeCommand('is-game-running', { game: gameMapping });
                return isRunning === true || isRunning === 'true';
            }
        } catch (error) {
            console.error(`Error checking if ${gameId} is running:`, error);
        }
        return false;
    },

    async updateGameState(gameId) {
        // Get current installation status
        const installStatus = await checkGameInstallation(gameId);

        // Check if game is running
        const isRunning = await this.checkGameRunning(gameId);

        // Store the state
        const previousState = this.gameStates[gameId];
        this.gameStates[gameId] = {
            installStatus: installStatus.status,
            isRunning: isRunning,
            hasAnySetup: installStatus.hasAnySetup
        };

        // Check if state changed
        const stateChanged = !previousState ||
            previousState.installStatus !== installStatus.status ||
            previousState.isRunning !== isRunning;

        return stateChanged;
    },

    async updateAllGameStates() {
        const gameIds = GameUtils.getAllGameIds();

        // Find which game page is currently visible
        let visibleGameId = null;
        for (const gameId of gameIds) {
            const gamePage = document.getElementById(`${gameId}-page`);
            if (gamePage && gamePage.style.display !== 'none') {
                visibleGameId = gameId;
                break;
            }
        }

        // Only poll the visible game page
        if (visibleGameId) {
            const stateChanged = await this.updateGameState(visibleGameId);

            // Update buttons if state changed
            if (stateChanged) {
                console.log(`${visibleGameId} state changed, updating buttons`);
                await createGameButtons(visibleGameId);
            }
        }
        // If no game page is visible (home/settings), skip polling to save resources
    },

    startPolling() {
        if (this.isPolling) {
            console.log('GameStateManager: Already polling');
            return;
        }

        console.log('GameStateManager: Starting state polling');
        this.isPolling = true;

        // Initial update
        this.updateAllGameStates();

        // Start interval
        this.pollInterval = setInterval(() => {
            this.updateAllGameStates();
        }, this.pollIntervalMs);
    },

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.isPolling = false;
        console.log('GameStateManager: Stopped state polling');
    },

    getGameState(gameId) {
        return this.gameStates[gameId] || null;
    }
};

// Global Progress Manager
window.ProgressManager = {
    isActive: false,
    currentGame: null,
    cancelCallback: null,

    show: function(gameId, message = 'Processing...', onCancel = null) {
        const progressBar = document.getElementById('global-progress-bar');
        const progressInfo = document.getElementById('progress-info');
        const progressGameIcon = document.getElementById('progress-game-icon');
        const progressFill = document.getElementById('global-progress-fill');
        const progressPercent = document.getElementById('global-progress-percent');
        const cancelBtn = document.getElementById('progress-cancel-btn');
        const windowEl = document.querySelector('.window');

        if (!progressBar) {
            console.error('Global progress bar not found');
            return;
        }

        this.isActive = true;
        this.currentGame = gameId;
        this.cancelCallback = onCancel;

        // Apply game-specific theming
        progressBar.className = 'global-progress-bar';
        if (gameId) {
            progressBar.classList.add(gameId);
        }

        // Set game icon
        progressGameIcon.className = 'progress-game-icon';
        if (gameId) {
            progressGameIcon.classList.add(gameId);

            // Try to load the actual game image if it's preloaded
            const imagePath = GameUtils.getIconPath(gameId);
            if (imagePath && preloadedImages[imagePath]) {
                progressGameIcon.style.backgroundImage = `url('${imagePath}')`;
            }
        }

        // Set initial state
        progressInfo.textContent = message;
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';

        // Setup cancel button
        if (cancelBtn) {
            cancelBtn.onclick = () => this.cancel();
        }

        // Disable all game buttons
        this.disableButtons();

        // Show progress bar and adjust window padding
        progressBar.style.display = 'flex';
        windowEl.classList.add('progress-active');
    },

    update: function(progress, message = null) {
        const progressInfo = document.getElementById('progress-info');
        const progressFill = document.getElementById('global-progress-fill');
        const progressPercent = document.getElementById('global-progress-percent');

        if (message) {
            progressInfo.textContent = message;
        }

        progressFill.style.width = `${progress}%`;
        progressPercent.textContent = `${progress.toFixed(2)}%`;
    },

    cancel: function() {
        if (this.cancelCallback) {
            this.cancelCallback();
        }
        this.hide();
    },

    hide: function() {
        const progressBar = document.getElementById('global-progress-bar');
        const windowEl = document.querySelector('.window');

        if (progressBar) {
            progressBar.style.display = 'none';
            progressBar.className = 'global-progress-bar'; // Reset theming
        }
        if (windowEl) {
            windowEl.classList.remove('progress-active');
        }

        // Re-enable all game buttons
        this.enableButtons();

        this.isActive = false;
        this.currentGame = null;
        this.cancelCallback = null;
    },

    disableButtons: function() {
        const buttons = document.querySelectorAll('.play-button, .verify-button, .manage-install-button, .unlock-all-button, .setup-button, .stop-button');
        buttons.forEach(btn => {
            btn.disabled = true;
        });
        console.log(`Disabled ${buttons.length} buttons`);
    },

    enableButtons: function() {
        const buttons = document.querySelectorAll('.play-button, .verify-button, .manage-install-button, .unlock-all-button, .setup-button, .stop-button');
        buttons.forEach(btn => {
            btn.disabled = false;
        });
        console.log(`Enabled ${buttons.length} buttons`);
    }
};

function loadNavigationPage(page) {
    console.log(`Loading page: ${page}`);

    // Hide all page sections
    const allPages = document.querySelectorAll('.page-section');
    allPages.forEach(pageEl => {
        pageEl.style.display = 'none';
    });

    // Show the target page
    const targetPage = document.getElementById(`${page}-page`);
    if (!targetPage) {
        console.error(`Page not found: ${page}-page`);
        return Promise.reject(`Page not found: ${page}-page`);
    }

    // Use flex layout for settings page to anchor footer to bottom
    targetPage.style.display = (page === 'settings') ? 'flex' : 'block';

    // Save last game page (exclude home and settings)
    if (GameUtils.getAllGameIds().includes(page)) {
        if (typeof window.executeCommand === 'function') {
            window.executeCommand('set-property', { 'last-game-page': page }).catch(error => {
                console.error('Failed to save last game page:', error);
            });
        }
    }

    // Initialize page-specific functionality
    if (page === 'settings') {
        initializeSettingsPage();
    } else if (GameUtils.getAllGameIds().includes(page)) {
        initializeGamePage(page);
    }

    // Load background images
    if (GameUtils.getAllGameIds().includes(page)) {
        loadBackgroundImage(page);
    } else if (page === 'home') {
        loadHomeBackgroundImage();
    } else {
        // Clear background image for other pages - no need to clear since each page has its own hero section
    }

    // Handle progress manager state
    if (window.ProgressManager && window.ProgressManager.isActive) {
        setTimeout(() => {
            window.ProgressManager.disableButtons();
        }, 0);
    }

    return Promise.resolve();
}

// Game page initialization
let gamePopups = {};

function initializeGamePage(gameId) {
    console.log(`Initializing game page: ${gameId}`);

    // Initialize popups if not already done
    if (!gamePopups[gameId]) {
        gamePopups[gameId] = {
            gameModePopup: null,
            gameSettingsPopup: null,
            setupFlowPopup: null
        };
    }

    // Create buttons for the game
    createGameButtons(gameId);
}

async function createGameButtons(gameId) {
    const buttonGroup = document.getElementById(`${gameId}-button-group`);
    if (!buttonGroup) return;

    // Get game state from StateManager if available, otherwise check directly
    let gameState = window.GameStateManager.getGameState(gameId);
    if (!gameState) {
        const installStatus = await checkGameInstallation(gameId);
        const isRunning = await window.GameStateManager.checkGameRunning(gameId);
        gameState = {
            installStatus: installStatus.status,
            isRunning: isRunning,
            hasAnySetup: installStatus.hasAnySetup
        };
    }

    console.log(`${gameId} state:`, gameState);

    if (gameState.installStatus === 'installed') {
        if (gameState.isRunning) {
            // Show STOP button when game is running
            buttonGroup.innerHTML = `
                <div class="left-buttons">
                    <button class="stop-button" id="${gameId}-stop-button">
                        <div class="stop-icon"></div>
                        STOP
                    </button>
                </div>
                <div class="right-buttons">
                    <button class="game-settings-btn" id="${gameId}-game-settings-btn" title="Game Settings">
                        <div class="settings-icon"></div>
                    </button>
                </div>
            `;

            // Attach event listeners
            document.getElementById(`${gameId}-stop-button`).onclick = () => stopGame(gameId);
            document.getElementById(`${gameId}-game-settings-btn`).onclick = () => showGameSettings(gameId);
        } else {
            // Show PLAY, VERIFY, and SETTINGS buttons
            // For HMW, also show UNLOCK ALL button
            const unlockAllButton = gameId === 'hmw-mod' ? `
                <button class="unlock-all-button" id="${gameId}-unlock-all-button">
                    UNLOCK ALL
                </button>
            ` : '';

            buttonGroup.innerHTML = `
                <div class="left-buttons">
                    <button class="play-button" id="${gameId}-play-button">
                        <div class="play-icon"></div>
                        PLAY
                    </button>
                    <button class="verify-button" id="${gameId}-verify-button">
                        VERIFY
                    </button>
                    <button class="manage-install-button" id="${gameId}-manage-install-button">
                        MANAGE INSTALL
                    </button>${unlockAllButton}
                </div>
                <div class="right-buttons">
                    <button class="game-settings-btn" id="${gameId}-game-settings-btn" title="Game Settings">
                        <div class="settings-icon"></div>
                    </button>
                </div>
            `;

            // Attach event listeners
            document.getElementById(`${gameId}-play-button`).onclick = () => launchGame(gameId);
            document.getElementById(`${gameId}-verify-button`).onclick = () => verifyGame(gameId);
            document.getElementById(`${gameId}-manage-install-button`).onclick = () => showManageInstall(gameId);
            document.getElementById(`${gameId}-game-settings-btn`).onclick = () => showGameSettings(gameId);

            // Attach unlock all listener for HMW
            if (gameId === 'hmw-mod') {
                document.getElementById(`${gameId}-unlock-all-button`).onclick = () => unlockAllGame(gameId);
            }
        }
    } else {
        // Show SETUP or FINISH SETUP button
        const buttonText = gameState.installStatus === 'partial' ? 'FINISH SETUP' : 'SETUP';

        buttonGroup.innerHTML = `
            <div class="left-buttons">
                <button class="setup-button" id="${gameId}-setup-button">
                    ${buttonText}
                </button>
            </div>
        `;

        // Attach event listener
        document.getElementById(`${gameId}-setup-button`).onclick = () => showSetupFlow(gameId);
    }

    // Handle progress manager state
    if (window.ProgressManager && window.ProgressManager.isActive) {
        const buttons = buttonGroup.querySelectorAll('button:not(.game-settings-btn)');
        buttons.forEach(btn => btn.disabled = true);
    }
}

function launchGame(gameId) {
    console.log(`Play button clicked for ${gameId}`);

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameConfig = GameUtils.getGameConfig(gameMapping);

    if (!gameConfig) {
        console.error(`No configuration found for game: ${gameId}`);
        return;
    }

    // Check if game has multiple modes
    if (gameConfig.hasMultipleModes) {
        // Show mode selection popup for games with multiple modes
        if (!gamePopups[gameId].gameModePopup) {
            gamePopups[gameId].gameModePopup = new GameModePopup();
        }
        gamePopups[gameId].gameModePopup.show(gameMapping, gameConfig);
    } else {
        // Launch directly for single-mode games
        GameUtils.launchGameWithMode(gameMapping, gameId, null).catch(error => {
            console.error(`Failed to launch ${gameId}:`, error);
        });
    }
}

function showGameSettings(gameId) {
    console.log(`Game settings button clicked for ${gameId}`);

    if (!gamePopups[gameId].gameSettingsPopup) {
        gamePopups[gameId].gameSettingsPopup = new GameSettingsPopup();
    }

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameConfig = GameUtils.getGameConfig(gameMapping);
    gamePopups[gameId].gameSettingsPopup.show(gameMapping, gameConfig);
}

function showManageInstall(gameId) {
    console.log(`Manage install button clicked for ${gameId}`);

    if (!gamePopups[gameId].componentSelectionPopup) {
        gamePopups[gameId].componentSelectionPopup = new ComponentSelectionPopup();
    }

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameConfig = GameUtils.getGameConfig(gameMapping);
    gamePopups[gameId].componentSelectionPopup.show(gameMapping, gameConfig);
}

function verifyGame(gameId) {
    console.log(`Verify button clicked for ${gameId}`);

    const gameMapping = GameUtils.getGameMapping(gameId);

    GameUtils.trackCommandProgress({
        gameId: gameId,
        command: 'verify-game',
        commandArgs: { game: gameMapping },
        initialMessage: `Verifying ${window.GameInstallationManager.getGameDisplayName(gameId)}...`,
        completeMessage: 'Verification complete!',
        onComplete: () => {
            // Trigger UI update in case verification installed missing files
            window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                detail: { game: gameMapping }
            }));
        }
    }).catch(error => {
        console.error('Failed to start verification:', error);
    });
}

async function unlockAllGame(gameId) {
    console.log(`Unlock All button clicked for ${gameId}`);

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameDisplayName = window.GameInstallationManager.getGameDisplayName(gameId);

    // Show confirmation dialog
    if (typeof window.showMessageBox === 'function') {
        const result = await window.showMessageBox(
            "Unlock All",
            "Unlocking all will reset all of your current classes.\nAre you sure you want to continue?",
            ["No", "Yes"]
        );

        // If user clicked "No" (index 0) or closed the dialog, return
        if (result !== 1) {
            console.log('Unlock All cancelled by user');
            return;
        }
    }

    // Show progress and start unlock all
    GameUtils.trackCommandProgress({
        gameId: gameId,
        command: 'unlock-all',
        commandArgs: { game: gameMapping },
        initialMessage: `Unlocking all for ${gameDisplayName}...`,
        completeMessage: 'Unlock all complete!'
    }).catch(error => {
        console.error('Failed to start unlock all:', error);
        // Show error message
        if (typeof window.showMessageBox === 'function') {
            window.showMessageBox("Unlock All Failed",
                `Failed to unlock all for ${gameDisplayName}. Please try again.`, ["OK"]);
        }
    });
}

function stopGame(gameId) {
    console.log(`Stop button clicked for ${gameId}`);

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameDisplayName = window.GameInstallationManager.getGameDisplayName(gameId);

    // Send command to stop the game
    if (typeof window.executeCommand === 'function') {
        window.executeCommand('stop-game', { game: gameMapping }).then(() => {
            console.log(`${gameId} stopped successfully`);
            // State will be updated automatically by polling
        }).catch(error => {
            console.error(`Failed to stop ${gameId}:`, error);
            if (typeof window.showMessageBox === 'function') {
                window.showMessageBox("Error Stopping Game",
                    `Failed to stop ${gameDisplayName}. The game may have already closed.`, ["OK"]);
            }
        });
    }
}

function showSetupFlow(gameId) {
    console.log(`Setup button clicked for ${gameId}`);

    if (!gamePopups[gameId].setupFlowPopup) {
        gamePopups[gameId].setupFlowPopup = new SetupFlowPopup();
    }

    const gameDisplayName = window.GameInstallationManager.getGameDisplayName(gameId);
    const gameMapping = window.GameInstallationManager.getGameMapping(gameId);
    gamePopups[gameId].setupFlowPopup.show(gameMapping, gameDisplayName);
}


// Settings page functionality
let settingsPopup;



async function checkGameInstallation(gameId) {
    const gameMapping = GameUtils.getGameMapping(gameId);
    const config = GameUtils.getGameConfigByUIId(gameId);
    if (!config) return { hasAnySetup: false, status: 'not-setup' };

    try {
        if (typeof window.executeCommand === 'function') {
            const isInstalled = await window.executeCommand('get-game-property', {
                game: gameMapping,
                suffix: 'is-installed'
            });
            const installPath = await window.executeCommand('get-game-property', {
                game: gameMapping,
                suffix: 'install'
            });

            const fullyInstalled = isInstalled && isInstalled.trim() === 'true';
            const hasPath = installPath && installPath.trim() !== '';

            if (fullyInstalled && hasPath) {
                return { hasAnySetup: true, status: 'installed' };
            } else if (hasPath) {
                return { hasAnySetup: true, status: 'partial' };
            } else {
                return { hasAnySetup: false, status: 'not-setup' };
            }
        } else {
            console.log(`Mock: Checking installation for ${gameId}`);
            return { hasAnySetup: Math.random() > 0.5, status: 'installed' };
        }
    } catch (error) {
        console.error(`Error checking installation for ${gameId}:`, error);
        return { hasAnySetup: false, status: 'not-setup' };
    }
}

async function loadLauncherSettings() {
    if (typeof window.executeCommand !== 'function') {
        console.log('Mock: Skipping launcher settings load');
        return;
    }

    try {
        // Load "Restore Last Page" setting
        const restoreLastPage = await window.executeCommand('get-property', 'launcher-restore-last-page');
        const restoreToggle = document.getElementById('restore-last-page-toggle');

        if (restoreToggle) {
            const buttons = restoreToggle.querySelectorAll('.toggle-btn');
            buttons.forEach(btn => btn.classList.remove('active'));

            // Default to "true" if not set
            const targetValue = (restoreLastPage === null || restoreLastPage === 'true') ? 'true' : 'false';
            const targetButton = restoreToggle.querySelector(`[data-value="${targetValue}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
            }
        }

        // Load "Skip Hash Verification" setting
        const skipHashVerification = await window.executeCommand('get-property', 'launcher-skip-hash-verification');
        const skipHashToggle = document.getElementById('skip-hash-verification-toggle');

        if (skipHashToggle) {
            const buttons = skipHashToggle.querySelectorAll('.toggle-btn');
            buttons.forEach(btn => btn.classList.remove('active'));

            // Default to "false" if not set
            const targetValue = (skipHashVerification === 'true') ? 'true' : 'false';
            const targetButton = skipHashToggle.querySelector(`[data-value="${targetValue}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
            }
        }

        // Load "Close on Launch" setting
        const closeOnLaunch = await window.executeCommand('get-property', 'launcher-close-on-launch');
        const closeOnLaunchToggle = document.getElementById('close-on-launch-toggle');

        if (closeOnLaunchToggle) {
            const buttons = closeOnLaunchToggle.querySelectorAll('.toggle-btn');
            buttons.forEach(btn => btn.classList.remove('active'));

            // Default to "false" if not set
            const targetValue = (closeOnLaunch === 'true') ? 'true' : 'false';
            const targetButton = closeOnLaunchToggle.querySelector(`[data-value="${targetValue}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
            }
        }

        // Load CDN settings
        await initCdnSettings();

        console.log('Launcher settings loaded');
    } catch (error) {
        console.error('Failed to load launcher settings:', error);
    }
}

// CDN Settings Management
async function initCdnSettings() {
    const cdnSelect = document.getElementById('cdn-server-select');
    const cdnTestBtn = document.getElementById('cdn-test-btn');

    if (!cdnSelect || !cdnTestBtn) {
        console.log('CDN settings elements not found');
        return;
    }

    try {
        // Get current CDN servers and preference from backend
        const cdnData = await window.executeCommand('get-cdn-servers');

        if (cdnData) {
            // Set the dropdown to current preference
            cdnSelect.value = cdnData.preference || 'auto';

            // Update dropdown labels with latency info if available
            updateCdnDropdownLabels(cdnData);

            console.log('CDN settings loaded:', cdnData);
        }
    } catch (error) {
        console.error('Failed to load CDN settings:', error);
    }

    // Add event listener for dropdown change
    cdnSelect.addEventListener('change', async (e) => {
        const region = e.target.value;
        try {
            await window.executeCommand('set-cdn-preference', { region: region });
            console.log(`CDN preference set to: ${region}`);
        } catch (error) {
            console.error('Failed to set CDN preference:', error);
        }
    });

    // Add event listener for test button
    cdnTestBtn.addEventListener('click', handleCdnTest);
}

function updateCdnDropdownLabels(cdnData) {
    const cdnSelect = document.getElementById('cdn-server-select');
    if (!cdnSelect || !cdnData) return;

    // Get latency values from servers array
    let naLatency = null;
    let euLatency = null;

    if (cdnData.servers) {
        for (const server of cdnData.servers) {
            if (server.region === 'na' && server.latency !== null) {
                naLatency = Math.round(server.latency);
            } else if (server.region === 'eu' && server.latency !== null) {
                euLatency = Math.round(server.latency);
            }
        }
    }

    // Update option labels
    const options = cdnSelect.options;
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const baseText = getBaseOptionText(option.value);

        if (option.value === 'auto' && cdnData.recommended) {
            // Show which server was selected for auto mode
            const recommendedName = cdnData.recommended === 'eu' ? 'EU' : 'NA';
            option.textContent = `${baseText} (${recommendedName})`;
        } else if (option.value === 'na' && naLatency !== null) {
            option.textContent = `${baseText} (${naLatency}ms)`;
        } else if (option.value === 'eu' && euLatency !== null) {
            option.textContent = `${baseText} (${euLatency}ms)`;
        } else {
            option.textContent = baseText;
        }
    }
}

function getBaseOptionText(value) {
    switch (value) {
        case 'auto': return 'Auto';
        case 'na': return 'North America';
        case 'eu': return 'Europe';
        default: return value;
    }
}

async function handleCdnTest() {
    const cdnTestBtn = document.getElementById('cdn-test-btn');
    const cdnSelect = document.getElementById('cdn-server-select');

    if (!cdnTestBtn || !cdnSelect) return;

    // Disable button and show spinning animation
    cdnTestBtn.disabled = true;
    cdnTestBtn.classList.add('testing');

    try {
        // Run latency test
        const result = await window.executeCommand('test-cdn-latency');

        if (result && result.success) {
            // Update dropdown labels with new latency values
            updateCdnDropdownLabels(result);
            console.log('CDN latency test complete:', result);
        } else {
            console.error('CDN latency test failed');
        }
    } catch (error) {
        console.error('Failed to test CDN latency:', error);
    } finally {
        // Re-enable button and stop spinning
        cdnTestBtn.disabled = false;
        cdnTestBtn.classList.remove('testing');
    }
}

function setupLauncherSettingsToggles() {
    const settingsPage = document.getElementById('settings-page');
    if (!settingsPage) return;

    // Event delegation for all toggle buttons in settings page
    settingsPage.addEventListener('click', async (e) => {
        if (e.target.classList.contains('toggle-btn')) {
            const toggleGroup = e.target.parentElement;
            const buttons = toggleGroup.querySelectorAll('.toggle-btn');
            const clickedValue = e.target.dataset.value;

            // Update UI immediately
            buttons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            // Determine which setting was changed
            const settingId = toggleGroup.id;

            if (typeof window.executeCommand === 'function') {
                try {
                    if (settingId === 'restore-last-page-toggle') {
                        await window.executeCommand('set-property', {
                            'launcher-restore-last-page': clickedValue
                        });
                        console.log(`Restore last page set to: ${clickedValue}`);
                    } else if (settingId === 'skip-hash-verification-toggle') {
                        await window.executeCommand('set-property', {
                            'launcher-skip-hash-verification': clickedValue
                        });
                        console.log(`Skip hash verification set to: ${clickedValue}`);
                    } else if (settingId === 'close-on-launch-toggle') {
                        await window.executeCommand('set-property', {
                            'launcher-close-on-launch': clickedValue
                        });
                        console.log(`Close on launch set to: ${clickedValue}`);
                    }
                } catch (error) {
                    console.error('Failed to save launcher setting:', error);
                    // Revert UI on error
                    buttons.forEach(btn => btn.classList.remove('active'));
                    const revertButton = toggleGroup.querySelector(`[data-value="${clickedValue === 'true' ? 'false' : 'true'}"]`);
                    if (revertButton) {
                        revertButton.classList.add('active');
                    }
                }
            }
        }
    });

    console.log('Launcher settings toggle listeners setup');
}

async function handleResetAllSettings() {
    // Show confirmation dialog
    const result = await window.showMessageBox(
        "Reset All Settings",
        "Are you sure you want to reset all launcher and game settings to defaults? This will clear all settings including game installation paths.",
        ["Cancel", "Reset"]
    );

    if (result === 1) {
        if (typeof executeCommand === 'function') {
            try {
                // Reset launcher settings
                await executeCommand('set-property', {
                    'launcher-restore-last-page': 'true',
                    'launcher-skip-hash-verification': 'false',
                    'launcher-close-on-launch': 'false'
                });

                // Reset CDN preference to auto
                await executeCommand('set-cdn-preference', { region: 'auto' });

                // Reset all game settings using reset-game-settings command
                await executeCommand('reset-game-settings', { game: 'all' });

                // Dispatch event for game installation updates
                window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                    detail: { game: 'all' }
                }));

                await window.showMessageBox("Settings Reset", "All settings have been reset to defaults!", ["OK"]);

                // Reload settings page to show defaults
                await initializeSettingsPage();
            } catch (error) {
                console.error('Failed to reset settings:', error);
                await window.showMessageBox("Reset Failed", "Failed to reset settings. Please try again.", ["OK"]);
            }
        }
    }
}

async function handleToggleConsole() {
    const consoleBtn = document.getElementById('show-console-btn');
    if (!consoleBtn) return;

    consoleVisible = !consoleVisible;

    try {
        await executeCommand('set-console-visible', { visible: consoleVisible });
        consoleBtn.textContent = consoleVisible ? 'Hide Console' : 'Show Console';
    } catch (error) {
        console.error('Failed to toggle console:', error);
        consoleVisible = !consoleVisible; // Revert on failure
    }
}

async function handleCheckForUpdates() {
    const updateBtn = document.getElementById('check-updates-btn');
    if (!updateBtn) return;

    // Disable button during update check
    updateBtn.disabled = true;
    const originalText = updateBtn.textContent;
    updateBtn.textContent = 'Checking...';

    // Force the browser to paint the UI changes before the blocking operation
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        if (typeof executeCommand === 'function') {
            const result = await executeCommand('check-launcher-update');

            if (result && result.updateComplete) {
                await window.showMessageBox(
                    "Launcher Update",
                    "The launcher is at the latest version!",
                    ["OK"]
                );
            }
            else {
                await window.showMessageBox(
                    "Launcher Update",
                    "Update was cancelled or error occurred",
                    ["OK"]
                );
            }
        }
    } catch (error) {
        console.error('Failed to check for updates:', error);
        await window.showMessageBox(
            "Launcher Update",
            "Failed to check for updates. Please try again later.",
            ["OK"]
        );
    } finally {
        // Re-enable button
        updateBtn.disabled = false;
        updateBtn.textContent = originalText;
    }
}

async function loadVersion() {
    try {
        const response = await window.executeCommand('get-version');
        const versionElement = document.getElementById('version-footer');

        if (response && response.version) {
            // Display the full git describe version
            versionElement.textContent = `Version: ${response.version}`;

            // Add tooltip with more details
            versionElement.title = `File Version: ${response.versionFile}\nCommit: ${response.gitHash.substring(0, 8)}\nBranch: ${response.gitBranch}`;
        }
    } catch (error) {
        console.error('Failed to load version:', error);
        const versionElement = document.getElementById('version-footer');
        if (versionElement) {
            versionElement.textContent = 'Version: Unknown';
        }
    }
}

async function initializeSettingsPage() {
    console.log('=== Initializing settings page ===');
    await loadLauncherSettings();
    setupLauncherSettingsToggles();

    // Setup action button listeners
    const resetBtn = document.getElementById('reset-all-settings-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', handleResetAllSettings);
    }

    const updateBtn = document.getElementById('check-updates-btn');
    if (updateBtn) {
        updateBtn.addEventListener('click', handleCheckForUpdates);
    }

    const consoleBtn = document.getElementById('show-console-btn');
    if (consoleBtn) {
        consoleBtn.addEventListener('click', handleToggleConsole);
    }

    await loadVersion();
    console.log('Settings page initialized');
}

// Listen for installation updates globally
window.addEventListener('gameInstallationUpdated', (event) => {
    console.log('Installation updated globally');
    const targetGame = event.detail.game;

    // Refresh settings page if it's visible
    const settingsPage = document.getElementById('settings-page');
    if (settingsPage && settingsPage.style.display !== 'none') {
        initializeSettingsPage();
    }

    // Refresh game pages if needed
    const gamePages = document.querySelectorAll('.game-page');
    gamePages.forEach(page => {
        if (page.style.display !== 'none') {
            const gameId = page.id.replace('-page', '');
            if (targetGame === 'all' || targetGame === window.GameInstallationManager.getGameMapping(gameId)) {
                createGameButtons(gameId);
            }
        }
    });
});