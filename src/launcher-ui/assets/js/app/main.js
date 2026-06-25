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

// Recent games tracking — persisted to localStorage
const RECENT_GAMES_KEY = 'cb_recent_games';
let recentGames = [];

function loadRecentGames() {
    try {
        const saved = localStorage.getItem(RECENT_GAMES_KEY);
        recentGames = saved ? JSON.parse(saved) : [];
    } catch (_) {
        recentGames = [];
    }
    window.__recentGamesSnapshot = recentGames;
}

function addRecentGame(gameId) {
    recentGames = [gameId, ...recentGames.filter(id => id !== gameId)];
    window.__recentGamesSnapshot = recentGames;
    try {
        localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(recentGames));
    } catch (_) {}
    refreshSidebarMyGames();
}

function refreshSidebarMyGames() {
    if (window.AppViews && typeof window.AppViews.updateSidebarMyGames === 'function') {
        window.AppViews.updateSidebarMyGames(recentGames);
    }
}

function t(key, variables) {
    return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
}

function busyKindFor(gameId) {
    const q = window.DownloadQueueManager;
    if (!q || typeof q.isBusy !== 'function' || !q.isBusy(gameId)) return null;
    if (q.active && q.active.gameId === gameId && q.active.blocksGameButtons) return 'active';
    return 'queued';
}

function busyOpLabel(gameId) {
    const q = window.DownloadQueueManager;
    const op = (q && q.active && q.active.gameId === gameId && q.active.blocksGameButtons)
        ? (q.active.op || 'install')
        : 'install';
    if (op === 'verify') return t('common.verifying');
    if (op === 'uninstall') return t('common.uninstalling');
    return t('common.installing');
}

function setupButtonLabel(installStatus, busyKind, gameId) {
    if (busyKind === 'queued') return t('common.queued');
    if (busyKind === 'active') return busyOpLabel(gameId);
    return installStatus === 'partial' ? t('common.finishSetup') : t('common.setup');
}

async function initializeLanguage() {
    let language = 'en';

    if (typeof window.executeCommand === 'function') {
        try {
            const savedLanguage = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.LANGUAGE);
            if (savedLanguage) {
                language = savedLanguage;
            }
        } catch (error) {
            console.error('Failed to load launcher language:', error);
        }
    }

    if (window.LauncherI18n) {
        window.LauncherI18n.setLanguage(language);
    }

    return language;
}

function getActivePageId() {
    const activeGame = document.querySelector('.game-item.active');
    if (activeGame) {
        return activeGame.dataset.game || activeGame.id;
    }

    const activeNav = document.querySelector('.nav-item.active');
    return activeNav ? activeNav.id : 'home';
}

function syncConsoleButtonLabel() {
    const consoleBtn = document.getElementById('show-console-btn');
    if (consoleBtn) {
        consoleBtn.textContent = consoleVisible ? t('settings.hideConsole') : t('settings.showConsole');
    }
}

async function refreshLocalizedUI(targetPage) {
    if (window.LauncherI18n) {
        window.LauncherI18n.applyStaticTranslations();
    }

    syncConsoleButtonLabel();

    if (window.AppViews) {
        window.AppViews.renderAll();
        window.AppViews.updateSidebarMyGames(recentGames);
    }

    await loadNavigationPage(targetPage || getActivePageId());

    if (window.AppViews) {
        await window.AppViews.refreshInstallationStates(checkGameInstallation);
    }
}

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

function applyTheme(theme) {
    if (theme === 'dark' || theme === 'navy-gradient') {
        document.documentElement.setAttribute('data-theme', theme);
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
}

async function initialize() {
    // Apply saved theme before rendering to avoid flash
    if (typeof window.executeCommand === 'function') {
        try {
            const savedTheme = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.THEME);
            applyTheme(savedTheme || 'dark');
        } catch (_) {}
    }

    await initializeLanguage();

    if (window.LauncherI18n) {
        window.LauncherI18n.applyStaticTranslations();
    }

    loadRecentGames();

    if (window.AppViews) {
        window.AppViews.renderAll();
        window.AppViews.updateSidebarMyGames(recentGames);
    }

    syncConsoleButtonLabel();

    // Remove hidden class after the first localized render
    document.body.classList.remove('hidden');

    // Preload all game images first
    preloadGameImages().then(() => {
        console.log('All game images preloaded');
        // Load sidebar icons safely
        loadSidebarIcons();
    });

    initializeNavigation()
        .then(() => {
            if (window.AppViews) {
                return window.AppViews.refreshInstallationStates(checkGameInstallation);
            }
        })
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

            if (window.PlayerCountManager) {
                window.PlayerCountManager.start();
            }

            if (window.DiscordFriendsManager) {
                window.DiscordFriendsManager.start();
            }

            handleStartupLaunchArg();
        });

    document.querySelector("#minimize-button").onclick = () => {
        try {
            window.executeCommand("minimize");
        } catch (error) {
            console.log("Minimize command not available:", error);
        }
    };

    document.querySelector("#maximize-button").onclick = () => {
        try {
            window.executeCommand("toggle-maximize");
        } catch (error) {
            console.log("Toggle-maximize command not available:", error);
        }
    };

    document.querySelector("#close-button").onclick = () => {
        try {
            window.executeCommand("close");
        } catch (error) {
            console.log("Close command not available:", error);
        }
    };

    // Updates the maximize/restore button icon + tooltip. Called by the launcher (C++) whenever the
    // window's maximized state changes (button, Aero Snap, Win+Up, etc.).
    window.__setMaximized = (maximized) => {
        const button = document.querySelector("#maximize-button");
        if (!button) return;

        const icon = button.querySelector(".control-icon");
        if (icon) {
            icon.classList.toggle("maximize-icon", !maximized);
            icon.classList.toggle("restore-icon", !!maximized);
        }

        const key = maximized ? "window.restore" : "window.maximize";
        button.setAttribute("data-i18n-title", key);
        try {
            button.title = window.LauncherI18n ? window.LauncherI18n.t(key) : (maximized ? "Restore" : "Maximize");
        } catch (error) {
            button.title = maximized ? "Restore" : "Maximize";
        }
    };

    try {
        Promise.resolve(window.executeCommand("is-maximized"))
            .then((maximized) => window.__setMaximized(!!maximized))
            .catch(() => {});
    } catch (error) {
        console.log("is-maximized command not available:", error);
    }

    // Handle external links on support and game pages - open in default browser
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        // Only handle links within home-page, support-page, game pages, and settings-page
        const isInTargetPage = link.closest('#home-page') || link.closest('#support-page') || link.closest('.game-page') || link.closest('#settings-page');
        if (!isInTargetPage) return;

        // Only handle http/https links
        if (link.href && link.href.startsWith('http')) {
            e.preventDefault();
            window.executeCommand('open-url', { url: link.href });
        }
    });

    adjustChannelElements();
}

window.RedistManager = (function() {
    async function refresh() {
        const summaryEl = document.getElementById('redist-summary-text');
        if (!summaryEl) return;
        try {
            await window.executeCommand('refresh-redist');
            const state = await window.executeCommand('get-redist-progress');
            const packages = (state && state.packages) || [];
            const installed = packages.filter(p => p.status === 'installed' || p.status === 'completed').length;
            summaryEl.textContent = window.LauncherI18n
                ? window.LauncherI18n.t('support.redistSummary', { installed, total: packages.length })
                : '';
        } catch (e) {
            console.error('refresh-redist failed', e);
        }
    }

    return { refresh };
})();

window.DiscordWidget = (function() {
    const INVITE_URL = 'https://discord.com/api/v10/invites/WyJQCwCCGW?with_counts=true';
    let cachedOnline = null;
    let lastFetch = 0;
    const TTL_MS = 5 * 60 * 1000;

    function format(count) {
        if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(count);
    }

    async function refresh() {
        const el = document.getElementById('discord-online');
        if (!el) return;

        const now = Date.now();
        if (cachedOnline === null || (now - lastFetch) > TTL_MS) {
            try {
                const res = await fetch(INVITE_URL, { cache: 'no-store' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                if (typeof json.approximate_presence_count === 'number') {
                    cachedOnline = json.approximate_presence_count;
                    lastFetch = now;
                }
            } catch (e) {
                console.warn('DiscordWidget: fetch failed, keeping last known count.', e);
            }
        }

        if (cachedOnline !== null) {
            el.textContent = format(cachedOnline);
            el.hidden = false;
        }
    }

    return { refresh };
})();

async function initializeNavigation() {
    // Handle home navigation
    const homeElement = document.querySelector("#home");
    homeElement.addEventListener("click", handleHomeClick);

    // Handle library navigation
    const libraryElement = document.querySelector("#library");
    libraryElement.addEventListener("click", handleLibraryClick);

    // Handle downloads navigation
    const downloadsElement = document.querySelector("#downloads");
    if (downloadsElement) {
        downloadsElement.addEventListener("click", handleDownloadsClick);
    }

    // Handle friends navigation
    const friendsElement = document.querySelector("#friends");
    if (friendsElement) {
        friendsElement.addEventListener("click", handleFriendsClick);
    }

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

    // Always start on Home. Last game page is still saved for future use, but not restored on launch.
    removeActiveNavigation();
    homeElement.classList.add("active");
    return loadNavigationPage("home");
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

function handleLibraryClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("library");
}

function handleDownloadsClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("downloads");
}

function handleFriendsClick(e) {
    const el = this;
    if (el.classList.contains("active")) {
        return;
    }

    removeActiveNavigation();
    el.classList.add("active");
    loadNavigationPage("friends");
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

    if (window.RedistManager) window.RedistManager.refresh();
    if (window.DiscordWidget) window.DiscordWidget.refresh();
}

// setInnerHTML function removed - no longer needed with single page approach

function loadBackgroundImage(gameId) {
    const heroSection = document.querySelector(`.hero-section.${gameId}`);
    if (!heroSection || !gameId) return;

    const imagePath = GameUtils.getHeroImagePath(gameId);
    if (!imagePath) return;

    const cssBackgroundUrl = (path) => {
        let resolvedPath = path || '';
        try {
            resolvedPath = new URL(path, window.location.href).href;
        } catch (_) {}

        return `url("${String(resolvedPath).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
    };

    if (preloadedImages[imagePath]) {
        // Image is already preloaded, apply immediately
        heroSection.style.setProperty('--hero-image', cssBackgroundUrl(imagePath));
        heroSection.style.backgroundImage = '';
        console.log(`Background image loaded for ${gameId} (from cache)`);
    } else {
        // Fallback to loading on demand
        const img = new Image();
        img.onload = function() {
            heroSection.style.setProperty('--hero-image', cssBackgroundUrl(imagePath));
            heroSection.style.backgroundImage = '';
            console.log(`Background image loaded for ${gameId}`);
        };
        img.onerror = function() {
            console.log(`Background image failed to load for ${gameId}, using gradient fallback`);
            heroSection.style.removeProperty('--hero-image');
            heroSection.style.backgroundImage = 'none';
        };
        img.src = imagePath;
    }
}

function loadHomeBackgroundImage() {
    if (window.AppViews) {
        window.AppViews.renderHome();
        if (typeof window.AppViews.refreshHomeInstalledClients === 'function') {
            window.AppViews.refreshHomeInstalledClients(checkGameInstallation);
        }
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
    runningGameId: null, // Single-game tracking: the game launched from the launcher
    launchGraceUntil: 0, // Ignore "not running" right after launch while the process spins up

    markGameLaunched(gameId) {
        this.runningGameId = gameId;
        this.launchGraceUntil = Date.now() + 8000;
        const state = this.gameStates[gameId] || {};
        this.gameStates[gameId] = Object.assign({}, state, { isRunning: true });
        if (window.AppViews && typeof window.AppViews.refreshActionButtons === 'function') {
            window.AppViews.refreshActionButtons();
        }
    },

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

        let cardsNeedRefresh = false;

        // Poll the visible game page (drives its play/stop/setup button group)
        if (visibleGameId) {
            const stateChanged = await this.updateGameState(visibleGameId);
            if (stateChanged) {
                console.log(`${visibleGameId} state changed, updating buttons`);
                await createGameButtons(visibleGameId);
                cardsNeedRefresh = true;
            }
            const vs = this.gameStates[visibleGameId];
            if (vs && vs.isRunning) {
                this.runningGameId = visibleGameId;
            } else if (this.runningGameId === visibleGameId && Date.now() > this.launchGraceUntil) {
                this.runningGameId = null;
            }
        }

        // Single-game tracking: keep polling the launched game even on home/library
        // (where its detail page isn't visible) so its card can flip to STOP / back.
        if (this.runningGameId && this.runningGameId !== visibleGameId) {
            const trackedId = this.runningGameId;
            const prev = this.gameStates[trackedId] || {};
            const isRunning = await this.checkGameRunning(trackedId);
            if (isRunning || Date.now() > this.launchGraceUntil) {
                if (prev.isRunning !== isRunning) cardsNeedRefresh = true;
                this.gameStates[trackedId] = Object.assign({}, prev, { isRunning });
                if (!isRunning) this.runningGameId = null;
            }
        }

        if (cardsNeedRefresh && window.AppViews && typeof window.AppViews.refreshActionButtons === 'function') {
            window.AppViews.refreshActionButtons();
        }
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

    getGameState(gameId) {
        return this.gameStates[gameId] || null;
    }
};

// Global Progress Manager — drives the bottom bar for the currently active queue item.
window.ProgressManager = {
    isActive: false,
    currentGame: null,
    cancelCallback: null,
    lastStats: null,

    show: function(gameId, message = t('common.loading'), onCancel = null) {
        const progressBar = document.getElementById('global-progress-bar');
        const progressInfo = document.getElementById('progress-info');
        const progressGameIcon = document.getElementById('progress-game-icon');
        const progressFill = document.getElementById('global-progress-fill');
        const progressPercent = document.getElementById('global-progress-percent');
        const cancelBtn = document.getElementById('progress-cancel-btn');
        const pauseBtn = document.getElementById('progress-pause-btn');
        const windowEl = document.querySelector('.window');

        if (!progressBar) {
            console.error('Global progress bar not found');
            return;
        }

        this.isActive = true;
        this.currentGame = gameId;
        this.cancelCallback = onCancel;

        progressBar.className = 'global-progress-bar';
        if (gameId) {
            progressBar.classList.add(gameId);
        }

        progressGameIcon.className = 'progress-game-icon';
        progressGameIcon.style.backgroundImage = '';
        if (gameId) {
            progressGameIcon.classList.add(gameId);
            const imagePath = GameUtils.getIconPath(gameId);
            if (imagePath && preloadedImages[imagePath]) {
                progressGameIcon.style.backgroundImage = `url('${imagePath}')`;
            }
        }

        // Tint the fill with the game's accent color (matches the Downloads page row).
        const config = gameId ? GameUtils.getGameConfigByUIId(gameId) : null;
        if (config && config.accent) {
            progressFill.style.background = config.accent;
            progressFill.style.boxShadow = `0 0 12px ${config.accent}80`;
        } else {
            progressFill.style.background = '';
            progressFill.style.boxShadow = '';
        }

        progressInfo.textContent = message;
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';

        this.lastStats = null;
        const progressStats = document.getElementById('progress-stats');
        if (progressStats) progressStats.textContent = '';

        if (cancelBtn) {
            cancelBtn.onclick = () => this.cancel();
        }

        if (pauseBtn) {
            pauseBtn.onclick = () => {
                const queue = window.DownloadQueueManager;
                if (!queue || !queue.active) return;
                if (queue.active.paused) {
                    queue.resume(queue.active.gameId, queue.active.op);
                } else {
                    queue.pause(queue.active.gameId, queue.active.op);
                }
            };
            // Pause is only meaningful for download-class ops (verify/install/uninstall).
            const queue = window.DownloadQueueManager;
            const showPause = !!(queue && queue.active && queue.active.blocksGameButtons);
            pauseBtn.style.display = showPause ? '' : 'none';
            this._updatePauseIcon();
        }

        progressBar.style.display = 'flex';
        windowEl.classList.add('progress-active');
        refreshSidebarMyGames();
    },

    _updatePauseIcon: function() {
        const pauseBtn = document.getElementById('progress-pause-btn');
        if (!pauseBtn) return;
        const icon = pauseBtn.querySelector('.progress-pause-icon');
        if (!icon) return;
        const queue = window.DownloadQueueManager;
        const isPaused = !!(queue && queue.active && queue.active.paused);
        icon.classList.toggle('is-resume', isPaused);
        const titleKey = isPaused ? 'downloads.resume' : 'downloads.pause';
        pauseBtn.title = window.LauncherI18n ? window.LauncherI18n.t(titleKey) : titleKey;

        const progressBar = document.getElementById('global-progress-bar');
        if (progressBar) progressBar.classList.toggle('paused', isPaused);
    },

    update: function(progress, message = null, stats = null) {
        const progressInfo = document.getElementById('progress-info');
        const progressFill = document.getElementById('global-progress-fill');
        const progressPercent = document.getElementById('global-progress-percent');
        const progressStats = document.getElementById('progress-stats');

        if (message) {
            progressInfo.textContent = message;
        }

        progressFill.style.width = `${progress}%`;
        progressPercent.textContent = `${progress.toFixed(2)}%`;

        this.lastStats = stats;
        if (progressStats) {
            progressStats.textContent = this._formatStats(stats);
        }

        try {
            window.dispatchEvent(new CustomEvent('cb-progress-tick', {
                detail: {
                    progress: progress,
                    message: message,
                    speed: stats ? stats.speed : null,
                    etaSeconds: stats ? stats.etaSeconds : null
                }
            }));
        } catch (_) {}
    },

    _formatStats: function(stats) {
        if (!stats) return '';
        const speed = GameUtils.formatSpeed(stats.speed);
        const eta = GameUtils.formatDuration(stats.etaSeconds);
        const etaLabel = eta
            ? (window.LauncherI18n ? window.LauncherI18n.t('downloads.etaLeft', { time: eta }) : `${eta} left`)
            : '';
        return [speed, etaLabel].filter(Boolean).join(' • ');
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
            progressBar.className = 'global-progress-bar';
        }
        if (windowEl) {
            windowEl.classList.remove('progress-active');
        }

        this.isActive = false;
        this.currentGame = null;
        this.cancelCallback = null;
        this.lastStats = null;
        const progressStats = document.getElementById('progress-stats');
        if (progressStats) progressStats.textContent = '';
        refreshSidebarMyGames();
    },

    getProgressPercent: function() {
        const fill = document.getElementById('global-progress-fill');
        if (!fill) return 0;
        const w = parseFloat(fill.style.width || '0');
        return Number.isFinite(w) ? w : 0;
    },

    getProgressMessage: function() {
        const info = document.getElementById('progress-info');
        return info ? info.textContent : '';
    }
};

// Download Queue Manager — serializes ops that share the global progress bar.
// Items with blocksGameButtons=true (verify/install/uninstall) appear in the
// Downloads tab and disable the corresponding game's Play/Setup/Verify/Manage Install.
window.DownloadQueueManager = {
    active: null,
    queue: [],

    enqueue: function(item) {
        // Dedup blocking ops (verify/install/uninstall) and launches so spam-clicking Play
        // can't queue a second launch behind the one already verifying/running.
        if (item.blocksGameButtons || item.op === 'launch') {
            const isDup = (this.active && this.active.gameId === item.gameId && this.active.op === item.op)
                || this.queue.some(q => q.gameId === item.gameId && q.op === item.op);
            if (isDup) {
                console.log(`DownloadQueueManager: ignoring duplicate ${item.op} for ${item.gameId}`);
                return Promise.resolve();
            }
        }

        return new Promise((resolve, reject) => {
            item.resolve = resolve;
            item.reject = reject;
            item.onCancel = null;
            this.queue.push(item);

            if (item.blocksGameButtons && typeof window.showToast === 'function') {
                const cfg = window.GameUtils && typeof window.GameUtils.getGameConfigByUIId === 'function'
                    ? window.GameUtils.getGameConfigByUIId(item.gameId)
                    : null;
                const gameName = (cfg && (cfg.shortName || cfg.displayName)) || item.gameId;
                const i18n = window.LauncherI18n;
                let key;
                if (item.op === 'verify') key = 'toasts.queuedVerify';
                else if (item.op === 'install') key = 'toasts.queuedInstall';
                else if (item.op === 'uninstall') key = 'toasts.queuedUninstall';
                else key = 'toasts.queued';
                const msg = i18n ? i18n.t(key, { game: gameName }) : `${gameName} added to queue`;
                window.showToast(msg, 'info');
            }

            this._emit();
            this._processNext();
        });
    },

    _processNext: function() {
        if (this.active) return;
        const idx = this.queue.findIndex(q => !q.paused);
        if (idx < 0) return;
        const item = this.queue.splice(idx, 1)[0];
        this.active = item;
        this._emit();

        const registerCancel = (fn) => {
            item.onCancel = fn;
        };

        let runResult;
        try {
            runResult = item.runFn(registerCancel);
        } catch (error) {
            this._finalize(item, error, true);
            return;
        }

        Promise.resolve(runResult)
            .then(result => this._finalize(item, result, false))
            .catch(error => this._finalize(item, error, true));
    },

    _finalize: function(item, valueOrError, isError) {
        if (this.active === item) {
            this.active = null;
        }
        if (isError) {
            try { item.reject(valueOrError); } catch (_) {}
        } else {
            try { item.resolve(valueOrError); } catch (_) {}
        }
        this._emit();
        this._processNext();
    },

    cancel: function(gameId, op) {
        const idx = this.queue.findIndex(q => q.gameId === gameId && q.op === op);
        if (idx >= 0) {
            const removed = this.queue.splice(idx, 1)[0];
            try { removed.resolve(); } catch (_) {}

            if (typeof window.showToast === 'function') {
                const cfg = window.GameUtils && typeof window.GameUtils.getGameConfigByUIId === 'function'
                    ? window.GameUtils.getGameConfigByUIId(removed.gameId)
                    : null;
                const gameName = (cfg && (cfg.shortName || cfg.displayName)) || removed.gameId;
                const i18n = window.LauncherI18n;
                let key;
                if (removed.op === 'verify') key = 'toasts.cancelledVerify';
                else if (removed.op === 'install') key = 'toasts.cancelledInstall';
                else if (removed.op === 'uninstall') key = 'toasts.cancelledUninstall';
                else key = 'toasts.cancelled';
                const msg = i18n ? i18n.t(key, { game: gameName }) : `${gameName} cancelled`;
                window.showToast(msg, 'info');
            }

            this._emit();
            return;
        }
        if (this.active && this.active.gameId === gameId && this.active.op === op) {
            // If the active was paused, the backend's update is sleeping on the cv.
            // cancel-update notifies the cv so the worker wakes and observes cancellation.
            this.active.paused = false;
            if (typeof this.active.onCancel === 'function') {
                this.active.onCancel();
            }
        }
    },

    // Pause: queued items just flip a flag and stay queued. The active item gets a
    // backend pause-update — the worker thread blocks at the next file boundary.
    // The runFn keeps polling progress (which now reports paused=true, frozen percent).
    pause: function(gameId, op) {
        const queueItem = this.queue.find(q => q.gameId === gameId && q.op === op);
        if (queueItem) {
            queueItem.paused = true;
            this._emit();
            return;
        }
        if (this.active && this.active.gameId === gameId && this.active.op === op) {
            this.active.paused = true;
            this._emit();
            try {
                window.executeCommand('pause-update').catch(error => {
                    console.error('pause-update failed:', error);
                });
            } catch (error) {
                console.error('pause-update threw:', error);
            }
        }
    },

    resume: function(gameId, op) {
        // Active paused item: tell the backend to resume; the worker thread wakes from the cv.
        if (this.active && this.active.gameId === gameId && this.active.op === op && this.active.paused) {
            this.active.paused = false;
            this._emit();
            try {
                window.executeCommand('resume-update').catch(error => {
                    console.error('resume-update failed:', error);
                });
            } catch (error) {
                console.error('resume-update threw:', error);
            }
            return;
        }
        // Queued paused item: clear flag; _processNext picks it up if it's first non-paused.
        const queueItem = this.queue.find(q => q.gameId === gameId && q.op === op);
        if (queueItem && queueItem.paused) {
            queueItem.paused = false;
            this._emit();
            this._processNext();
        }
    },

    isBusy: function(gameId) {
        if (this.active && this.active.gameId === gameId && this.active.blocksGameButtons) return true;
        return this.queue.some(q => q.gameId === gameId && q.blocksGameButtons);
    },

    // True if any verify/install/uninstall is active or queued. Used to disable
    // Play across all games (the backend progress_tracker is singleton).
    isAnyBlockingActive: function() {
        if (this.active && this.active.blocksGameButtons) return true;
        return this.queue.some(q => q.blocksGameButtons);
    },

    getDownloadEntries: function() {
        const items = [];
        if (this.active && this.active.blocksGameButtons) {
            items.push(Object.assign({}, this.active, { isActive: true, queuePosition: 0 }));
        }
        let pos = 1;
        for (const q of this.queue) {
            if (q.blocksGameButtons) {
                items.push(Object.assign({}, q, { isActive: false, queuePosition: pos++ }));
            }
        }
        return items;
    },

    _emit: function() {
        try {
            window.dispatchEvent(new CustomEvent('cb-download-queue-changed'));
        } catch (_) {}
    }
};

// Detail-page button enable/disable; mirrors the context-menu logic.
function applyDownloadQueueButtonState() {
    const queue = window.DownloadQueueManager;
    if (!queue) return;

    function getStatus(gameId) {
        const state = window.GameStateManager && typeof window.GameStateManager.getGameState === 'function'
            ? window.GameStateManager.getGameState(gameId) : null;
        if (state && state.installStatus) return state.installStatus;
        const card = document.querySelector(`.library-card[data-game="${gameId}"]`);
        return card ? (card.dataset.status || 'not-setup') : 'not-setup';
    }

    // Browse — installed/partial; not gated by busy.
    document.querySelectorAll('.detail-browse-files-action').forEach(btn => {
        const gameId = btn.dataset.game;
        if (!gameId) return;
        const status = getStatus(gameId);
        btn.disabled = status !== 'installed' && status !== 'partial';
    });

    // Verify — installed only.
    document.querySelectorAll('.detail-verify-action').forEach(btn => {
        const gameId = btn.dataset.game;
        if (!gameId) return;
        const status = getStatus(gameId);
        btn.disabled = queue.isBusy(gameId) || status !== 'installed';
    });

    // Settings / Manage Install — installed or partial.
    document.querySelectorAll('.detail-manage-install-action, .detail-settings-action').forEach(btn => {
        const gameId = btn.dataset.game;
        if (!gameId) return;
        const status = getStatus(gameId);
        btn.disabled = queue.isBusy(gameId) || (status !== 'installed' && status !== 'partial');
    });

    // Play: disabled across all games while any blocking op is running, since
    // launching a game while files are being verified/written is unsafe.
    const anyBlocking = queue.isAnyBlockingActive();
    document.querySelectorAll('.button-group .play-button').forEach(btn => {
        const group = btn.closest('.button-group');
        if (!group) return;
        const gameId = (group.id || '').replace(/-button-group$/, '');
        if (!gameId) return;
        const busy = queue.isBusy(gameId) || anyBlocking;
        btn.disabled = busy;
        if (anyBlocking && !queue.isBusy(gameId)) {
            btn.title = 'Cannot launch while another game is updating';
        } else {
            btn.removeAttribute('title');
        }
    });

    // Setup: only disabled when THIS game is already queued/active. Setup just opens
    // a modal; if the user picks Download the install enqueues normally, which is
    // the whole point of the queue.
    document.querySelectorAll('.button-group .setup-button').forEach(btn => {
        const group = btn.closest('.button-group');
        if (!group) return;
        const gameId = (group.id || '').replace(/-button-group$/, '');
        if (!gameId) return;
        btn.disabled = queue.isBusy(gameId);
        btn.removeAttribute('title');
        const installStatus = btn.dataset.installStatus || 'not-setup';
        btn.textContent = setupButtonLabel(installStatus, busyKindFor(gameId), gameId);
    });

    const downloadsBadge = document.getElementById('downloads-badge');
    if (downloadsBadge) {
        const entries = queue.getDownloadEntries();
        if (entries.length > 0) {
            downloadsBadge.textContent = String(entries.length);
            downloadsBadge.style.display = '';
        } else {
            downloadsBadge.style.display = 'none';
        }
    }
}

window.addEventListener('cb-download-queue-changed', () => {
    applyDownloadQueueButtonState();
    if (window.AppViews && typeof window.AppViews.applyDownloadQueueInstallingState === 'function') {
        window.AppViews.applyDownloadQueueInstallingState();
    }
    if (window.ProgressManager && typeof window.ProgressManager._updatePauseIcon === 'function') {
        window.ProgressManager._updatePauseIcon();
    }
    const pauseBtn = document.getElementById('progress-pause-btn');
    if (pauseBtn) {
        const queue = window.DownloadQueueManager;
        const showPause = !!(queue && queue.active && queue.active.blocksGameButtons);
        pauseBtn.style.display = showPause ? '' : 'none';
    }
    const downloadsPage = document.getElementById('downloads-page');
    if (downloadsPage && downloadsPage.style.display !== 'none' && window.AppViews && typeof window.AppViews.renderDownloads === 'function') {
        window.AppViews.renderDownloads();
    }
});

// Cheap in-place progress update for the Downloads tab while it's visible.
window.addEventListener('cb-progress-tick', (event) => {
    const downloadsPage = document.getElementById('downloads-page');
    if (!downloadsPage || downloadsPage.style.display === 'none') return;

    const activeRow = downloadsPage.querySelector('.download-row.active');
    if (!activeRow) return;

    const detail = event.detail || {};
    const fill = activeRow.querySelector('.download-progress-fill');
    const percentEl = activeRow.querySelector('.download-progress-percent');
    const messageEl = activeRow.querySelector('.download-progress-message');
    const statsEl = activeRow.querySelector('.download-progress-stats');
    const percent = Math.max(0, Math.min(100, Number(detail.progress) || 0));

    if (fill) fill.style.width = `${percent}%`;
    if (percentEl) percentEl.textContent = `${percent.toFixed(2)}%`;
    if (messageEl && detail.message) messageEl.textContent = detail.message;
    if (statsEl) {
        statsEl.textContent = window.ProgressManager ? window.ProgressManager._formatStats(detail) : '';
    }
});

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

    // Initialize page-specific functionality
    if (page === 'settings') {
        initializeSettingsPage();
    } else if (page === 'library') {
        if (window.AppViews) {
            window.AppViews.renderLibrary();
            window.AppViews.refreshInstallationStates(checkGameInstallation);
        }
    } else if (page === 'home') {
        if (window.AppViews) {
            window.AppViews.renderHome();
        }
    } else if (page === 'downloads') {
        if (window.AppViews && typeof window.AppViews.renderDownloads === 'function') {
            window.AppViews.renderDownloads();
        }
    } else if (page === 'friends') {
        if (window.AppViews && typeof window.AppViews.refreshFriends === 'function') {
            window.AppViews.renderFriends();
            window.AppViews.refreshFriends();
        }
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

    // Reapply per-game button disable based on queue state.
    setTimeout(applyDownloadQueueButtonState, 0);

    return Promise.resolve();
}

// Game page initialization
let gamePopups = {};

function ensureGamePopups(gameId) {
    if (!gamePopups[gameId]) {
        gamePopups[gameId] = {
            gameModePopup: null,
            gameSettingsPopup: null,
            setupFlowPopup: null,
            componentSelectionPopup: null
        };
    }

    return gamePopups[gameId];
}

function initializeGamePage(gameId) {
    console.log(`Initializing game page: ${gameId}`);

    ensureGamePopups(gameId);

    // Create buttons for the game
    createGameButtons(gameId);
}

async function createGameButtons(gameId) {
    const buttonGroup = document.getElementById(`${gameId}-button-group`);
    if (!buttonGroup) return;
    buttonGroup.classList.add('button-group-compact');

    if (GameUtils.isComingSoon(gameId)) {
        buttonGroup.innerHTML = `
            <div class="left-buttons">
                <button class="coming-soon-button" disabled>${t('common.comingSoon')}</button>
            </div>
        `;
        return;
    }

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

    if (window.AppViews) {
        window.AppViews.updateLibraryCard(gameId, gameState.installStatus);
    }

    if (gameState.installStatus === 'installed') {
        if (gameState.isRunning) {
            buttonGroup.innerHTML = `
                <div class="left-buttons">
                    <button class="stop-button" id="${gameId}-stop-button">
                        <div class="stop-icon"></div>
                        ${t('common.stop')}
                    </button>
                </div>
            `;

            document.getElementById(`${gameId}-stop-button`).onclick = () => stopGame(gameId);
        } else {
            buttonGroup.innerHTML = `
                <div class="left-buttons">
                    <button class="play-button" id="${gameId}-play-button">
                        <div class="play-icon"></div>
                        ${t('common.play')}
                    </button>
                </div>
            `;

            document.getElementById(`${gameId}-play-button`).onclick = () => launchGame(gameId);
        }
    } else {
        const buttonText = setupButtonLabel(gameState.installStatus, busyKindFor(gameId), gameId);

        buttonGroup.innerHTML = `
            <div class="left-buttons">
                <button class="setup-button" id="${gameId}-setup-button" data-install-status="${gameState.installStatus}">
                    ${buttonText}
                </button>
            </div>
        `;

        document.getElementById(`${gameId}-setup-button`).onclick = () => showSetupFlow(gameId);
    }

    applyDownloadQueueButtonState();
}

async function handleStartupLaunchArg() {
    let args;
    try {
        args = await window.executeCommand('get-startup-launch');
    } catch (_) {
        return;
    }

    if (!args || !args.game) return;

    const requested = String(args.game).toLowerCase().trim();
    const mode = args.mode ? String(args.mode).toLowerCase().trim() : null;

    let uiId = null;
    if (Object.prototype.hasOwnProperty.call(GameUtils.UI_TO_BACKEND_MAP, requested)) {
        uiId = requested;
    } else if (Object.prototype.hasOwnProperty.call(GameUtils.BACKEND_TO_UI_MAP, requested)) {
        uiId = GameUtils.BACKEND_TO_UI_MAP[requested];
    } else if (GameUtils.LAUNCH_ARG_ALIASES && Object.prototype.hasOwnProperty.call(GameUtils.LAUNCH_ARG_ALIASES, requested)) {
        uiId = GameUtils.LAUNCH_ARG_ALIASES[requested];
    } else {
        console.warn(`-launch: unknown game id "${args.game}"`);
        return;
    }

    const sidebarItem = document.querySelector(`.game-item[data-game="${uiId}"]`);
    if (sidebarItem) {
        removeActiveNavigation();
        sidebarItem.classList.add('active', `${uiId}-active`);
    }

    try {
        await loadNavigationPage(uiId);
    } catch (e) {
        console.error(`-launch: failed to navigate to ${uiId}:`, e);
        return;
    }

    const backendId = GameUtils.getGameMapping(uiId);
    const gameConfig = GameUtils.getGameConfig(backendId);
    if (!gameConfig) {
        console.warn(`-launch: no config for ${uiId}`);
        return;
    }

    if (mode) {
        try {
            await GameUtils.launchGameWithMode(backendId, uiId, mode);
        } catch (e) {
            console.error(`-launch: launchGameWithMode failed:`, e);
        }
        return;
    }

    try {
        launchGame(uiId);
    } catch (e) {
        console.error(`-launch: launchGame failed:`, e);
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

    addRecentGame(gameId);

    // Check if game has multiple modes
    if (gameConfig.hasMultipleModes) {
        const popups = ensureGamePopups(gameId);

        // Show mode selection popup for games with multiple modes
        if (!popups.gameModePopup) {
            popups.gameModePopup = new GameModePopup();
        }
        popups.gameModePopup.show(gameMapping, gameConfig);
    } else {
        // Launch directly for single-mode games
        GameUtils.launchGameWithMode(gameMapping, gameId, null).catch(error => {
            console.error(`Failed to launch ${gameId}:`, error);
        });
    }
}

function showGameSettings(gameId) {
    console.log(`Game settings button clicked for ${gameId}`);

    const popups = ensureGamePopups(gameId);

    if (!popups.gameSettingsPopup) {
        popups.gameSettingsPopup = new GameSettingsPopup();
    }

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameConfig = GameUtils.getGameConfig(gameMapping);
    popups.gameSettingsPopup.show(gameMapping, gameConfig);
}

function showManageInstall(gameId, options = {}) {
    console.log(`Manage install button clicked for ${gameId}`);

    const popups = ensureGamePopups(gameId);

    if (!popups.componentSelectionPopup) {
        popups.componentSelectionPopup = new ComponentSelectionPopup();
    }

    const gameMapping = GameUtils.getGameMapping(gameId);
    const gameConfig = GameUtils.getGameConfig(gameMapping);
    popups.componentSelectionPopup.show(gameMapping, gameConfig, options);
}

async function uninstallGameDirect(gameId) {
    const config = GameUtils.getGameConfigByUIId(gameId);
    if (!config) return false;
    const backendId = GameUtils.getGameMapping(gameId);

    if (typeof window.showMessageBox === 'function') {
        const result = await window.showMessageBox(
            t('popup.componentSelection.confirmUninstallTitle'),
            t('popup.componentSelection.confirmUninstallBody', { game: config.displayName }),
            [t('common.cancel'), { label: t('popup.componentSelection.uninstall'), danger: true }]
        );
        if (result === 0) return false;
    }

    try {
        await GameUtils.trackCommandProgress({
            gameId: gameId,
            command: 'delete-game',
            commandArgs: { game: backendId },
            initialMessage: t('popup.componentSelection.uninstalling', { game: config.displayName }),
            completeMessage: t('progress.uninstallComplete'),
            onComplete: () => {
                window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                    detail: { game: backendId }
                }));
            }
        });
    } catch (error) {
        console.error('Failed to uninstall game:', error);
    }
    return true;
}

function verifyGame(gameId, deleteComponents = false, op = 'verify') {
    console.log(`Verify button clicked for ${gameId}, deleteComponents: ${deleteComponents}, op: ${op}`);

    const gameMapping = GameUtils.getGameMapping(gameId);
    const displayName = window.GameInstallationManager.getGameDisplayName(gameId);

    GameUtils.trackCommandProgress({
        gameId: gameId,
        command: 'verify-game',
        op: op,
        commandArgs: { game: gameMapping, delete_components: deleteComponents },
        initialMessage: op === 'install'
            ? t('popup.setup.downloading', { game: displayName })
            : t('progress.verifying', { game: displayName }),
        completeMessage: t('progress.verificationComplete'),
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
                window.showMessageBox(
                    t('dialog.stopGameFailedTitle'),
                    t('dialog.stopGameFailedBody', { game: gameDisplayName }),
                    [t('common.ok')]
                );
            }
        });
    }
}

function showSetupFlow(gameId) {
    console.log(`Setup button clicked for ${gameId}`);

    const popups = ensureGamePopups(gameId);

    if (!popups.setupFlowPopup) {
        popups.setupFlowPopup = new SetupFlowPopup();
    }

    const gameDisplayName = window.GameInstallationManager.getGameDisplayName(gameId);
    const gameMapping = window.GameInstallationManager.getGameMapping(gameId);
    popups.setupFlowPopup.show(gameMapping, gameDisplayName);
}


// Settings page functionality
let settingsPopup;



async function checkGameInstallation(gameId) {
    const gameMapping = GameUtils.getGameMapping(gameId);
    const config = GameUtils.getGameConfigByUIId(gameId);
    if (!config) return { hasAnySetup: false, status: 'not-setup' };
    if (config.comingSoon) return { hasAnySetup: false, status: 'not-setup' };

    try {
        if (typeof window.executeCommand === 'function') {
            const isInstalled = await window.executeCommand('get-game-property', {
                game: gameMapping,
                suffix: PROPERTY_KEYS.GAME.IS_INSTALLED
            });
            const installPath = await window.executeCommand('get-game-property', {
                game: gameMapping,
                suffix: PROPERTY_KEYS.GAME.INSTALL
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
            return { hasAnySetup: false, status: 'not-setup' };
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
        // Load "Skip Hash Verification" setting
        const skipHashVerification = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.SKIP_HASH_VERIFICATION);
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
        const closeOnLaunch = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.CLOSE_ON_LAUNCH);
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

        // Load "Skip Client Update" setting
        const skipClientUpdate = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.SKIP_CLIENT_UPDATE);
        const skipClientUpdateToggle = document.getElementById('skip-client-update-toggle');

        if (skipClientUpdateToggle) {
            const buttons = skipClientUpdateToggle.querySelectorAll('.toggle-btn');
            buttons.forEach(btn => btn.classList.remove('active'));

            // Default to "false" if not set
            const targetValue = (skipClientUpdate === 'true') ? 'true' : 'false';
            const targetButton = skipClientUpdateToggle.querySelector(`[data-value="${targetValue}"]`);
            if (targetButton) {
                targetButton.classList.add('active');
            }
        }

        // Load CDN settings
        await initCdnSettings();

        // Load theme setting
        const savedTheme = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.THEME);
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect && savedTheme) {
            themeSelect.value = savedTheme;
        }

        // Load global player name
        const globalPlayerName = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.GLOBAL_PLAYER_NAME);
        const playerNameInput = document.getElementById('setting-global-player-name');
        if (playerNameInput) {
            playerNameInput.value = globalPlayerName || '';
        }

        console.log('Launcher settings loaded');
    } catch (error) {
        console.error('Failed to load launcher settings:', error);
    }
}

function sanitizePlayerName(value) {
    let v = (value || '').replace(/"/g, '');
    if (v.length > 16) v = v.slice(0, 16);
    return v;
}

function setupGlobalPlayerNameInput() {
    const input = document.getElementById('setting-global-player-name');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = 'true';

    let saveTimer = null;
    const saveValue = async (value) => {
        if (typeof window.executeCommand !== 'function') return;
        try {
            await window.executeCommand('set-property', {
                [PROPERTY_KEYS.LAUNCHER.GLOBAL_PLAYER_NAME]: value
            });
            console.log(`Global player name set to: "${value}"`);
        } catch (error) {
            console.error('Failed to save global player name:', error);
        }
    };

    input.addEventListener('input', () => {
        const sanitized = sanitizePlayerName(input.value);
        if (sanitized !== input.value) {
            input.value = sanitized;
        }
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveValue(sanitized), 400);
    });

    input.addEventListener('blur', () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        const sanitized = sanitizePlayerName(input.value);
        if (sanitized !== input.value) {
            input.value = sanitized;
        }
        saveValue(sanitized);
    });
}

// CDN Settings Management
async function initCdnSettings() {
    const cdnSelect = document.getElementById('cdn-server-select');
    const cdnTestBtn = document.getElementById('cdn-test-btn');
    const cdnCustomBtn = document.getElementById('cdn-custom-btn');

    if (!cdnSelect || !cdnTestBtn) {
        console.log('CDN settings elements not found');
        return;
    }

    try {
        const cdnData = await window.executeCommand('get-cdn-servers');

        if (cdnData) {
            syncCustomServerOption(cdnSelect, cdnData);
            cdnSelect.value = cdnData.preference || 'auto';
            updateCdnDropdownLabels(cdnData);

            console.log('CDN settings loaded:', cdnData);
        }
    } catch (error) {
        console.error('Failed to load CDN settings:', error);
    }

    if (!cdnSelect.dataset.bound) {
        cdnSelect.dataset.bound = 'true';
        cdnSelect.addEventListener('change', handleCdnSelectChange);
    }

    cdnTestBtn.onclick = handleCdnTest;
    if (cdnCustomBtn) {
        cdnCustomBtn.onclick = () => openCustomServerFlow(cdnSelect);
    }
}

function syncCustomServerOption(cdnSelect, cdnData) {
    const hasCustom = Array.isArray(cdnData.servers)
        && cdnData.servers.some((s) => s.region === 'custom');
    let customOption = cdnSelect.querySelector('option[value="custom"]');

    if (hasCustom) {
        if (!customOption) {
            customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.setAttribute('data-i18n', 'cdn.custom');
            customOption.textContent = window.LauncherI18n
                ? window.LauncherI18n.t('cdn.custom')
                : 'Custom';
            cdnSelect.appendChild(customOption);
        }
    } else if (customOption) {
        customOption.remove();
    }
}

async function handleCdnSelectChange(e) {
    const value = e.target.value;
    try {
        await window.executeCommand('set-cdn-preference', { region: value });
        console.log(`CDN preference set to: ${value}`);
    } catch (error) {
        console.error('Failed to set CDN preference:', error);
    }
}

async function openCustomServerFlow(cdnSelect) {
    if (!window.customServerPopup) {
        if (typeof window.CustomServerPopup !== 'function') {
            console.error('Custom server popup not available');
            return;
        }
        window.customServerPopup = new window.CustomServerPopup();
    }

    let currentUrl = '';
    try {
        const data = await window.executeCommand('get-cdn-servers');
        if (data && Array.isArray(data.servers)) {
            const custom = data.servers.find((s) => s.region === 'custom');
            if (custom && custom.url) {
                currentUrl = custom.url;
            }
        }
    } catch (error) {
        console.error('Failed to read existing custom server URL:', error);
    }

    const result = await window.customServerPopup.show(currentUrl);
    if (result === undefined) {
        return; // cancelled
    }

    try {
        const saveResult = await window.executeCommand('set-cdn-custom-url', { url: result });
        if (!saveResult || saveResult.success !== true) {
            const message = (saveResult && saveResult.error)
                ? saveResult.error
                : (window.LauncherI18n ? window.LauncherI18n.t('popup.customServer.saveFailed') : 'Failed to save custom server.');
            await window.showMessageBox(
                window.LauncherI18n ? window.LauncherI18n.t('common.error') : 'Error',
                message
            );
            return;
        }

        const refreshed = await window.executeCommand('get-cdn-servers');
        if (refreshed) {
            syncCustomServerOption(cdnSelect, refreshed);
        }

        let nextValue;
        if (result === '') {
            nextValue = 'auto';
            await window.executeCommand('set-cdn-preference', { region: 'auto' });
        } else {
            nextValue = 'custom';
            await window.executeCommand('set-cdn-preference', { region: 'custom' });
        }
        cdnSelect.value = nextValue;
        cdnSelect.dataset.lastValue = nextValue;

        if (refreshed) {
            updateCdnDropdownLabels(refreshed);
        }
    } catch (error) {
        console.error('Failed to save custom server:', error);
    }
}

function updateCdnDropdownLabels(cdnData) {
    const cdnSelect = document.getElementById('cdn-server-select');
    if (!cdnSelect || !cdnData) return;

    let naLatency = null;
    let euLatency = null;
    let customLatency = null;

    if (cdnData.servers) {
        for (const server of cdnData.servers) {
            if (server.latency === null || server.latency === undefined) continue;
            if (server.region === 'na') {
                naLatency = Math.round(server.latency);
            } else if (server.region === 'eu') {
                euLatency = Math.round(server.latency);
            } else if (server.region === 'custom') {
                customLatency = Math.round(server.latency);
            }
        }
    }

    const options = cdnSelect.options;
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const baseText = getBaseOptionText(option.value);

        if (option.value === 'auto' && cdnData.recommended) {
            let recommendedName;
            if (cdnData.recommended === 'eu') recommendedName = 'EU';
            else if (cdnData.recommended === 'custom') recommendedName = t('cdn.custom');
            else recommendedName = 'NA';
            option.textContent = `${baseText} (${recommendedName})`;
        } else if (option.value === 'na' && naLatency !== null) {
            option.textContent = `${baseText} (${naLatency}ms)`;
        } else if (option.value === 'eu' && euLatency !== null) {
            option.textContent = `${baseText} (${euLatency}ms)`;
        } else if (option.value === 'custom' && customLatency !== null) {
            option.textContent = `${baseText} (${customLatency}ms)`;
        } else {
            option.textContent = baseText;
        }
    }
}

function getBaseOptionText(value) {
    switch (value) {
        case 'auto': return t('cdn.auto');
        case 'na': return t('cdn.na');
        case 'eu': return t('cdn.eu');
        case 'custom': return t('cdn.custom');
        default: return value;
    }
}

async function setupLanguageSelect() {
    const languageSelect = document.getElementById('language-select');
    if (!languageSelect) return;

    const currentLanguage = window.LauncherI18n ? window.LauncherI18n.getLanguage() : 'en';
    languageSelect.value = currentLanguage;

    if (!languageSelect.dataset.bound) {
        languageSelect.dataset.bound = 'true';
        languageSelect.addEventListener('change', async (event) => {
            const SUPPORTED_LANGUAGES = ['en', 'fr', 'es'];
            const nextLanguage = SUPPORTED_LANGUAGES.includes(event.target.value) ? event.target.value : 'en';
            const previousLanguage = window.LauncherI18n ? window.LauncherI18n.getLanguage() : 'en';

            try {
                if (typeof window.executeCommand === 'function') {
                    await window.executeCommand('set-property', {
                        [PROPERTY_KEYS.LAUNCHER.LANGUAGE]: nextLanguage
                    });
                }

                if (window.LauncherI18n) {
                    window.LauncherI18n.setLanguage(nextLanguage);
                }

                await refreshLocalizedUI('settings');
            } catch (error) {
                console.error('Failed to save launcher language:', error);
                if (window.LauncherI18n) {
                    window.LauncherI18n.setLanguage(previousLanguage);
                }
                languageSelect.value = previousLanguage;
            }
        });
    }
}

function setupThemeSelect() {
    const themeSelect = document.getElementById('theme-select');
    if (!themeSelect || themeSelect.dataset.bound) return;

    themeSelect.dataset.bound = 'true';
    themeSelect.addEventListener('change', async (event) => {
        const theme = event.target.value;
        applyTheme(theme);
        if (typeof window.executeCommand === 'function') {
            try {
                await window.executeCommand('set-property', {
                    [PROPERTY_KEYS.LAUNCHER.THEME]: theme
                });
            } catch (error) {
                console.error('Failed to save theme:', error);
            }
        }
    });
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
    if (settingsPage.dataset.toggleBound) return;

    settingsPage.dataset.toggleBound = 'true';

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
                    if (settingId === 'skip-hash-verification-toggle') {
                        await window.executeCommand('set-property', {
                            [PROPERTY_KEYS.LAUNCHER.SKIP_HASH_VERIFICATION]: clickedValue
                        });
                        console.log(`Skip hash verification set to: ${clickedValue}`);
                    } else if (settingId === 'close-on-launch-toggle') {
                        await window.executeCommand('set-property', {
                            [PROPERTY_KEYS.LAUNCHER.CLOSE_ON_LAUNCH]: clickedValue
                        });
                        console.log(`Close on launch set to: ${clickedValue}`);
                    } else if (settingId === 'skip-client-update-toggle') {
                        await window.executeCommand('set-property', {
                            [PROPERTY_KEYS.LAUNCHER.SKIP_CLIENT_UPDATE]: clickedValue
                        });
                        console.log(`Skip client update set to: ${clickedValue}`);
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
        t('dialog.resetAllSettingsTitle'),
        t('dialog.resetAllSettingsBody'),
        [t('common.cancel'), t('common.resetSettings')]
    );

    if (result === 1) {
        if (typeof executeCommand === 'function') {
            try {
                // Reset launcher settings
                await executeCommand('set-property', {
                    [PROPERTY_KEYS.LAUNCHER.SKIP_HASH_VERIFICATION]: 'false',
                    [PROPERTY_KEYS.LAUNCHER.CLOSE_ON_LAUNCH]: 'false',
                    [PROPERTY_KEYS.LAUNCHER.SKIP_CLIENT_UPDATE]: 'false',
                    [PROPERTY_KEYS.LAUNCHER.LANGUAGE]: 'en',
                    [PROPERTY_KEYS.LAUNCHER.THEME]: 'dark',
                    [PROPERTY_KEYS.LAUNCHER.GLOBAL_PLAYER_NAME]: '',
                    [PROPERTY_KEYS.LAUNCHER.CDN_CUSTOM_URL]: ''
                });

                // Reset CDN preference to auto
                await executeCommand('set-cdn-preference', { region: 'auto' });

                // Reset all game settings using reset-game-settings command
                await executeCommand('reset-game-settings', { game: 'all' });

                // Clear recent games sidebar / hero rotation
                try { localStorage.removeItem(RECENT_GAMES_KEY); } catch (_) {}
                recentGames = [];
                window.__recentGamesSnapshot = recentGames;
                refreshSidebarMyGames();

                // Dispatch event for game installation updates
                window.dispatchEvent(new CustomEvent('gameInstallationUpdated', {
                    detail: { game: 'all' }
                }));

                await window.showMessageBox(
                    t('dialog.resetDoneTitle'),
                    t('dialog.resetDoneBody'),
                    [t('common.ok')]
                );

                if (window.LauncherI18n) {
                    window.LauncherI18n.setLanguage('en');
                }
                applyTheme('dark');
                const themeSelect = document.getElementById('theme-select');
                if (themeSelect) themeSelect.value = 'dark';

                // Reload settings page to show defaults
                await refreshLocalizedUI('settings');
            } catch (error) {
                console.error('Failed to reset settings:', error);
                await window.showMessageBox(
                    t('dialog.resetFailedTitle'),
                    t('dialog.resetFailedBody'),
                    [t('common.ok')]
                );
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
        syncConsoleButtonLabel();
    } catch (error) {
        console.error('Failed to toggle console:', error);
        consoleVisible = !consoleVisible; // Revert on failure
        syncConsoleButtonLabel();
    }
}

async function handleCheckForUpdates() {
    const updateBtn = document.getElementById('check-updates-btn');
    if (!updateBtn) return;

    // Disable button during update check
    updateBtn.disabled = true;
    const originalText = updateBtn.textContent;
    updateBtn.textContent = t('dialog.updateChecking');

    // Force the browser to paint the UI changes before the blocking operation
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
        if (typeof executeCommand === 'function') {
            const result = await executeCommand('check-launcher-update');

            if (result && result.updateComplete) {
                await window.showMessageBox(
                    t('dialog.updateTitle'),
                    t('dialog.updateLatest'),
                    [t('common.ok')]
                );
            }
            else if (result && result.error) {
                await window.showMessageBox(
                    t('dialog.updateTitle'),
                    t('dialog.updateFailed'),
                    [t('common.ok')]
                );
            }
            else {
                await window.showMessageBox(
                    t('dialog.updateTitle'),
                    t('dialog.updateCancelled'),
                    [t('common.ok')]
                );
            }
        }
    } catch (error) {
        console.error('Failed to check for updates:', error);
        await window.showMessageBox(
            t('dialog.updateTitle'),
            t('dialog.updateFailed'),
            [t('common.ok')]
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
            const branchSuffix = response.gitBranch === 'develop' ? ' (develop)' : '';
            versionElement.dataset.versionLoaded = 'true';
            versionElement.textContent = t('settings.versionValue', {
                version: `${response.version}${branchSuffix}`
            });

            // Add tooltip with more details
            versionElement.title = `File Version: ${response.versionFile}\nCommit: ${response.gitHash.substring(0, 8)}\nBranch: ${response.gitBranch}`;
        }
    } catch (error) {
        console.error('Failed to load version:', error);
        const versionElement = document.getElementById('version-footer');
        if (versionElement) {
            versionElement.dataset.versionLoaded = 'true';
            versionElement.textContent = t('settings.versionUnknown');
        }
    }
}

async function setupDiscordSettings() {
    const item = document.getElementById('setting-discord-item');
    if (!item) return;

    let status = null;
    try {
        status = await window.executeCommand('discord-get-status');
    } catch (error) {
        console.warn('Failed to query Discord status:', error);
    }

    const state = (status && status.status) || 'unavailable';
    if (state === 'unavailable') {
        item.style.display = 'none';
        return;
    }
    item.style.display = '';

    const account = document.getElementById('setting-discord-account');
    const linkBtn = document.getElementById('setting-discord-link-btn');
    const unlinkBtn = document.getElementById('setting-discord-unlink-btn');
    const linked = state === 'linked';
    const busy = state === 'linking' || state === 'connecting';

    if (account) {
        if (linked && status.profile) {
            account.textContent = t('settings.discordLinkedAs', { name: status.profile.displayName });
        } else if (busy) {
            account.textContent = t('friends.linking');
        } else {
            account.textContent = t('settings.discordNotLinked');
        }
    }

    if (linkBtn) {
        linkBtn.style.display = (linked || busy) ? 'none' : '';
        linkBtn.onclick = async () => {
            if (window.DiscordFriendsManager) {
                await window.DiscordFriendsManager.beginLink();
            }
            setupDiscordSettings();
        };
    }

    if (unlinkBtn) {
        unlinkBtn.style.display = linked ? '' : 'none';
        unlinkBtn.onclick = async () => {
            if (window.DiscordFriendsManager) {
                await window.DiscordFriendsManager.unlink();
            }
            setupDiscordSettings();
        };
    }
}

async function initializeSettingsPage() {
    console.log('=== Initializing settings page ===');
    if (window.AppViews) {
        await window.AppViews.renderSettingsDirectories();
    }
    await loadLauncherSettings();
    setupLauncherSettingsToggles();
    setupGlobalPlayerNameInput();
    await setupDiscordSettings();
    await setupLanguageSelect();
    setupThemeSelect();

    // Setup action button listeners
    const resetBtn = document.getElementById('reset-all-settings-btn');
    if (resetBtn) {
        resetBtn.onclick = handleResetAllSettings;
    }

    const updateBtn = document.getElementById('check-updates-btn');
    if (updateBtn) {
        updateBtn.onclick = handleCheckForUpdates;
    }

    const consoleBtn = document.getElementById('show-console-btn');
    if (consoleBtn) {
        consoleBtn.onclick = handleToggleConsole;
    }

    syncConsoleButtonLabel();
    await loadVersion();
    console.log('Settings page initialized');
}

// Listen for installation updates globally
window.addEventListener('gameInstallationUpdated', (event) => {
    console.log('Installation updated globally');
    const targetGame = event.detail.game;

    if (window.AppViews) {
        window.AppViews.refreshInstallationStates(checkGameInstallation);
    }

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
