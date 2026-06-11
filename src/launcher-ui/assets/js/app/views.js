// Rendering helpers for the static launcher shell.

(function() {
    const HOME_HERO_SLIDE_INTERVAL = 6500;

    let homeHeroStates = [];
    let homeHeroSlideIndex = 0;
    let homeHeroTimer = null;
    let homeHeroPaused = false;
    let homeHeroControlsBound = false;
    let pinnedGameIds = [];
    let pinnedGamesLoaded = false;
    let latestInstallationStates = [];

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

    function isGameBusy(gameId) {
        const q = window.DownloadQueueManager;
        return !!(q && typeof q.isBusy === 'function' && q.isBusy(gameId));
    }

    function busyKindFor(gameId) {
        const q = window.DownloadQueueManager;
        if (!q || typeof q.isBusy !== 'function' || !q.isBusy(gameId)) return null;
        if (q.active && q.active.gameId === gameId && q.active.blocksGameButtons) return 'active';
        return 'queued';
    }

    function activeOpFor(gameId) {
        const q = window.DownloadQueueManager;
        if (!q || !q.active || q.active.gameId !== gameId || !q.active.blocksGameButtons) return null;
        return q.active.op || 'install';
    }

    function busyOpLabel(op) {
        if (op === 'verify') return t('common.verifying');
        if (op === 'uninstall') return t('common.uninstalling');
        return t('common.installing');
    }

    function isGameRunning(gameId) {
        const gsm = window.GameStateManager;
        if (!gsm) return false;
        if (gsm.runningGameId === gameId) return true;
        const state = gsm.gameStates && gsm.gameStates[gameId];
        return !!(state && state.isRunning);
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

    function clientCardHTML(config, { smallText = null, status = null } = {}) {
        const small = smallText == null ? config.client : smallText;
        const busyKind = busyKindFor(config.uiId);
        const running = !busyKind && isGameRunning(config.uiId);
        const stateCls = `${busyKind ? ' is-installing' : ''}${running ? ' is-running' : ''}`;
        const cls = status
            ? `client-card has-overlay status-${escapeHtml(status)}${stateCls}`
            : `client-card${stateCls}`;
        const statusAttr = status ? ` data-status="${escapeHtml(status)}"` : '';
        const overlay = status
            ? `<div class="client-card-play"><button type="button" class="library-install-btn">${escapeHtml(homeActionLabel(status, busyKind, config.uiId))}</button></div>`
            : '';
        return `
            <article class="${cls}" data-game="${escapeHtml(config.uiId)}"${statusAttr}>
                <img class="client-card-art" src="${escapeHtml(config.capsulePath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                ${overlay}
                <div class="client-card-label">
                    <span>${escapeHtml(config.displayName)}</span>
                    <small>${escapeHtml(small)}</small>
                </div>
            </article>
        `;
    }

    function renderHomeClientCards(targetId, configs) {
        const clients = document.getElementById(targetId);
        if (!clients) return;

        if (targetId === 'home-ready-row') {
            const section = document.getElementById('home-ready-section');
            if (section) section.style.display = configs.length ? '' : 'none';
        }

        clients.innerHTML = configs.map(config => clientCardHTML(config, { status: 'installed' })).join('');

        clients.querySelectorAll('.client-card').forEach(card => {
            bindClientCardClick(card);
            bindCardContextMenu(card);
        });
    }

    function bindClientCardClick(card) {
        card.addEventListener('click', () => {
            if (isGameBusy(card.dataset.game)) return;
            runGameAction(card.dataset.game, card.dataset.status);
        });
    }

    function homeActionLabel(status, busyKind, gameId) {
        if (busyKind === 'queued') return t('common.queued');
        if (busyKind === 'active') return busyOpLabel(activeOpFor(gameId));
        if (isGameRunning(gameId)) return t('common.stop');
        if (status === 'installed') return t('common.play');
        if (status === 'partial') return t('common.finishSetup');
        return t('common.install');
    }

    function runGameAction(gameId, status) {
        if (GameUtils.isComingSoon(gameId)) return;
        if (isGameBusy(gameId)) return;
        if (isGameRunning(gameId)) {
            if (typeof stopGame === 'function') stopGame(gameId);
            return;
        }
        if (status === 'installed' && typeof launchGame === 'function') {
            launchGame(gameId);
        } else if (typeof showSetupFlow === 'function') {
            showSetupFlow(gameId);
        } else {
            navigateTo(gameId);
        }
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
            if (config.comingSoon) {
                cta.classList.remove('is-installing', 'is-running');
                cta.classList.add('setup-button', 'is-coming-soon');
                cta.innerHTML = escapeHtml(t('common.comingSoon'));
                cta.onclick = (event) => event.stopPropagation();
                return;
            }
            cta.classList.remove('is-coming-soon');
            const busyKind = busyKindFor(config.uiId);
            const running = !busyKind && isGameRunning(config.uiId);
            const label = homeActionLabel(normalizedStatus, busyKind, config.uiId);
            cta.classList.toggle('setup-button', !isInstalled);
            cta.classList.toggle('is-installing', !!busyKind);
            cta.classList.toggle('is-running', running);
            cta.innerHTML = (isInstalled && !busyKind && !running)
                ? `<span class="play-icon"></span>${escapeHtml(label)}`
                : escapeHtml(label);
            cta.onclick = (event) => {
                event.stopPropagation();
                if (isGameBusy(config.uiId)) return;
                runGameAction(config.uiId, normalizedStatus);
            };
        }
    }

    function setHomeHeroSlide(index) {
        if (!homeHeroStates.length) return;

        homeHeroSlideIndex = ((index % homeHeroStates.length) + homeHeroStates.length) % homeHeroStates.length;
        const slide = homeHeroStates[homeHeroSlideIndex];
        renderHomeHero(slide.config, slide.status);
        updateHomeHeroDots();
    }

    function renderHomeHeroDots() {
        const dots = document.getElementById('hub-hero-dots');
        if (!dots) return;

        if (homeHeroStates.length <= 1) {
            dots.innerHTML = '';
            dots.style.display = 'none';
            return;
        }

        dots.style.display = '';
        dots.innerHTML = homeHeroStates.map((_, i) =>
            `<button type="button" class="hub-hero-dot" role="tab" data-idx="${i}" aria-label="Slide ${i + 1}"></button>`
        ).join('');
        updateHomeHeroDots();

        dots.querySelectorAll('.hub-hero-dot').forEach(dot => {
            dot.addEventListener('click', (event) => {
                event.stopPropagation();
                setHomeHeroSlide(parseInt(dot.dataset.idx, 10));
                startHomeHeroSlider();
            });
        });
    }

    function updateHomeHeroDots() {
        const dots = document.getElementById('hub-hero-dots');
        if (!dots) return;
        dots.querySelectorAll('.hub-hero-dot').forEach((dot, i) => {
            dot.classList.toggle('is-active', i === homeHeroSlideIndex);
        });
    }

    function startHomeHeroSlider() {
        if (homeHeroTimer) {
            clearInterval(homeHeroTimer);
            homeHeroTimer = null;
        }

        if (homeHeroStates.length <= 1) return;

        homeHeroTimer = setInterval(() => {
            if (homeHeroPaused) return;
            const homePage = document.getElementById('home-page');
            if (homePage && homePage.style.display === 'none') return;

            setHomeHeroSlide(homeHeroSlideIndex + 1);
        }, HOME_HERO_SLIDE_INTERVAL);
    }

    function bindHomeHeroControls() {
        if (homeHeroControlsBound) return;
        const hero = document.getElementById('hub-hero');
        const prev = document.getElementById('hub-hero-prev');
        const next = document.getElementById('hub-hero-next');
        if (!hero || !prev || !next) return;

        const stepBy = (delta) => {
            if (!homeHeroStates.length) return;
            setHomeHeroSlide(homeHeroSlideIndex + delta);
            startHomeHeroSlider();
        };

        prev.addEventListener('click', (event) => { event.stopPropagation(); stepBy(-1); });
        next.addEventListener('click', (event) => { event.stopPropagation(); stepBy(1); });

        hero.addEventListener('mouseenter', () => { homeHeroPaused = true; });
        hero.addEventListener('mouseleave', () => { homeHeroPaused = false; });

        homeHeroControlsBound = true;
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

        renderHomeHeroDots();
        setHomeHeroSlide(homeHeroSlideIndex);
        startHomeHeroSlider();
        bindHomeHeroControls();
    }

    function renderHomeFromStates(states) {
        const safeStates = Array.isArray(states) ? states : [];
        latestInstallationStates = safeStates;

        renderHomeClientCards('home-ready-row', safeStates
            .filter(({ config, status }) => config && status === 'installed')
            .map(({ config }) => config));

        renderHomePinnedRow();
        setHomeHeroStates(safeStates);
    }

    async function loadPinnedGames() {
        if (pinnedGamesLoaded) return pinnedGameIds;
        pinnedGamesLoaded = true;
        if (typeof window.executeCommand !== 'function') return pinnedGameIds;

        try {
            const raw = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.PINNED_GAMES);
            if (typeof raw === 'string' && raw.trim()) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    pinnedGameIds = parsed.filter(id => GameUtils.getGameConfigByUIId(id));
                }
            }
        } catch (error) {
            console.warn('Failed to load pinned games:', error);
        }
        return pinnedGameIds;
    }

    async function savePinnedGames() {
        if (typeof window.executeCommand !== 'function') return;
        try {
            await window.executeCommand('set-property', {
                [PROPERTY_KEYS.LAUNCHER.PINNED_GAMES]: JSON.stringify(pinnedGameIds)
            });
        } catch (error) {
            console.error('Failed to save pinned games:', error);
        }
    }

    function isPinned(gameId) {
        return pinnedGameIds.includes(gameId);
    }

    async function togglePin(gameId) {
        if (!GameUtils.getGameConfigByUIId(gameId)) return;

        if (isPinned(gameId)) {
            pinnedGameIds = pinnedGameIds.filter(id => id !== gameId);
        } else {
            pinnedGameIds = [...pinnedGameIds, gameId];
        }

        await savePinnedGames();
        renderHomePinnedRow();
    }

    function renderHomePinnedRow() {
        const section = document.getElementById('home-pinned-section');
        const row = document.getElementById('home-pinned-row');
        if (!section || !row) return;

        const configs = pinnedGameIds
            .map(id => GameUtils.getGameConfigByUIId(id))
            .filter(Boolean);

        section.style.display = configs.length ? '' : 'none';
        if (!configs.length) {
            row.innerHTML = '';
            return;
        }

        const statusById = new Map(latestInstallationStates.map(s => [s.gameId, s.status]));

        row.innerHTML = configs.map(config => {
            const status = statusById.get(config.uiId) || 'not-setup';
            return clientCardHTML(config, { status });
        }).join('');

        row.querySelectorAll('.client-card').forEach(card => {
            bindClientCardClick(card);
            bindCardContextMenu(card);
        });
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

    let installedGameIds = new Set();

    function updateSidebarMyGames(recentIds) {
        const list = document.querySelector('.sidebar .game-list');
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.game-item'));

        const orderIndex = new Map(GameUtils.GAME_ORDER.map((id, i) => [id, i]));
        const recencyIndex = new Map((recentIds || []).map((id, i) => [id, i]));

        const installedItems = items.filter(it => installedGameIds.has(it.dataset.game || it.id));
        installedItems.sort((a, b) => {
            const ai = recencyIndex.has(a.dataset.game) ? recencyIndex.get(a.dataset.game) : Infinity;
            const bi = recencyIndex.has(b.dataset.game) ? recencyIndex.get(b.dataset.game) : Infinity;
            if (ai !== bi) return ai - bi;
            const ao = orderIndex.has(a.dataset.game) ? orderIndex.get(a.dataset.game) : 99;
            const bo = orderIndex.has(b.dataset.game) ? orderIndex.get(b.dataset.game) : 99;
            return ao - bo;
        });

        items.forEach(it => { it.style.display = 'none'; });

        installedItems.forEach(it => {
            it.style.display = '';
            list.appendChild(it);
        });
    }

    function renderHome() {
        const featured = GameUtils.getFeaturedGame();
        if (!featured) return;

        renderHomeHero(featured, 'not-setup');
        renderHomeClientCards('home-ready-row', []);

        const openLibrary = document.getElementById('home-view-library');
        if (openLibrary) openLibrary.onclick = () => navigateTo('library');

        setHomeHeroStates(GameUtils.getAllGameConfigs().map(config => ({
            config,
            status: 'not-setup'
        })));

        loadPinnedGames().then(() => renderHomePinnedRow());
    }

    function renderSidebarGames() {
        document.querySelectorAll('.sidebar .game-item').forEach(item => {
            const gameId = item.dataset.game || item.id;
            const config = GameUtils.getGameConfigByUIId(gameId);
            if (!config) return;

            item.style.setProperty('--game-accent', config.accent || '#8AA4FF');
            item.classList.toggle('is-coming-soon', !!config.comingSoon);
            item.innerHTML = `
                <div class="game-item-thumb">
                    <img src="${escapeHtml(config.iconPath || config.capsulePath || config.logoPath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                </div>
                <div class="game-item-copy">
                    <span class="game-item-title">${escapeHtml(config.displayName)}</span>
                    <small class="game-item-sub">${escapeHtml(config.codeName)}</small>
                </div>
                ${config.comingSoon ? `<span class="game-item-soon-chip">${escapeHtml(t('common.comingSoon'))}</span>` : ''}
            `;
            item.setAttribute('title', config.displayName);
            item.setAttribute('aria-label', config.displayName);
            bindCardContextMenu(item);
        });
    }

    let cardMenuEl = null;

    function ensureCardMenu() {
        if (cardMenuEl) return cardMenuEl;
        cardMenuEl = document.createElement('div');
        cardMenuEl.className = 'library-card-menu';
        cardMenuEl.setAttribute('role', 'menu');
        cardMenuEl.hidden = true;
        document.body.appendChild(cardMenuEl);

        document.addEventListener('mousedown', (event) => {
            if (cardMenuEl.hidden) return;
            if (!cardMenuEl.contains(event.target)) hideCardContextMenu();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') hideCardContextMenu();
        });
        document.addEventListener('scroll', hideCardContextMenu, true);
        window.addEventListener('blur', hideCardContextMenu);
        window.addEventListener('resize', hideCardContextMenu);
        return cardMenuEl;
    }

    function hideCardContextMenu() {
        if (cardMenuEl && !cardMenuEl.hidden) {
            cardMenuEl.hidden = true;
            cardMenuEl.innerHTML = '';
        }
    }

    function callGlobal(fnName, ...args) {
        const fn = window[fnName];
        if (typeof fn === 'function') {
            fn(...args);
        } else {
            console.warn(`Library context menu: ${fnName} unavailable`);
        }
    }

    async function openInstallFolder(gameId) {
        if (typeof window.executeCommand !== 'function') return;
        if (GameUtils.isComingSoon(gameId)) return;
        try {
            const backendGame = GameUtils.getGameMapping(gameId);
            const path = await window.executeCommand('get-game-property', {
                game: backendGame,
                suffix: PROPERTY_KEYS.GAME.INSTALL
            });
            if (path) {
                await window.executeCommand('open-folder', { path });
            }
        } catch (error) {
            console.error('Open install folder failed:', error);
        }
    }

    function buildCardMenuItems(card) {
        const gameId = card.dataset.game;
        if (GameUtils.isComingSoon(gameId)) {
            return [
                { label: t('common.comingSoon'), disabled: true },
                { separator: true },
                {
                    label: isPinned(gameId) ? t('common.unpinFromHome') : t('common.pinToHome'),
                    action: () => togglePin(gameId)
                },
                { label: t('common.gameDetails'), action: () => navigateTo(gameId) }
            ];
        }
        const status = card.dataset.status || 'not-setup';
        const isInstalled = status === 'installed';
        const isPartial = status === 'partial';
        const isBusy = isGameBusy(gameId);
        const items = [];

        if (isInstalled) {
            items.push({ label: t('common.play'), action: () => callGlobal('launchGame', gameId), disabled: isBusy });
        } else if (isPartial) {
            items.push({ label: t('common.finishSetup'), action: () => callGlobal('showSetupFlow', gameId), disabled: isBusy });
        } else {
            items.push({ label: t('common.install'), action: () => callGlobal('showSetupFlow', gameId), disabled: isBusy });
        }

        if (isInstalled || isPartial) {
            items.push({ label: t('common.browseLocalFiles'), action: () => openInstallFolder(gameId) });
            if (isInstalled) {
                items.push({ label: t('common.verify'), action: () => callGlobal('verifyGame', gameId), hidden: isBusy });
            }
            items.push({ label: t('common.manageInstall'), action: () => callGlobal('showManageInstall', gameId), hidden: isBusy });
            items.push({ label: t('nav.settings'), action: () => callGlobal('showGameSettings', gameId), hidden: isBusy });
            items.push({ separator: true });
            items.push({ label: t('common.uninstall'), action: () => callGlobal('uninstallGameDirect', gameId), danger: true, disabled: isBusy });
        }

        items.push({ separator: true });
        items.push({
            label: isPinned(gameId) ? t('common.unpinFromHome') : t('common.pinToHome'),
            action: () => togglePin(gameId)
        });
        items.push({ label: t('common.gameDetails'), action: () => navigateTo(gameId) });
        return items;
    }

    function collapseSeparators(items) {
        const out = [];
        for (const it of items) {
            if (it.separator) {
                if (out.length === 0) continue;
                if (out[out.length - 1].separator) continue;
                out.push(it);
            } else {
                out.push(it);
            }
        }
        while (out.length && out[out.length - 1].separator) out.pop();
        return out;
    }

    function showCardContextMenu(card, x, y) {
        const menu = ensureCardMenu();
        const items = collapseSeparators(buildCardMenuItems(card).filter(i => !i.hidden));
        menu.innerHTML = items.map((item, idx) => {
            if (item.separator) {
                return '<div class="library-card-menu-separator" role="separator"></div>';
            }
            const danger = item.danger ? ' is-danger' : '';
            const dis = item.disabled ? ' is-disabled' : '';
            const disAttrs = item.disabled ? ' aria-disabled="true" disabled' : '';
            return `<button type="button" class="library-card-menu-item${danger}${dis}" role="menuitem"${disAttrs} data-idx="${idx}">${escapeHtml(item.label)}</button>`;
        }).join('');

        menu.style.left = '0px';
        menu.style.top = '0px';
        menu.hidden = false;

        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const left = Math.max(8, Math.min(x, vw - rect.width - 8));
        const top = Math.max(8, Math.min(y, vh - rect.height - 8));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        menu.querySelectorAll('.library-card-menu-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = items[parseInt(btn.dataset.idx, 10)];
                if (!item || item.disabled) return;
                hideCardContextMenu();
                try { item.action(); } catch (error) { console.error('Context menu action failed:', error); }
            });
        });
    }

    function bindCardContextMenu(card) {
        card.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            showCardContextMenu(card, event.clientX, event.clientY);
        });
    }

    function renderLibrary() {
        const grid = document.getElementById('library-grid');
        if (!grid) return;

        grid.innerHTML = GameUtils.getAllGameConfigs().map(config => {
            const comingSoon = !!config.comingSoon;
            const cardCls = `library-card${comingSoon ? ' is-coming-soon' : ''}`;
            const buttonHtml = comingSoon
                ? `<button class="library-install-btn is-coming-soon" disabled title="${escapeHtml(t('library.comingSoonHint'))}">
                       <span data-action-label>${escapeHtml(t('common.comingSoon'))}</span>
                   </button>`
                : `<button class="library-install-btn" data-action="setup">
                       <span class="progress-ring"></span>
                       <span data-action-label>${escapeHtml(t('common.install'))}</span>
                   </button>`;
            return `
            <article class="${cardCls}" data-game="${escapeHtml(config.uiId)}" data-client="${escapeHtml(config.clientKey)}" data-status="not-setup" data-search="${escapeHtml(`${config.displayName} ${config.codeName} ${config.client}`.toLowerCase())}">
                <img class="library-card-art" src="${escapeHtml(config.capsulePath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                ${comingSoon ? `<span class="library-card-soon-badge">${escapeHtml(t('common.comingSoon'))}</span>` : ''}
                <span class="library-card-player-pill" data-player-badge hidden>
                    <span class="library-card-player-dot"></span>
                    <span data-player-count>0</span>
                </span>
                <span class="library-card-size-pill" data-size-badge hidden></span>
                <div class="library-card-progress" aria-hidden="true">
                    <span></span>
                </div>
                <div class="library-card-body">
                    <div class="library-card-title">${escapeHtml(config.displayName)}</div>
                    <div class="library-card-meta">
                        <span class="badge client">${escapeHtml(config.client)}</span>
                    </div>
                    ${buttonHtml}
                </div>
            </article>
        `;
        }).join('');

        grid.querySelectorAll('.library-card').forEach(card => {
            card.addEventListener('click', () => navigateTo(card.dataset.game));
            bindCardContextMenu(card);

            const button = card.querySelector('.library-install-btn');
            if (!button) return;
            if (button.disabled) {
                button.addEventListener('click', (event) => event.stopPropagation());
                return;
            }
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                if (isGameBusy(card.dataset.game)) return;
                runGameAction(card.dataset.game, card.dataset.status);
            });
        });

        if (window.PlayerCountManager) {
            window.PlayerCountManager.applyToVisibleCards();
        }

        bindLibraryControls();
    }

    function updateLibraryCardPlayerCount(gameId, count) {
        const card = document.querySelector(`.library-card[data-game="${gameId}"]`);
        if (!card) return;
        const pill = card.querySelector('[data-player-badge]');
        const label = card.querySelector('[data-player-count]');
        if (!pill || !label) return;
        const safe = typeof count === 'number' && count > 0 ? count : 0;
        if (safe > 0) {
            label.textContent = safe.toLocaleString();
            pill.hidden = false;
        } else {
            pill.hidden = true;
        }
    }

    function updateGamePagePlayerCount(gameId, count) {
        const page = document.getElementById(`${gameId}-page`);
        if (!page) return;
        const pill = page.querySelector('[data-game-player-badge]');
        if (!pill) return;
        const safe = typeof count === 'number' && count > 0 ? count : 0;
        if (safe > 0) {
            pill.textContent = safe.toLocaleString();
            pill.hidden = false;
        } else {
            pill.hidden = true;
        }
    }

    function updateGamePageInstallSize(gameId, bytes) {
        const page = document.getElementById(`${gameId}-page`);
        if (!page) return;
        const pill = page.querySelector('[data-game-size-badge]');
        if (!pill) return;
        if (typeof bytes === 'number' && bytes > 0) {
            pill.textContent = GameUtils.formatBytes(bytes);
            pill.hidden = false;
        } else {
            pill.hidden = true;
            pill.textContent = '';
        }
    }

    const KNOWN_CLIENT_FILTERS = ['plutonium', 'alterware', 'aurora'];

    function cardMatchesFilter(card, filter) {
        const status = card.dataset.status;
        const client = card.dataset.client;
        if (filter === 'all') return true;
        if (filter === 'installed') return status === 'installed';
        if (filter === 'not-installed') return status !== 'installed';
        if (filter === 'others') return !KNOWN_CLIENT_FILTERS.includes(client);
        return filter === client;
    }

    function bindLibraryControls() {
        const filters = document.getElementById('library-filters');
        const search = document.getElementById('library-search');
        const searchClear = document.getElementById('library-search-clear');

        function applyFilters() {
            const active = filters ? filters.querySelector('.chip.active') : null;
            const filter = active ? active.dataset.filter : 'all';
            const term = search ? search.value.trim().toLowerCase() : '';
            const cards = document.querySelectorAll('.library-card:not(.library-card-empty)');
            let visibleCount = 0;

            cards.forEach(card => {
                const matchesSearch = !term || card.dataset.search.includes(term);
                const isVisible = cardMatchesFilter(card, filter) && matchesSearch;
                card.style.display = isVisible ? '' : 'none';
                if (isVisible) visibleCount += 1;
            });

            if (filters) {
                filters.querySelectorAll('.chip').forEach(chip => {
                    const count = Array.from(cards).filter(card => cardMatchesFilter(card, chip.dataset.filter)).length;
                    const key = chip.dataset.i18n;
                    chip.textContent = key ? `${t(key)} (${count})` : chip.textContent;
                });
            }

            if (searchClear) searchClear.hidden = !term;

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

        if (searchClear && !searchClear.dataset.bound) {
            searchClear.dataset.bound = 'true';
            searchClear.addEventListener('click', () => {
                if (!search) return;
                search.value = '';
                applyFilters();
                search.focus();
            });
        }

        applyFilters();
    }

    const sizeBadgeFetched = new Set();

    function waitForComponentDetection(backendId, timeoutMs = 30000) {
        return new Promise(resolve => {
            const start = Date.now();
            const poll = setInterval(async () => {
                if (Date.now() - start > timeoutMs) {
                    clearInterval(poll);
                    resolve();
                    return;
                }
                try {
                    const status = await window.executeCommand('get-component-detection-status', { game: backendId });
                    if (!status || !status.active) {
                        clearInterval(poll);
                        resolve();
                    }
                } catch (e) {
                    clearInterval(poll);
                    resolve();
                }
            }, 300);
        });
    }

    async function getDetectedComponentInfo(backendId) {
        const info = await window.executeCommand('get-game-component-info', { game: backendId, detectExisting: true });
        if (!info || !info.detectionInProgress) return info;
        await waitForComponentDetection(backendId);
        return window.executeCommand('get-game-component-info', { game: backendId, detectExisting: true });
    }

    async function fetchLibraryCardSize(card, gameId) {
        try {
            const info = await getDetectedComponentInfo(GameUtils.getGameMapping(gameId));
            if (!info) return;
            const installed = info.installed || [];
            const sizes = info.sizes || {};
            const total = installed.reduce((sum, id) => sum + (sizes[id] || 0), 0);
            if (total <= 0) return;
            const sizeEl = card.querySelector('[data-size-badge]');
            if (sizeEl) {
                sizeEl.textContent = GameUtils.formatBytes(total);
                sizeEl.hidden = false;
            }
            updateGamePageInstallSize(gameId, total);
        } catch (error) {
            console.warn(`Failed to fetch install size for ${gameId}:`, error);
        }
    }

    function updateLibraryCard(gameId, status) {
        const card = document.querySelector(`.library-card[data-game="${gameId}"]`);
        const config = GameUtils.getGameConfigByUIId(gameId);
        if (!card || !config) return;

        const normalizedStatus = status || 'not-setup';
        const action = card.querySelector('[data-action-label]');
        const sizeBadge = card.querySelector('[data-size-badge]');

        if (card.dataset.status !== normalizedStatus) sizeBadgeFetched.delete(gameId);
        card.dataset.status = normalizedStatus;
        card.classList.toggle('is-installed', normalizedStatus === 'installed');
        card.classList.toggle('is-partial', normalizedStatus === 'partial');
        const busyKind = busyKindFor(gameId);
        card.classList.toggle('is-installing', !!busyKind);
        card.classList.toggle('is-running', !busyKind && isGameRunning(gameId));

        if (action) {
            action.textContent = homeActionLabel(normalizedStatus, busyKind, gameId);
        }

        if (normalizedStatus === 'installed' || normalizedStatus === 'partial') {
            if (!sizeBadgeFetched.has(gameId)) {
                sizeBadgeFetched.add(gameId);
                fetchLibraryCardSize(card, gameId);
            }
        } else {
            sizeBadgeFetched.delete(gameId);
            if (sizeBadge) {
                sizeBadge.hidden = true;
                sizeBadge.textContent = '';
            }
            updateGamePageInstallSize(gameId, 0);
        }
    }

    async function refreshInstallationStates(checker) {
        const states = await getInstallationStates(checker);

        installedGameIds = new Set(states
            .filter(s => s.status === 'installed')
            .map(s => s.gameId));

        states.forEach(({ gameId, status }) => {
            updateLibraryCard(gameId, status);
            const sidebarItem = document.querySelector(`.sidebar .game-item[data-game="${gameId}"]`);
            if (sidebarItem) sidebarItem.dataset.status = status || 'not-setup';
        });

        renderHomeFromStates(states);

        bindLibraryControls();

        updateSidebarMyGames(window.__recentGamesSnapshot || []);
    }

    async function refreshHomeInstalledClients(checker) {
        const states = await getInstallationStates(checker);

        renderHomeFromStates(states);
    }

    function renderGamePages() {
        const host = document.getElementById('game-pages');
        if (!host) return;

        host.innerHTML = GameUtils.getAllGameConfigs().map(config => {
            const comingSoon = !!config.comingSoon;
            const pageCls = `page-section game-page${comingSoon ? ' is-coming-soon' : ''}`;
            const credits = gameCredits(config);
            const hasCredits = credits && String(credits).trim().length > 0;
            const hasProvider = config.provider && String(config.provider).trim().length > 0;

            const descriptionSection = `
                        <section class="description">
                            <strong>${escapeHtml(config.displayName)}</strong>
                            <p>${escapeHtml(gameDescription(config))}</p>
                            ${gameDescriptionNote(config) ? `<p>${gameDescriptionNote(config)}</p>` : ''}
                            ${hasCredits ? `<br><strong>${escapeHtml(t('detail.credits'))}</strong><p>${credits}</p>` : ''}
                            ${hasProvider ? `<br><strong>${escapeHtml(t('detail.note'))}</strong><p>${t('detail.noteBody', { provider: escapeHtml(config.provider) })}</p>` : ''}
                        </section>`;

            const actionsAside = comingSoon
                ? `<aside class="detail-actions-panel is-coming-soon">
                        <div class="detail-coming-soon-chip">${escapeHtml(t('common.comingSoon'))}</div>
                        <p class="detail-coming-soon-note">${escapeHtml(t('library.comingSoonHint'))}</p>
                    </aside>`
                : `<aside class="detail-actions-panel">
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
                    </aside>`;

            return `
            <div class="${pageCls}" id="${escapeHtml(config.uiId)}-page" style="display: none;">
                <div class="hero-section ${escapeHtml(config.uiId)}" style="--hero-image: ${cssUrl(config.heroImagePath)}">
                    <div class="hero-bottom-content">
                        <img class="game-logo-img" src="${escapeHtml(config.logoPath)}" alt="${escapeHtml(config.displayName)}">
                        <div class="game-meta-row">
                            <span class="game-meta-player" data-game-player-badge hidden>0</span>
                            <span>${escapeHtml(config.codeName)}</span>
                            <span class="game-meta-size" data-game-size-badge hidden></span>
                        </div>
                    </div>
                </div>

                <div class="game-details">
                    <div class="button-group" id="${escapeHtml(config.uiId)}-button-group"></div>

                    <div class="detail-panel-grid">
                        ${descriptionSection}
                        ${actionsAside}
                    </div>
                </div>
            </div>
        `;
        }).join('');

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

        const allConfigs = GameUtils.getAllGameConfigs();
        const playableConfigs = allConfigs.filter(c => !c.comingSoon);
        const installPaths = {};

        if (typeof window.executeCommand === 'function') {
            await Promise.all(playableConfigs.map(async config => {
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

        list.innerHTML = playableConfigs.map(config => `
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

            // Pause/resume is only meaningful for the active download — queued rows can't be paused.
            const pauseButton = entry.isActive ? `
                <button class="download-row-pause" data-game="${escapeHtml(entry.gameId)}" data-op="${escapeHtml(entry.op)}" data-action="${pauseAction}" title="${escapeHtml(pauseTitle)}">
                    <span class="download-row-pause-icon ${entry.paused ? 'is-resume' : ''}"></span>
                </button>` : '';

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
                    ${pauseButton}
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

    // Live state fed by the Discord Social SDK bridge (polled by discord-friends.js).
    const friendsState = { status: 'unknown', profile: null, friends: [], registryOk: true, error: null };

    async function refreshFriends() {
        try {
            const statusRes = await window.executeCommand('discord-get-status');
            friendsState.status = (statusRes && statusRes.status) || 'unavailable';
            friendsState.profile = (statusRes && statusRes.profile) || null;
            friendsState.error = (statusRes && statusRes.error) || null;

            if (friendsState.status === 'linked') {
                const friendsRes = await window.executeCommand('discord-get-friends');
                friendsState.friends = (friendsRes && friendsRes.friends) || [];
                friendsState.registryOk = !friendsRes || friendsRes.registryOk !== false;
            } else {
                friendsState.friends = [];
                friendsState.registryOk = true;
            }
        } catch (error) {
            console.warn('Failed to refresh Discord friends:', error);
        }
        renderFriends();
    }

    function getFriendsState() {
        return friendsState;
    }

    function friendStatusLabel(status) {
        if (status === 'online') return t('friends.statusOnline');
        if (status === 'idle')   return t('friends.statusIdle');
        return t('friends.statusOffline');
    }

    function friendInitials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        const first = parts[0] ? parts[0][0] : '?';
        const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + second).toUpperCase();
    }

    function friendAvatar(f) {
        const dot = `<span class="friend-status-dot" data-status="${escapeHtml(f.status)}"></span>`;
        if (f.avatarUrl) {
            return `
                <div class="friend-avatar">
                    <img class="friend-avatar-img" src="${escapeHtml(f.avatarUrl)}" alt="" loading="lazy" />
                    ${dot}
                </div>
            `;
        }
        return `
            <div class="friend-avatar">
                <span class="friend-avatar-initials">${escapeHtml(friendInitials(f.displayName))}</span>
                ${dot}
            </div>
        `;
    }

    function renderFriends() {
        const list = document.getElementById('friends-list');
        const empty = document.getElementById('friends-empty');
        const cta = document.getElementById('friends-link-cta');
        const notice = document.getElementById('friends-notice');
        if (!list) return;

        const status = friendsState.status;
        const showCta = status === 'unlinked' || status === 'unavailable' || status === 'error';

        if (cta) {
            cta.style.display = showCta ? '' : 'none';
            const btn = document.getElementById('friends-link-btn');
            if (btn) btn.disabled = status === 'unavailable';
        }

        if (notice) {
            if (status === 'linking' || status === 'connecting') {
                notice.textContent = t('friends.linking');
                notice.style.display = '';
            } else if (status === 'linked' && !friendsState.registryOk) {
                notice.textContent = t('friends.degraded');
                notice.style.display = '';
            } else {
                notice.style.display = 'none';
            }
        }

        if (status !== 'linked') {
            list.innerHTML = '';
            if (empty) empty.style.display = 'none';
            return;
        }

        const friends = friendsState.friends;
        if (friends.length === 0) {
            list.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        const online  = friends.filter(f => f.status === 'online' || f.status === 'idle');
        const offline = friends.filter(f => f.status !== 'online' && f.status !== 'idle');

        const header = online.length === 0 ? '' : `
            <div class="friends-group-head">${escapeHtml(t('friends.statusOnline'))} <span class="friends-group-count">${online.length}</span></div>
        `;
        const rows = online.concat(offline).map(f => `
            <div class="friend-row" data-status="${escapeHtml(f.status)}">
                ${friendAvatar(f)}
                <div class="friend-row-body">
                    <div class="friend-name">${escapeHtml(f.displayName)}</div>
                    <div class="friend-activity">${escapeHtml(f.inLauncher ? t('friends.inLauncher') : friendStatusLabel(f.status))}</div>
                </div>
            </div>
        `).join('');

        list.innerHTML = header + rows;
    }

    function renderAll() {
        renderSidebarGames();
        renderHome();
        renderLibrary();
        renderGamePages();
        renderSettingsDirectories();
    }

    function applyDownloadQueueInstallingState() {
        document.querySelectorAll('.library-card').forEach(card => {
            const gameId = card.dataset.game;
            if (!gameId) return;
            const busyKind = busyKindFor(gameId);
            const running = !busyKind && isGameRunning(gameId);
            card.classList.toggle('is-installing', !!busyKind);
            card.classList.toggle('is-running', running);
            const action = card.querySelector('[data-action-label]');
            if (!action) return;
            const status = card.dataset.status || 'not-setup';
            action.textContent = homeActionLabel(status, busyKind, gameId);
        });

        document.querySelectorAll('.client-card').forEach(card => {
            const gameId = card.dataset.game;
            if (!gameId) return;
            const busyKind = busyKindFor(gameId);
            const running = !busyKind && isGameRunning(gameId);
            card.classList.toggle('is-installing', !!busyKind);
            card.classList.toggle('is-running', running);
            const btn = card.querySelector('.client-card-play .library-install-btn');
            if (!btn) return;
            const status = card.dataset.status || 'not-setup';
            btn.textContent = homeActionLabel(status, busyKind, gameId);
        });

        const cta = document.getElementById('hub-hero-play');
        const hero = document.getElementById('hub-hero');
        if (cta && hero) {
            const gameId = hero.dataset.game;
            if (gameId) {
                const busyKind = busyKindFor(gameId);
                const running = !busyKind && isGameRunning(gameId);
                const slide = homeHeroStates[homeHeroSlideIndex];
                const status = (slide && slide.status) || 'not-setup';
                const isInstalled = status === 'installed';
                cta.classList.toggle('is-installing', !!busyKind);
                cta.classList.toggle('is-running', running);
                const label = homeActionLabel(status, busyKind, gameId);
                cta.innerHTML = (isInstalled && !busyKind && !running)
                    ? `<span class="play-icon"></span>${escapeHtml(label)}`
                    : escapeHtml(label);
            }
        }
    }

    window.AppViews = {
        renderAll,
        renderSidebarGames,
        renderHome,
        renderLibrary,
        renderGamePages,
        renderSettingsDirectories,
        renderDownloads,
        renderFriends,
        refreshFriends,
        getFriendsState,
        refreshInstallationStates,
        refreshHomeInstalledClients,
        updateLibraryCard,
        updateLibraryCardPlayerCount,
        updateGamePagePlayerCount,
        updateGamePageInstallSize,
        navigateTo,
        updateSidebarMyGames,
        applyDownloadQueueInstallingState,
        refreshActionButtons: applyDownloadQueueInstallingState
    };
})();
