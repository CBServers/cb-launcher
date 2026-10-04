// Sidebar pages that host a per-game view (Servers, Mods): a game grid first, then one game at a
// time with a switcher. The open game is kept for the session only, like a Community room, so a
// launcher restart starts on the grid.
(function () {
    'use strict';

    const escapeHtml = value => GameUtils.escapeHtml(value);

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function gameName(id) {
        const config = GameUtils.getGameConfigByUIId(id);
        return config ? config.displayName : id;
    }

    function busyKindFor(id) {
        const q = window.DownloadQueueManager;
        if (!q || typeof q.isBusy !== 'function' || !q.isBusy(id)) return null;
        return (q.active && q.active.gameId === id && q.active.blocksGameButtons) ? 'active' : 'queued';
    }

    function create(opts) {
        const statuses = {};
        let current = null;

        const pageEl = () => document.getElementById(`${opts.page}-page`);
        const body = () => document.getElementById(`${opts.page}-body`);

        function isVisible() {
            const page = pageEl();
            return !!page && page.style.display !== 'none';
        }

        function isAvailable(id) {
            return !!id && GameUtils.getAllGameIds().includes(id) && !GameUtils.isComingSoon(id) && !!opts.supports(id);
        }

        function isHidden(id) {
            return !!(window.AppViews && window.AppViews.isHidden && window.AppViews.isHidden(id));
        }

        function listedIds() {
            const ids = GameUtils.getAllGameIds().filter(id => isAvailable(id) && !isHidden(id));
            const installed = id => statuses[id] === 'installed';
            return ids.filter(installed).concat(ids.filter(id => !installed(id)));
        }

        // The grid only needs install status; the open game also needs running state for its button.
        async function refreshStatus(id, withRunning) {
            try {
                if (withRunning && window.GameStateManager) {
                    await window.GameStateManager.updateGameState(id);
                    const state = window.GameStateManager.getGameState(id);
                    if (state) statuses[id] = state.installStatus;
                } else {
                    statuses[id] = (await checkGameInstallation(id)).status;
                }
            } catch (error) {
                console.error(`${opts.page}: failed to read ${id} install state`, error);
            }
        }

        // ---- hub ----

        function hubCard(id) {
            const config = GameUtils.getGameConfigByUIId(id);
            const badge = opts.badge ? opts.badge(id) : '';
            const installed = statuses[id] === 'installed';
            return `
                <article class="library-card game-hub-card${installed ? ' is-installed' : ''}" data-game="${escapeHtml(id)}">
                    <img class="library-card-art" src="${escapeHtml(config.capsulePath)}" alt="${escapeHtml(config.displayName)}" loading="lazy">
                    ${badge ? `<span class="community-room-badge">${escapeHtml(badge)}</span>` : ''}
                    <div class="library-card-body">
                        <div class="library-card-title">${escapeHtml(config.displayName)}</div>
                    </div>
                </article>`;
        }

        function renderGrid() {
            const grid = body() && body().querySelector('.game-hub-grid');
            if (!grid) return;
            grid.innerHTML = listedIds().map(hubCard).join('');
            grid.querySelectorAll('.game-hub-card').forEach(card => {
                card.addEventListener('click', () => select(card.dataset.game));
            });
        }

        function renderHub() {
            body().innerHTML = `
                <div class="community-hub-lead">${escapeHtml(t(opts.leadKey))}</div>
                <div class="library-grid game-hub-grid"></div>
            `;
            renderGrid();

            const ids = GameUtils.getAllGameIds().filter(isAvailable);
            Promise.all([
                Promise.all(ids.map(id => refreshStatus(id, false))),
                opts.prefetch ? opts.prefetch(ids) : null
            ]).then(() => {
                if (current === null && isVisible()) renderGrid();
            });
        }

        // ---- game view ----

        function actionHTML(id) {
            const status = statuses[id];
            if (!status) return '';
            const busyKind = busyKindFor(id);
            if (status === 'installed') {
                const state = window.GameStateManager && window.GameStateManager.getGameState(id);
                const running = !!(state && state.isRunning);
                const q = window.DownloadQueueManager;
                const blocked = !!busyKind || !!(q && typeof q.isAnyBlockingActive === 'function' && q.isAnyBlockingActive());
                return `<button class="game-hub-action" type="button" data-hub-play${running || blocked ? ' disabled' : ''}>${escapeHtml(t(running ? 'hub.running' : 'common.play'))}</button>`;
            }
            return `<button class="game-hub-action" type="button" data-hub-setup${busyKind ? ' disabled' : ''}>${escapeHtml(setupButtonLabel(status, busyKind, id))}</button>`;
        }

        function renderAction(id) {
            const host = body() && body().querySelector('[data-hub-action]');
            if (!host || current !== id) return;
            host.innerHTML = actionHTML(id);
            const play = host.querySelector('[data-hub-play]');
            if (play) play.addEventListener('click', () => launchGame(id));
            const setup = host.querySelector('[data-hub-setup]');
            if (setup) setup.addEventListener('click', () => showSetupFlow(id));
        }

        function renderGame(id) {
            const config = GameUtils.getGameConfigByUIId(id);
            const options = listedIds();
            if (!options.includes(id)) options.unshift(id);

            body().innerHTML = `
                <div class="community-room-header game-hub-header">
                    ${config.heroImagePath ? `<img class="community-hero-art" src="${escapeHtml(config.heroImagePath)}" alt="" />` : ''}
                    <button class="cb-ghost-btn community-back" type="button" data-hub-back>${escapeHtml(t('hub.back'))}</button>
                    <select class="game-hub-switch" aria-label="${escapeHtml(t('hub.switchGame'))}">
                        ${options.map(option => `<option value="${escapeHtml(option)}"${option === id ? ' selected' : ''}>${escapeHtml(gameName(option))}</option>`).join('')}
                    </select>
                    <div class="game-hub-actions">
                        <button class="mods-btn" type="button" data-hub-page>${escapeHtml(t('hub.gamePage'))}</button>
                        <span data-hub-action></span>
                    </div>
                </div>
                <div class="${opts.panelClass}" data-game="${escapeHtml(id)}"></div>
            `;

            const root = body();
            root.querySelector('[data-hub-back]').addEventListener('click', back);
            const switcher = root.querySelector('.game-hub-switch');
            switcher.addEventListener('change', event => select(event.target.value));
            GameUtils.fitSelectWidth(switcher);
            root.querySelector('[data-hub-page]').addEventListener('click', () => navigateToGamePage(id));

            renderAction(id);
            opts.renderGame(id);
            refreshStatus(id, true).then(() => renderAction(id));
        }

        function render() {
            if (!body()) return;
            if (current) renderGame(current);
            else renderHub();
        }

        // ---- navigation ----

        function select(id) {
            if (!isAvailable(id)) return;
            current = id;
            render();
        }

        function back() {
            current = null;
            render();
        }

        function show() {
            render();
        }

        // Opens the page on a game, from a game page shortcut, a deep link or a Downloads row.
        function open(id) {
            if (!isAvailable(id)) return false;
            current = id;
            const nav = document.getElementById(opts.page);
            if (nav && nav.classList.contains('active') && isVisible()) {
                render();
                return true;
            }
            removeActiveNavigation();
            if (nav) nav.classList.add('active');
            loadNavigationPage(opts.page);
            return true;
        }

        function refresh() {
            if (isVisible()) render();
        }

        function refreshBadges() {
            if (isVisible() && current === null) renderGrid();
        }

        function onStateChanged() {
            if (!isVisible()) return;
            if (current) {
                const id = current;
                refreshStatus(id, true).then(() => renderAction(id));
            } else {
                renderHub();
            }
        }

        window.addEventListener('cb-download-queue-changed', () => {
            if (isVisible() && current) renderAction(current);
        });
        window.addEventListener('gameInstallationUpdated', onStateChanged);

        return { show, open, back, refresh, refreshBadges, supports: isAvailable, current: () => current };
    }

    const modSummaries = {};

    window.ServersHub = create({
        page: 'servers',
        panelClass: 'servers-panel',
        leadKey: 'hub.pickServersGame',
        supports: id => window.ServersView && window.ServersView.supports(id),
        renderGame: id => window.ServersView.render(id),
        badge: id => {
            const counts = window.PlayerCountManager;
            if (!counts || counts.getMode() === 'off') return '';
            const players = counts.getCounts(id).servers;
            return players > 0 ? t('hub.playersBadge', { count: players.toLocaleString() }) : '';
        }
    });

    window.ModsHub = create({
        page: 'mods',
        panelClass: 'mods-panel',
        leadKey: 'hub.pickModsGame',
        supports: id => window.ModsView && window.ModsView.supports(id),
        renderGame: id => window.ModsView.render(id),
        prefetch: ids => Promise.all(ids.map(async id => {
            try {
                modSummaries[id] = await window.ModsView.installedSummary(id);
            } catch (_) {}
        })),
        badge: id => {
            const summary = modSummaries[id];
            if (!summary) return '';
            if (summary.updates > 0) return t('hub.modsUpdates', { count: summary.updates });
            return summary.count > 0 ? t('hub.modsInstalled', { count: summary.count }) : '';
        }
    });

    window.addEventListener('cb-player-counts-changed', () => window.ServersHub.refreshBadges());
})();
