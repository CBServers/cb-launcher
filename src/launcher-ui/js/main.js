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

    adjustChannelElements();
}

window.showSettings = function() {
    document.querySelector("#settings").click();
}

function initializeNavigation() {
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

    // Initialize with home view
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
        activeGameItem.classList.remove("iw4x-active", "iw6x-active", "s1x-active", "h1-mod-active", "iw7-mod-active", "hmw-mod-active");
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

function setInnerHTML(elm, html) {
    elm.innerHTML = html;
    Array.from(elm.querySelectorAll("script")).forEach(oldScript => {
        const newScript = document.createElement("script");
        Array.from(oldScript.attributes)
            .forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

function loadBackgroundImage(gameId) {
    const heroSection = document.querySelector('.hero-section');
    if (!heroSection || !gameId) return;

    const imageMap = {
        'boiii': './img/boiii-hero.png',
        'iw6x': './img/iw6x-hero.png',
        's1x': './img/s1x-hero.png',
        'h1-mod': './img/h1-mod-hero.png',
        'iw7-mod': './img/iw7-mod-hero.png',
        'hmw-mod': './img/hmw-mod-hero.png'
    };

    const imagePath = imageMap[gameId];
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
    const heroSection = document.querySelector('.hero-section');
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
    const imageMap = {
        'boiii': ['./img/boiii.png', './img/boiii-hero.png'],
        'iw6x': ['./img/iw6x.png', './img/iw6x-hero.png'],
        's1x': ['./img/s1x.png', './img/s1x-hero.png'],
        'h1-mod': ['./img/h1-mod.png', './img/h1-mod-hero.png'],
        'iw7-mod': ['./img/iw7-mod.png', './img/iw7-mod-hero.png'],
        'hmw-mod': ['./img/hmw-mod.png', './img/hmw-mod-hero.png'],
        'home': ['./img/cb-hero.png']
    };

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
    const iconMap = {
        'boiii': './img/boiii.png',
        'iw6x': './img/iw6x.png',
        's1x': './img/s1x.png',
        'h1-mod': './img/h1-mod.png',
        'iw7-mod': './img/iw7-mod.png',
        'hmw-mod': './img/hmw-mod.png'
    };

    Object.keys(iconMap).forEach(gameId => {
        const thumbnail = document.querySelector(`.${gameId}-thumb`);
        if (!thumbnail) return;

        const imagePath = iconMap[gameId];
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
        const installProperty = this.getInstallProperty(gameId);
        if (!installProperty) return false;

        try {
            if (typeof window.executeCommand === 'function') {
                const installPath = await window.executeCommand('get-property', installProperty);
                return installPath && installPath.trim() !== '';
            } else {
                // Mock for development
                console.log(`Mock: Checking installation for ${gameId}`);
                return false; // Default to not installed for testing
            }
        } catch (error) {
            console.error('Error checking installation:', error);
            return false;
        }
    },

    getInstallProperty(gameId) {
        const mapping = {
            'boiii': 'bo3-install',
            'iw6x': 'ghosts-install',
            's1x': 'aw-install',
            'h1-mod': 'mwr-install',
            'iw7-mod': 'iw7-install',
            'hmw-mod': 'hmw-install'
        };
        return mapping[gameId];
    },

    getGameMapping(gameId) {
        const mapping = {
            'boiii': 'bo3',
            'iw6x': 'ghosts',
            's1x': 'aw',
            'h1-mod': 'mwr',
            'iw7-mod': 'iw7',
            'hmw-mod': 'hmw'
        };
        return mapping[gameId];
    },

    getGameDisplayName(gameId) {
        const mapping = {
            'boiii': 'Black Ops 3',
            'iw6x': 'Call of Duty: Ghosts',
            's1x': 'Advanced Warfare',
            'h1-mod': 'Modern Warfare Remastered',
            'iw7-mod': 'Infinite Warfare',
            'hmw-mod': 'HorizonMW'
        };
        return mapping[gameId];
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
            const iconMap = {
                'boiii': './img/boiii.png',
                'iw6x': './img/iw6x.png',
                's1x': './img/s1x.png',
                'h1-mod': './img/h1-mod.png',
                'iw7-mod': './img/iw7-mod.png',
                'hmw-mod': './img/hmw-mod.png'
            };

            const imagePath = iconMap[gameId];
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
        progressPercent.textContent = `${Math.round(progress)}%`;
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
        const buttons = document.querySelectorAll('.play-button, .verify-button');
        buttons.forEach(btn => {
            btn.disabled = true;
        });
        console.log(`Disabled ${buttons.length} buttons`);
    },

    enableButtons: function() {
        const buttons = document.querySelectorAll('.play-button, .verify-button');
        buttons.forEach(btn => {
            btn.disabled = false;
        });
        console.log(`Enabled ${buttons.length} buttons`);
    }
};

function loadNavigationPage(page) {
    var content = document.querySelector(".content-area");
    if (!content) {
        console.error("Content area not found");
        return Promise.reject("Content area not found");
    }

    return fetch(`./pages/${page}.html`).then(data => {
        if (!data.ok) {
            throw new Error(`HTTP error! status: ${data.status}`);
        }
        return data.text()
    }).then(text => {
        setInnerHTML(content, text);

        // After loading new page content, check if progress is active and disable buttons if needed
        if (window.ProgressManager && window.ProgressManager.isActive) {
            // Use setTimeout to ensure buttons are in DOM before disabling
            setTimeout(() => {
                window.ProgressManager.disableButtons();
            }, 0);
        }

        // Try to load background image for game pages
        if (['boiii', 'iw6x', 's1x', 'h1-mod', 'iw7-mod', 'hmw-mod'].includes(page)) {
            // Load background image immediately since images are preloaded
            loadBackgroundImage(page);
        } else if (page === 'home') {
            // Load CB hero image for home page
            loadHomeBackgroundImage();
        } else {
            // Clear background image for other pages
            const heroSection = document.querySelector('.hero-section');
            if (heroSection) {
                heroSection.style.backgroundImage = 'none';
            }
        }
    }).catch(error => {
        console.error(`Failed to load page ${page}:`, error);
        // Fallback content
        content.innerHTML = `<div class="description">Failed to load page: ${page}<br>Error: ${error.message}</div>`;
    });
}