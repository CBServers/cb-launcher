// Rendering helpers for the static launcher shell.

(function() {
    const HOME_HERO_SLIDE_INTERVAL = 6500;

    let homeHeroStates = [];
    let homeHeroSlideIndex = 0;
    let homeHeroTimer = null;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function resolveAssetUrl(path) {
        try {
            return new URL(path, window.location.href).href;
        } catch (_) {
            return path || '';
        }
    }

    function cssUrl(path) {
        return `url("${String(resolveAssetUrl(path)).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
    }

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function gameDescription(config) {
        return window.LauncherI18n
            ? window.LauncherI18n.getGameText(config.uiId, 'description', config.description)
            : config.description;
    }

    function gameCredits(config) {
        return window.LauncherI18n
            ? window.LauncherI18n.getGameText(config.uiId, 'credits', config.credits)
            : config.credits;
    }

    function navigateTo(pageOrGameId) {
        const navItem = document.getElementById(pageOrGameId);
        if (navItem) {
            navItem.click();
            return;
        }

        const gameItem = document.querySelector(`.game-item[data-game="${pageOrGameId}"]`);
        if (gameItem) {
            gameItem.click();
        }
    }

    function installLabel(status, config) {
        if (status === 'installed') return t('status.readyToPlay');
        if (status === 'partial') return t('common.finishSetup');
        return t('status.notInstalled');
    }

    function statusClass(status) {
        if (status === 'installed') return 'status-installed';
        if (status === 'partial') return 'status-partial';
        return 'status-missing';
    }

    function renderHomeClientCards(targetId, configs) {
        const clients = document.getElementById(targetId);
        if (!clients) return;

        clients.innerHTML = configs.map(config => `
            <article class="client-card" data-game="${escapeHtml(config.uiId)}">
                <img class="client-card-art" src="${escapeHtml(config.capsulePath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                <div class="client-card-label">
                    <span>${escapeHtml(config.displayName)}</span>
                    <small>${escapeHtml(config.client)}</small>
                </div>
            </article>
        `).join('');

        clients.querySelectorAll('.client-card').forEach(card => {
            card.addEventListener('click', () => navigateTo(card.dataset.game));
        });
    }

    function homeActionLabel(status) {
        if (status === 'installed') return t('common.play');
        if (status === 'partial') return t('common.finishSetup');
        return t('common.install');
    }

    function renderHomeHero(config, status) {
        if (!config) return;

        const normalizedStatus = status || 'not-setup';
        const isInstalled = normalizedStatus === 'installed';
        const hero = document.getElementById('hub-hero');
        const logo = document.getElementById('hub-hero-logo');
        const title = document.getElementById('hub-hero-title');
        const sub = document.getElementById('hub-hero-sub');
        const cta = document.getElementById('hub-hero-play');

        if (hero) {
            hero.classList.remove('is-changing');
            void hero.offsetWidth;
            hero.classList.add('is-changing');
            hero.style.setProperty('--hero-image', cssUrl(config.heroImagePath));
            hero.style.backgroundImage = '';
            hero.dataset.game = config.uiId;
            hero.onclick = () => navigateTo(config.uiId);
        }
        if (logo) {
            logo.src = config.logoPath;
            logo.alt = config.displayName;
        }
        if (title) title.textContent = config.displayName;
        if (sub) sub.textContent = gameDescription(config);
        if (cta) {
            const label = homeActionLabel(normalizedStatus);
            cta.classList.toggle('setup-button', !isInstalled);
            cta.innerHTML = isInstalled
                ? `<span class="play-icon"></span>${escapeHtml(label)}`
                : escapeHtml(label);
            cta.onclick = (event) => {
                event.stopPropagation();
                if (isInstalled && typeof launchGame === 'function') {
                    launchGame(config.uiId);
                } else if (typeof showSetupFlow === 'function') {
                    showSetupFlow(config.uiId);
                } else {
                    navigateTo(config.uiId);
                }
            };
        }
    }

    function setHomeHeroSlide(index) {
        if (!homeHeroStates.length) return;

        homeHeroSlideIndex = ((index % homeHeroStates.length) + homeHeroStates.length) % homeHeroStates.length;
        const slide = homeHeroStates[homeHeroSlideIndex];
        renderHomeHero(slide.config, slide.status);
    }

    function startHomeHeroSlider() {
        if (homeHeroTimer) {
            clearInterval(homeHeroTimer);
            homeHeroTimer = null;
        }

        if (homeHeroStates.length <= 1) return;

        homeHeroTimer = setInterval(() => {
            const homePage = document.getElementById('home-page');
            if (homePage && homePage.style.display === 'none') return;

            setHomeHeroSlide(homeHeroSlideIndex + 1);
        }, HOME_HERO_SLIDE_INTERVAL);
    }

    function setHomeHeroStates(states) {
        homeHeroStates = states
            .filter(({ config }) => config)
            .map(({ config, status }) => ({ config, status: status || 'not-setup' }));

        if (!homeHeroStates.length) {
            homeHeroStates = GameUtils.getAllGameConfigs().map(config => ({
                config,
                status: 'not-setup'
            }));
        }

        if (homeHeroSlideIndex >= homeHeroStates.length) {
            homeHeroSlideIndex = 0;
        }

        setHomeHeroSlide(homeHeroSlideIndex);
        startHomeHeroSlider();
    }

    function renderHomeFromStates(states) {
        const safeStates = Array.isArray(states) ? states : [];

        renderHomeClientCards('home-ready-row', safeStates
            .filter(({ config, status }) => config && status === 'installed')
            .map(({ config }) => config));

        renderHomeClientCards('home-not-installed-row', safeStates
            .filter(({ config, status }) => config && status !== 'installed')
            .map(({ config }) => config));

        setHomeHeroStates(safeStates);
    }

    async function getInstallationStates(checker) {
        if (typeof checker !== 'function') return [];

        return Promise.all(GameUtils.getAllGameIds().map(async gameId => {
            const config = GameUtils.getGameConfigByUIId(gameId);

            try {
                const result = await checker(gameId);
                return {
                    gameId,
                    config,
                    status: result && result.status ? result.status : 'not-setup'
                };
            } catch (error) {
                console.error(`Failed to refresh ${gameId} state`, error);
                return { gameId, config, status: 'not-setup' };
            }
        }));
    }

    function renderPlayBehaviorOptions(config) {
        const modeInfo = GameUtils.getModeInfo();
        const options = [
            `<option value="ask">${escapeHtml(t('popup.gameSettings.askEveryTime'))}</option>`
        ];

        config.supportedModes.forEach(mode => {
            const info = modeInfo[mode] || { name: mode.toUpperCase() };
            options.push(`<option value="${escapeHtml(mode)}">${escapeHtml(info.name)}</option>`);
        });

        return options.join('');
    }

    function renderClientSettingsPanel(config) {
        const backendGame = GameUtils.getGameMapping(config.uiId);
        const pathInputId = `${config.uiId}-client-settings-path`;
        const playBehaviorId = `${config.uiId}-client-settings-play-behavior`;
        const launchOptionsId = `${config.uiId}-client-settings-launch-options`;

        let gameSpecificSection = '';
        if (backendGame === 'bo3') {
            gameSpecificSection = `
                <div class="settings-section">
                    <h4>${escapeHtml(t('popup.gameSettings.gameOptions'))}</h4>
                    <div class="setting-item inline-setting">
                        <label>${escapeHtml(t('popup.gameSettings.skipIntroCinematic'))}</label>
                        <div class="toggle-group small" data-setting="skip-intro-cinematic">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                </div>
            `;
        } else if (backendGame === 'hmw') {
            gameSpecificSection = `
                <div class="settings-section">
                    <h4>${escapeHtml(t('popup.gameSettings.gameOptions'))}</h4>
                    <div class="setting-item inline-setting">
                        <label>${escapeHtml(t('popup.gameSettings.disableCbExtension'))}</label>
                        <div class="toggle-group small" data-setting="disable-cb-extension">
                            <button class="toggle-btn" data-value="false">OFF</button>
                            <button class="toggle-btn" data-value="true">ON</button>
                        </div>
                    </div>
                </div>
            `;
        } else if (config.hasMultipleModes) {
            gameSpecificSection = `
                <div class="settings-section">
                    <h4>${escapeHtml(t('popup.gameSettings.playButtonBehavior'))}</h4>
                    <div class="setting-item">
                        <label for="${escapeHtml(playBehaviorId)}">${escapeHtml(t('popup.gameSettings.playButtonBehaviorLabel'))}</label>
                        <select id="${escapeHtml(playBehaviorId)}" class="behavior-dropdown" data-setting="play-behavior">
                            ${renderPlayBehaviorOptions(config)}
                        </select>
                    </div>
                </div>
            `;
        }

        return `
            <section class="description tab-panel inline-game-settings" data-panel="client-settings" data-game="${escapeHtml(config.uiId)}">
                <div class="settings-section">
                    <h4>${escapeHtml(t('popup.gameSettings.installationPath'))}</h4>
                    <div class="setting-item">
                        <label for="${escapeHtml(pathInputId)}">${escapeHtml(t('popup.gameSettings.installationFolderWithGame', { game: config.displayName }))}</label>
                        <div class="input-group">
                            <input type="text" id="${escapeHtml(pathInputId)}" data-setting="game-path" placeholder="${escapeHtml(t('popup.gameSettings.installationPlaceholder'))}" readonly>
                            <button class="browse-button inline-settings-browse" data-game="${escapeHtml(config.uiId)}">${escapeHtml(t('common.browse'))}</button>
                        </div>
                        <button class="secondary-action inline-settings-verify" data-game="${escapeHtml(config.uiId)}" disabled>
                            <span class="secondary-action-icon steam-icon"></span>
                            ${escapeHtml(t('detail.verifySteamFiles'))}
                        </button>
                    </div>
                </div>
                ${gameSpecificSection}
                <div class="settings-section">
                    <h4>${escapeHtml(t('popup.gameSettings.advanced'))}</h4>
                    <div class="setting-item">
                        <label for="${escapeHtml(launchOptionsId)}">${escapeHtml(t('popup.gameSettings.launchOptions'))}</label>
                        <input type="text" id="${escapeHtml(launchOptionsId)}" class="launch-options-input" data-setting="launch-options">
                    </div>
                </div>
                <div class="inline-settings-actions">
                    <button class="btn-reset inline-settings-reset" data-game="${escapeHtml(config.uiId)}">${escapeHtml(t('common.resetSettings'))}</button>
                    <button class="btn-save inline-settings-save" data-game="${escapeHtml(config.uiId)}">${escapeHtml(t('common.saveSettings'))}</button>
                </div>
            </section>
        `;
    }

    function activateGameDetailPanel(gameId, panelName) {
        const page = document.getElementById(`${gameId}-page`);
        if (!page) return;

        const tabGroup = page.querySelector('.detail-tabs');
        if (tabGroup) {
            tabGroup.querySelectorAll('.detail-tab').forEach(item => {
                item.classList.toggle('active', item.dataset.tab === panelName);
            });
        }

        page.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.panel === panelName);
        });

        if (panelName === 'client-settings' &&
            window.GameDetailPage &&
            typeof window.GameDetailPage.loadClientSettings === 'function') {
            window.GameDetailPage.loadClientSettings(gameId);
        }
    }

    function renderHome() {
        const featured = GameUtils.getFeaturedGame();
        if (!featured) return;

        renderHomeHero(featured, 'not-setup');
        renderHomeClientCards('home-ready-row', []);
        renderHomeClientCards('home-not-installed-row', GameUtils.getAllGameConfigs());

        const openLibrary = document.getElementById('home-view-library');
        if (openLibrary) openLibrary.onclick = () => navigateTo('library');

        setHomeHeroStates(GameUtils.getAllGameConfigs().map(config => ({
            config,
            status: 'not-setup'
        })));
    }

    function renderSidebarGames() {
        document.querySelectorAll('.sidebar .game-item').forEach(item => {
            const gameId = item.dataset.game || item.id;
            const config = GameUtils.getGameConfigByUIId(gameId);
            if (!config) return;

            item.style.setProperty('--game-accent', config.accent || '#8AA4FF');
            item.innerHTML = `
                <div class="game-item-thumb">
                    <img src="${escapeHtml(config.iconPath || config.capsulePath || config.logoPath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                </div>
                <div class="game-item-copy">
                    <span class="game-item-title">${escapeHtml(config.displayName)}</span>
                    <small class="game-item-sub">${escapeHtml(config.codeName)}</small>
                </div>
            `;
            item.setAttribute('title', config.displayName);
            item.setAttribute('aria-label', config.displayName);
        });
    }

    function renderLibrary() {
        const grid = document.getElementById('library-grid');
        if (!grid) return;

        grid.innerHTML = GameUtils.getAllGameConfigs().map(config => `
            <article class="library-card" data-game="${escapeHtml(config.uiId)}" data-client="${escapeHtml(config.clientKey)}" data-status="not-setup" data-search="${escapeHtml(`${config.displayName} ${config.codeName} ${config.client}`.toLowerCase())}">
                <img class="library-card-art" src="${escapeHtml(config.capsulePath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                <div class="library-card-progress" aria-hidden="true">
                    <span></span>
                </div>
                <div class="library-card-body">
                    <div class="library-card-title">${escapeHtml(config.displayName)}</div>
                    <div class="library-card-meta">
                        <span class="badge client">${escapeHtml(config.client)}</span>
                        <span class="badge status-missing" data-status-badge>${escapeHtml(installLabel('not-setup', config))}</span>
                    </div>
                    <button class="library-install-btn" data-action="setup">
                        <span class="progress-ring"></span>
                        <span data-action-label>${escapeHtml(t('common.install'))}</span>
                    </button>
                </div>
            </article>
        `).join('');

        grid.querySelectorAll('.library-card').forEach(card => {
            card.addEventListener('click', () => navigateTo(card.dataset.game));

            const button = card.querySelector('.library-install-btn');
            if (button) {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (card.dataset.status === 'installed' && typeof launchGame === 'function') {
                        launchGame(card.dataset.game);
                    } else if (typeof showSetupFlow === 'function') {
                        showSetupFlow(card.dataset.game);
                    } else {
                        navigateTo(card.dataset.game);
                    }
                });
            }
        });

        bindLibraryControls();
    }

    function bindLibraryControls() {
        const filters = document.getElementById('library-filters');
        const search = document.getElementById('library-search');

        function applyFilters() {
            const active = filters ? filters.querySelector('.chip.active') : null;
            const filter = active ? active.dataset.filter : 'all';
            const term = search ? search.value.trim().toLowerCase() : '';
            const cards = document.querySelectorAll('.library-card');
            let visibleCount = 0;

            cards.forEach(card => {
                const status = card.dataset.status;
                const client = card.dataset.client;
                const matchesFilter =
                    filter === 'all' ||
                    (filter === 'installed' && status === 'installed') ||
                    (filter === 'not-installed' && status !== 'installed') ||
                    filter === client;
                const matchesSearch = !term || card.dataset.search.includes(term);
                const isVisible = matchesFilter && matchesSearch;

                card.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleCount += 1;
            });

            let empty = document.querySelector('.library-card-empty');
            if (!visibleCount) {
                if (!empty) {
                    empty = document.createElement('div');
                    empty.className = 'library-card library-card-empty';
                    empty.textContent = t('library.noMatches');
                    document.getElementById('library-grid').appendChild(empty);
                }
            } else if (empty) {
                empty.remove();
            }
        }

        if (filters && !filters.dataset.bound) {
            filters.dataset.bound = 'true';
            filters.addEventListener('click', (event) => {
                const chip = event.target.closest('.chip');
                if (!chip) return;
                filters.querySelectorAll('.chip').forEach(item => item.classList.remove('active'));
                chip.classList.add('active');
                applyFilters();
            });
        }

        if (search && !search.dataset.bound) {
            search.dataset.bound = 'true';
            search.addEventListener('input', applyFilters);
        }

        applyFilters();
    }

    function updateLibraryCard(gameId, status) {
        const card = document.querySelector(`.library-card[data-game="${gameId}"]`);
        const config = GameUtils.getGameConfigByUIId(gameId);
        if (!card || !config) return;

        const normalizedStatus = status || 'not-setup';
        const badge = card.querySelector('[data-status-badge]');
        const action = card.querySelector('[data-action-label]');

        card.dataset.status = normalizedStatus;
        card.classList.toggle('is-installed', normalizedStatus === 'installed');
        card.classList.toggle('is-partial', normalizedStatus === 'partial');

        if (badge) {
            badge.className = `badge ${statusClass(normalizedStatus)}`;
            badge.textContent = installLabel(normalizedStatus, config);
        }

        if (action) {
            if (normalizedStatus === 'installed') {
                action.textContent = t('common.play');
            } else if (normalizedStatus === 'partial') {
                action.textContent = t('common.finishSetup');
            } else {
                action.textContent = t('common.install');
            }
        }
    }

    async function refreshInstallationStates(checker) {
        const states = await getInstallationStates(checker);

        states.forEach(({ gameId, status }) => {
            updateLibraryCard(gameId, status);
        });

        renderHomeFromStates(states);

        bindLibraryControls();
    }

    async function refreshHomeInstalledClients(checker) {
        const states = await getInstallationStates(checker);

        renderHomeFromStates(states);
    }

    function renderGamePages() {
        const host = document.getElementById('game-pages');
        if (!host) return;

        host.innerHTML = GameUtils.getAllGameConfigs().map(config => `
            <div class="page-section game-page" id="${escapeHtml(config.uiId)}-page" style="display: none;">
                <div class="game-detail-bg" style="background-image: ${cssUrl(config.heroImagePath)}"></div>
                <div class="hero-section ${escapeHtml(config.uiId)}" style="--hero-image: ${cssUrl(config.heroImagePath)}">
                    <div class="hero-content detail-glass-panel">
                        <img class="game-logo-img" src="${escapeHtml(config.logoPath)}" alt="${escapeHtml(config.displayName)}">
                        <p class="game-summary">${escapeHtml(gameDescription(config))}</p>
                        <div class="game-meta-row">
                            <span>${escapeHtml(config.codeName)}</span>
                            <span>${escapeHtml(config.localSize)}</span>
                        </div>
                    </div>
                </div>

                <div class="game-details">
                    <div class="button-group" id="${escapeHtml(config.uiId)}-button-group"></div>

                    <div class="detail-tabs" data-tabs="${escapeHtml(config.uiId)}">
                        <button class="detail-tab active" data-tab="overview">${escapeHtml(t('detail.overview'))}</button>
                        <button class="detail-tab" data-tab="mods">${escapeHtml(t('detail.modsScripts'))}</button>
                    </div>

                    <div class="detail-panel-grid">
                        <section class="description tab-panel active" data-panel="overview">
                            <strong>${escapeHtml(config.displayName)}</strong>
                            <p>${escapeHtml(gameDescription(config))}</p>
                            <br>
                            <strong>${escapeHtml(t('detail.credits'))}</strong>
                            <p>${escapeHtml(gameCredits(config))}</p>
                            <br>
                            <strong>${escapeHtml(t('detail.note'))}</strong>
                            <p>${escapeHtml(t('detail.noteBody'))}</p>
                        </section>
                        ${renderClientSettingsPanel(config)}

                        <aside class="detail-actions-panel">
                            <button class="secondary-action detail-manage-install-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon folder-icon"></span>
                                ${escapeHtml(t('common.manageInstall'))}
                            </button>
                            <button class="secondary-action detail-settings-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon settings-action-icon"></span>
                                ${escapeHtml(t('detail.clientSettings'))}
                            </button>
                            <div class="detail-stat">
                                <span>${escapeHtml(t('detail.steamAppId'))}</span>
                                <strong>${config.steamAppId ? escapeHtml(config.steamAppId) : escapeHtml(t('detail.customClient'))}</strong>
                            </div>
                            <div class="detail-stat">
                                <span>${escapeHtml(t('detail.client'))}</span>
                                <strong>${escapeHtml(config.client)}</strong>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        `).join('');

        host.querySelectorAll('.detail-tabs').forEach(tabGroup => {
            tabGroup.addEventListener('click', async event => {
                const tab = event.target.closest('.detail-tab');
                if (!tab) return;
                const gameId = tabGroup.dataset.tabs;

                if (tab.dataset.tab === 'mods') {
                    if (window.GameDetailPage && typeof window.GameDetailPage.openModsScriptsFolder === 'function') {
                        await window.GameDetailPage.openModsScriptsFolder(gameId);
                    }
                    return;
                }

                activateGameDetailPanel(gameId, tab.dataset.tab);
            });
        });

        host.querySelectorAll('.detail-settings-action').forEach(button => {
            button.addEventListener('click', () => {
                activateGameDetailPanel(button.dataset.game, 'client-settings');
            });
        });

        host.querySelectorAll('.detail-manage-install-action').forEach(button => {
            button.addEventListener('click', () => {
                if (typeof showManageInstall === 'function') {
                    showManageInstall(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.inline-settings-browse').forEach(button => {
            button.addEventListener('click', () => {
                if (window.GameDetailPage && typeof window.GameDetailPage.browseClientSettingsPath === 'function') {
                    window.GameDetailPage.browseClientSettingsPath(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.inline-settings-save').forEach(button => {
            button.addEventListener('click', () => {
                if (window.GameDetailPage && typeof window.GameDetailPage.saveClientSettings === 'function') {
                    window.GameDetailPage.saveClientSettings(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.inline-settings-reset').forEach(button => {
            button.addEventListener('click', () => {
                if (window.GameDetailPage && typeof window.GameDetailPage.resetClientSettings === 'function') {
                    window.GameDetailPage.resetClientSettings(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.inline-settings-verify').forEach(button => {
            button.addEventListener('click', () => {
                if (window.GameDetailPage && typeof window.GameDetailPage.verifyConfiguredGame === 'function') {
                    window.GameDetailPage.verifyConfiguredGame(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.inline-game-settings .toggle-group').forEach(toggleGroup => {
            toggleGroup.addEventListener('click', event => {
                const button = event.target.closest('.toggle-btn');
                if (!button) return;

                toggleGroup.querySelectorAll('.toggle-btn').forEach(item => item.classList.remove('active'));
                button.classList.add('active');
            });
        });
    }

    async function renderSettingsDirectories() {
        const list = document.getElementById('settings-directory-list');
        if (!list) return;

        const installPaths = {};

        if (typeof window.executeCommand === 'function') {
            await Promise.all(GameUtils.getAllGameConfigs().map(async config => {
                try {
                    const savedPath = await window.executeCommand('get-game-property', {
                        game: GameUtils.getGameMapping(config.uiId),
                        suffix: PROPERTY_KEYS.GAME.INSTALL
                    });

                    installPaths[config.uiId] = typeof savedPath === 'string' ? savedPath.trim() : '';
                } catch (error) {
                    console.error(`Failed to load install path for ${config.uiId}:`, error);
                    installPaths[config.uiId] = '';
                }
            }));
        }

        list.innerHTML = GameUtils.getAllGameConfigs().map(config => `
            <div class="directory-row">
                <div class="directory-game">
                    <img src="${escapeHtml(config.capsulePath)}" alt="">
                    <div>
                        <strong>${escapeHtml(config.displayName)}</strong>
                        <span>${escapeHtml(installPaths[config.uiId] || t('settings.notConfiguredPath'))}</span>
                    </div>
                </div>
                <button class="directory-configure" data-game="${escapeHtml(config.uiId)}">${escapeHtml(t('common.configure'))}</button>
            </div>
        `).join('');

        list.querySelectorAll('.directory-configure').forEach(button => {
            button.addEventListener('click', () => {
                if (typeof showGameSettings === 'function') {
                    showGameSettings(button.dataset.game);
                } else {
                    navigateTo(button.dataset.game);
                }
            });
        });
    }

    function renderComponentLibrary() {
        const page = document.getElementById('component-library-page');
        if (!page) return;

        const sample = GameUtils.getFeaturedGame() || GameUtils.getAllGameConfigs()[0];
        page.innerHTML = `
            <div class="page-header">
                <div class="page-title">${escapeHtml(t('componentLibrary.title'))}</div>
                <div class="page-subtitle">${escapeHtml(t('componentLibrary.subtitle'))}</div>
            </div>
            <div class="component-library-grid">
                <section class="component-frame">
                    <h3>${escapeHtml(t('componentLibrary.buttons'))}</h3>
                    <button class="play-button"><span class="play-icon"></span>${escapeHtml(t('common.play'))}</button>
                    <button class="verify-button">${escapeHtml(t('common.verify'))}</button>
                    <button class="manage-install-button">${escapeHtml(t('common.manageInstall'))}</button>
                    <button class="setup-button" disabled>${escapeHtml(t('common.disabled'))}</button>
                </section>
                <section class="component-frame">
                    <h3>${escapeHtml(t('componentLibrary.inputs'))}</h3>
                    <div class="search-field component-search">
                        <input type="text" placeholder="${escapeHtml(t('library.searchPlaceholder'))}" value="Plutonium">
                    </div>
                    <div class="toggle-group small">
                        <button class="toggle-btn">OFF</button>
                        <button class="toggle-btn active">ON</button>
                    </div>
                </section>
                <section class="component-frame">
                    <h3>${escapeHtml(t('componentLibrary.badges'))}</h3>
                    <span class="badge client">Plutonium</span>
                    <span class="badge status-installed">${escapeHtml(t('status.readyToPlay'))}</span>
                    <span class="badge status-partial">${escapeHtml(t('status.updateClient'))}</span>
                    <span class="badge status-missing">${escapeHtml(t('status.baseGameMissing'))}</span>
                </section>
                <section class="component-frame">
                    <h3>${escapeHtml(t('componentLibrary.card'))}</h3>
                    <article class="library-card component-card">
                        <img class="library-card-art" src="${escapeHtml(sample ? sample.capsulePath : '')}" alt="${sample ? escapeHtml(sample.displayName) : 'Client'}" loading="lazy">
                        <div class="library-card-body">
                            <div class="library-card-title">${sample ? escapeHtml(sample.displayName) : 'Client'}</div>
                        </div>
                    </article>
                </section>
            </div>
        `;
    }

    function renderAll() {
        renderSidebarGames();
        renderHome();
        renderLibrary();
        renderGamePages();
        renderSettingsDirectories();
        renderComponentLibrary();
    }

    window.AppViews = {
        renderAll,
        renderSidebarGames,
        renderHome,
        renderLibrary,
        renderGamePages,
        renderSettingsDirectories,
        refreshInstallationStates,
        refreshHomeInstalledClients,
        updateLibraryCard,
        navigateTo,
        activateGameDetailPanel
    };
})();
