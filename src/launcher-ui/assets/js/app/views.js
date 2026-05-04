// Rendering helpers for the static launcher shell.

(function() {
    const HOME_HERO_SLIDE_INTERVAL = 6500;

    const NEWS_ITEMS = [
        { tag: 'Client Update', title: 'BOIII updated to v1.6.2',    body: 'Stability fixes and improved anti-cheat compatibility.',               time: '2 hours ago', accent: '#F3751B' },
        { tag: 'Client Update', title: 'IW4x r3492 released',        body: 'Improved matchmaking and fixed MW2 crash on large lobbies.',           time: '1 day ago',   accent: '#FBC751' },
        { tag: 'Announcement',  title: 'EU CDN now live',             body: 'European download server is online — expect faster installs.',         time: '3 days ago',  accent: '#6C63FF' },
        { tag: 'Client Update', title: 'Plutonium T6 patch',          body: 'Resolved zombie matchmaking desync and lobby crash issues.',           time: '5 days ago',  accent: '#FE890A' },
    ];

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

    function gameDescriptionNote(config) {
        return window.LauncherI18n
            ? window.LauncherI18n.getGameText(config.uiId, 'descriptionNote', '')
            : '';
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

    function renderNewsSection() {
        const grid = document.getElementById('news-grid');
        if (!grid) return;

        grid.innerHTML = NEWS_ITEMS.map(item => `
            <div class="news-card" style="--news-accent: ${escapeHtml(item.accent)}">
                <div class="news-card-header">
                    <span class="news-card-tag" style="color:${escapeHtml(item.accent)};background:${escapeHtml(item.accent)}22;border:1px solid ${escapeHtml(item.accent)}44">${escapeHtml(item.tag)}</span>
                    <span class="news-card-time">${escapeHtml(item.time)}</span>
                </div>
                <div class="news-card-title">${escapeHtml(item.title)}</div>
                <div class="news-card-body">${escapeHtml(item.body)}</div>
            </div>
        `).join('');
    }

    function updateSidebarRecentGames(recentIds) {
        const gameItems = document.querySelectorAll('.sidebar .game-item');
        let visibleCount = 0;

        gameItems.forEach(item => {
            const gameId = item.dataset.game || item.id;
            const isRecent = Array.isArray(recentIds) && recentIds.includes(gameId);
            item.style.display = isRecent ? '' : 'none';
            if (isRecent) visibleCount++;
        });

        const label = document.querySelector('.game-list-label');
        if (label) {
            label.style.display = visibleCount > 0 ? '' : 'none';
        }
    }

    function renderHome() {
        const featured = GameUtils.getFeaturedGame();
        if (!featured) return;

        renderHomeHero(featured, 'not-setup');
        renderHomeClientCards('home-ready-row', []);
        renderNewsSection();

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
                <div class="hero-section ${escapeHtml(config.uiId)}" style="--hero-image: ${cssUrl(config.heroImagePath)}">
                    <div class="hero-bottom-content">
                        <img class="game-logo-img" src="${escapeHtml(config.logoPath)}" alt="${escapeHtml(config.displayName)}">
                        <div class="game-meta-row">
                            <span>${escapeHtml(config.codeName)}</span>
                        </div>
                    </div>
                </div>

                <div class="game-details">
                    <div class="button-group" id="${escapeHtml(config.uiId)}-button-group"></div>

                    <div class="detail-panel-grid">
                        <section class="description">
                            <strong>${escapeHtml(config.displayName)}</strong>
                            <p>${escapeHtml(gameDescription(config))}</p>
                            ${gameDescriptionNote(config) ? `<br><p>${gameDescriptionNote(config)}</p>` : ''}
                            <br>
                            <strong>${escapeHtml(t('detail.credits'))}</strong>
                            <p>${gameCredits(config)}</p>
                            <br>
                            <strong>${escapeHtml(t('detail.note'))}</strong>
                            <p>${escapeHtml(t('detail.noteBody'))}</p>
                        </section>

                        <aside class="detail-actions-panel">
                            <button class="secondary-action detail-browse-files-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon folder-icon"></span>
                                ${escapeHtml(t('common.browseLocalFiles'))}
                            </button>
                            <button class="secondary-action detail-verify-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon verify-icon"></span>
                                ${escapeHtml(t('common.verify'))}
                            </button>
                            <button class="secondary-action detail-manage-install-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon files-icon"></span>
                                ${escapeHtml(t('common.manageInstall'))}
                            </button>
                            <button class="secondary-action detail-settings-action" data-game="${escapeHtml(config.uiId)}">
                                <span class="secondary-action-icon settings-action-icon"></span>
                                ${escapeHtml(t('detail.clientSettings'))}
                            </button>
                            <div class="detail-stat">
                                <span>${escapeHtml(t('detail.client'))}</span>
                                <strong>${escapeHtml(config.client)}</strong>
                            </div>
                            <div class="detail-stat">
                                <span>${escapeHtml(t('detail.provider'))}</span>
                                <strong>${escapeHtml(config.provider)}</strong>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>
        `).join('');

        host.querySelectorAll('.detail-browse-files-action').forEach(button => {
            button.addEventListener('click', async () => {
                if (typeof window.executeCommand !== 'function') return;
                const backendGame = GameUtils.getGameMapping(button.dataset.game);
                const path = await window.executeCommand('get-game-property', {
                    game: backendGame,
                    suffix: PROPERTY_KEYS.GAME.INSTALL
                });
                if (path) {
                    window.executeCommand('open-folder', { path });
                }
            });
        });

        host.querySelectorAll('.detail-verify-action').forEach(button => {
            button.addEventListener('click', () => {
                if (typeof verifyGame === 'function') {
                    verifyGame(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.detail-settings-action').forEach(button => {
            button.addEventListener('click', () => {
                if (typeof showGameSettings === 'function') {
                    showGameSettings(button.dataset.game);
                }
            });
        });

        host.querySelectorAll('.detail-manage-install-action').forEach(button => {
            button.addEventListener('click', () => {
                if (typeof showManageInstall === 'function') {
                    showManageInstall(button.dataset.game);
                }
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

    function downloadStatusLabel(entry, activePercent) {
        if (entry.paused) {
            if (entry.isActive) {
                return t('downloads.statusPausedAt', { percent: Number(activePercent || 0).toFixed(2) });
            }
            return t('downloads.statusPaused');
        }
        if (entry.isActive) {
            if (entry.op === 'verify') return t('downloads.statusVerifying');
            if (entry.op === 'install') return t('downloads.statusInstalling');
            if (entry.op === 'uninstall') return t('downloads.statusUninstalling');
            return t('downloads.statusActive');
        }
        return t('downloads.statusQueued', { position: entry.queuePosition });
    }

    function renderDownloads() {
        const list = document.getElementById('downloads-list');
        if (!list) return;

        const queue = window.DownloadQueueManager;
        const entries = queue ? queue.getDownloadEntries() : [];

        if (entries.length === 0) {
            list.innerHTML = `<div class="downloads-empty">${escapeHtml(t('downloads.empty'))}</div>`;
            return;
        }

        const activePercent = window.ProgressManager && typeof window.ProgressManager.getProgressPercent === 'function'
            ? window.ProgressManager.getProgressPercent() : 0;
        const activeMessage = window.ProgressManager && typeof window.ProgressManager.getProgressMessage === 'function'
            ? window.ProgressManager.getProgressMessage() : '';

        list.innerHTML = entries.map(entry => {
            const config = GameUtils.getGameConfigByUIId(entry.gameId) || {};
            const displayName = config.displayName || entry.gameId;
            const status = downloadStatusLabel(entry, activePercent);
            const message = entry.isActive && !entry.paused ? (activeMessage || entry.initialMessage || '') : '';
            const percent = entry.isActive ? Math.max(0, Math.min(100, activePercent)) : 0;
            let cls = 'download-row';
            if (entry.paused && entry.isActive) cls += ' active paused';
            else if (entry.paused) cls += ' paused';
            else if (entry.isActive) cls += ' active';
            else cls += ' queued';

            // Active rows keep the bar even when paused (frozen at last percent).
            const showProgress = entry.isActive;
            const progressBlock = showProgress ? `
                <div class="download-progress">
                    <div class="download-progress-bar">
                        <div class="download-progress-fill"></div>
                    </div>
                    <div class="download-progress-meta">
                        <span class="download-progress-message">${escapeHtml(message)}</span>
                        <span class="download-progress-percent">${percent.toFixed(2)}%</span>
                    </div>
                </div>` : '';

            const pauseTitle = entry.paused ? t('downloads.resume') : t('downloads.pause');
            const pauseAction = entry.paused ? 'resume' : 'pause';

            // Active rows put their live status inside the progress bar's message line,
            // so the standalone status row is only useful for queued items.
            const statusRow = entry.isActive ? '' : `<div class="download-row-status">${escapeHtml(status)}</div>`;

            return `
                <div class="${cls}" data-game="${escapeHtml(entry.gameId)}" data-op="${escapeHtml(entry.op)}">
                    <div class="download-row-icon"></div>
                    <div class="download-row-body">
                        <div class="download-row-title">${escapeHtml(displayName)}</div>
                        ${statusRow}
                        ${progressBlock}
                    </div>
                    <button class="download-row-pause" data-game="${escapeHtml(entry.gameId)}" data-op="${escapeHtml(entry.op)}" data-action="${pauseAction}" title="${escapeHtml(pauseTitle)}">
                        <span class="download-row-pause-icon ${entry.paused ? 'is-resume' : ''}"></span>
                    </button>
                    <button class="download-row-cancel" data-game="${escapeHtml(entry.gameId)}" data-op="${escapeHtml(entry.op)}" title="${escapeHtml(t('common.cancel'))}"><span class="control-icon close-icon"></span></button>
                </div>
            `;
        }).join('');

        // Set icon and accent backgrounds via JS to avoid HTML attribute quoting issues.
        list.querySelectorAll('.download-row').forEach(row => {
            const gameId = row.dataset.game;
            const config = GameUtils.getGameConfigByUIId(gameId) || {};
            const accent = config.accent || '#6C63FF';
            const iconPath = config.iconPath || config.capsulePath || '';
            const iconEl = row.querySelector('.download-row-icon');
            if (iconEl) {
                iconEl.style.backgroundColor = accent;
                if (iconPath) {
                    iconEl.style.backgroundImage = `url('${resolveAssetUrl(iconPath)}')`;
                }
            }

            const fill = row.querySelector('.download-progress-fill');
            if (fill) {
                fill.style.width = `${Math.max(0, Math.min(100, activePercent))}%`;
                fill.style.background = accent;
                fill.style.boxShadow = `0 0 12px ${accent}80`;
            }
        });

        list.querySelectorAll('.download-row-cancel').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                if (window.DownloadQueueManager) {
                    window.DownloadQueueManager.cancel(btn.dataset.game, btn.dataset.op);
                }
            });
        });

        list.querySelectorAll('.download-row-pause').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                if (!window.DownloadQueueManager) return;
                if (btn.dataset.action === 'resume') {
                    window.DownloadQueueManager.resume(btn.dataset.game, btn.dataset.op);
                } else {
                    window.DownloadQueueManager.pause(btn.dataset.game, btn.dataset.op);
                }
            });
        });

        list.querySelectorAll('.download-row').forEach(row => {
            row.addEventListener('click', (event) => {
                if (event.target.closest('.download-row-cancel')) return;
                if (event.target.closest('.download-row-pause')) return;
                navigateTo(row.dataset.game);
            });
        });
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
        renderDownloads,
        refreshInstallationStates,
        refreshHomeInstalledClients,
        updateLibraryCard,
        navigateTo,
        updateSidebarRecentGames,
        renderNewsSection
    };
})();
