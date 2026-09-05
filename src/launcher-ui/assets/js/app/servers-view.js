(function () {
    'use strict';

    const STALE_MS = 30 * 1000;

    const state = {};
    const escapeHtml = value => GameUtils.escapeHtml(value);
    let searchTimer = null;
    let refreshTimer = null;

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function getState(gameId) {
        if (!state[gameId]) {
            const caps = window.ServersService.supports(gameId) || {};
            const prefs = window.ServersService.getViewPrefs(gameId);
            state[gameId] = {
                query: '',
                mode: (caps.modes || []).includes(prefs.mode) ? prefs.mode : 'all',
                sort: prefs.sort || 'players',
                region: prefs.region || 'all',
                hideEmpty: !!prefs.hideEmpty,
                hideFull: !!prefs.hideFull,
                favoritesOnly: !!prefs.favoritesOnly,
                servers: null,
                loading: false,
                error: null,
                lastUpdated: 0,
                caps
            };
        }
        return state[gameId];
    }

    function saveView(gameId) {
        const s = getState(gameId);
        window.ServersService.saveViewPrefs(gameId, {
            mode: s.mode,
            sort: s.sort,
            region: s.region,
            hideEmpty: s.hideEmpty,
            hideFull: s.hideFull,
            favoritesOnly: s.favoritesOnly
        });
    }

    function query(gameId, selector) {
        const panel = document.getElementById(`${gameId}-servers-panel`);
        if (!panel) return null;
        return selector ? panel.querySelector(selector) : panel;
    }

    const hasPing = server => typeof server.ping === 'number';

    const LOCK_SVG = '<svg class="server-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    const STAR_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.57l-5.9 3.11 1.13-6.58-4.78-4.66 6.6-.96z"/></svg>';

    function emptyHTML(key) {
        return `<div class="mods-empty">${escapeHtml(t(key))}</div>`;
    }

    function favTitle(favorite) {
        return t(favorite ? 'servers.favoriteRemove' : 'servers.favoriteAdd');
    }

    function render(gameId) {
        const panel = query(gameId);
        if (!panel) return;
        const s = getState(gameId);
        const chip = (attrs, active, label) => `<button class="chip${active ? ' active' : ''}" ${attrs}>${escapeHtml(label)}</button>`;
        const option = (current, value, label) => `<option value="${value}"${current === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;
        const modeInfo = GameUtils.getModeInfo();
        const modes = s.caps.modes || [];

        panel.innerHTML = `
            <div class="servers-toolbar">
                <div class="search-field">
                    <input type="text" class="servers-search" placeholder="${escapeHtml(t('servers.searchPlaceholder'))}" value="${escapeHtml(s.query)}" />
                    <button type="button" class="search-clear servers-search-clear"${s.query ? '' : ' hidden'}>&times;</button>
                </div>
                <div class="filter-chips servers-filters">
                    ${modes.length > 1 ? chip('data-mode="all"', s.mode === 'all', t('servers.filterAll')) : ''}
                    ${modes.length > 1 ? modes.map(mode => chip(`data-mode="${mode}"`, s.mode === mode, (modeInfo[mode] || {}).name || mode.toUpperCase())).join('') : ''}
                    ${chip('data-toggle="favoritesOnly"', s.favoritesOnly, t('servers.favorites'))}
                    ${chip('data-toggle="hideEmpty"', s.hideEmpty, t('servers.hideEmpty'))}
                    ${chip('data-toggle="hideFull"', s.hideFull, t('servers.hideFull'))}
                </div>
                <select class="cdn-select servers-region">
                    ${option(s.region, 'all', t('servers.allRegions'))}
                    ${window.ServersService.REGIONS.map(region => option(s.region, region, region)).join('')}
                </select>
                <select class="cdn-select servers-sort">
                    ${option(s.sort, 'players', t('servers.sortPlayers'))}
                    ${option(s.sort, 'ping', t('servers.sortPing'))}
                    ${option(s.sort, 'name', t('servers.sortName'))}
                </select>
                <button class="mods-btn servers-refresh-btn">${escapeHtml(t('servers.refresh'))}</button>
                <span class="servers-updated"></span>
            </div>
            <div class="servers-list-host"></div>
        `;

        const input = panel.querySelector('.servers-search');
        const clear = panel.querySelector('.servers-search-clear');
        const setQuery = value => {
            s.query = value;
            input.value = value;
            clear.hidden = !value;
        };
        input.addEventListener('input', () => {
            setQuery(input.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => renderList(gameId), 250);
        });
        clear.addEventListener('click', () => {
            setQuery('');
            renderList(gameId);
            input.focus();
        });
        panel.querySelectorAll('.chip[data-mode]').forEach(button => {
            button.addEventListener('click', () => {
                s.mode = button.dataset.mode;
                panel.querySelectorAll('.chip[data-mode]').forEach(b => b.classList.toggle('active', b === button));
                saveView(gameId);
                renderList(gameId);
            });
        });
        panel.querySelectorAll('.chip[data-toggle]').forEach(button => {
            button.addEventListener('click', () => {
                s[button.dataset.toggle] = !s[button.dataset.toggle];
                button.classList.toggle('active', s[button.dataset.toggle]);
                saveView(gameId);
                renderList(gameId);
            });
        });
        panel.querySelector('.servers-region').addEventListener('change', event => {
            s.region = event.target.value;
            saveView(gameId);
            renderList(gameId);
        });
        panel.querySelector('.servers-sort').addEventListener('change', event => {
            s.sort = event.target.value;
            saveView(gameId);
            renderList(gameId);
        });
        panel.querySelector('.servers-refresh-btn').addEventListener('click', () => loadServers(gameId));
        bindListEvents(gameId, panel.querySelector('.servers-list-host'));

        ensureTimers();
        if (s.servers === null || Date.now() - s.lastUpdated > STALE_MS) {
            loadServers(gameId);
        } else {
            renderList(gameId);
        }
    }

    async function loadServers(gameId, silent) {
        const s = getState(gameId);
        if (s.loading) return;

        s.loading = true;
        s.error = null;
        const host = query(gameId, '.servers-list-host');
        if (host && !silent) {
            host.innerHTML = `<div class="mods-loading"><div class="spinner"></div><span>${escapeHtml(t('servers.loading'))}</span></div>`;
        }

        try {
            s.servers = await window.ServersService.getServers(gameId);
            s.lastUpdated = Date.now();
        } catch (error) {
            console.error(error);
            // A silent background refresh keeps showing the last good list.
            if (!silent || s.servers === null) s.error = error;
        }
        s.loading = false;
        renderList(gameId);
    }

    function applyFilters(s, favorites) {
        const needle = s.query.trim().toLowerCase();
        return s.servers
            .filter(server => (s.mode === 'all' || server.mode === s.mode)
                && (s.region === 'all' || server.region === s.region)
                && (!needle || server.name.toLowerCase().includes(needle) || server.map.toLowerCase().includes(needle))
                && (!s.hideEmpty || server.players > 0)
                && (!s.hideFull || server.players < server.maxPlayers)
                && (!s.favoritesOnly || favorites.has(server.id)))
            .sort((a, b) => {
                const pingOf = server => hasPing(server) ? server.ping : Infinity;
                if (s.sort === 'ping') return pingOf(a) - pingOf(b);
                if (s.sort === 'name') return a.name.localeCompare(b.name);
                return (b.players - a.players) || (pingOf(a) - pingOf(b));
            });
    }

    function serverRowHTML(server, favorite) {
        const pinged = hasPing(server);
        const pingClass = !pinged ? 'is-off' : server.ping < 80 ? 'is-good' : server.ping < 150 ? 'is-mid' : 'is-bad';
        const playersTitle = server.bots > 0 ? ` title="${escapeHtml(t('servers.bots', { count: server.bots }))}"` : '';
        return `
            <div class="server-row" data-server-id="${escapeHtml(server.id)}">
                <button class="server-fav-btn${favorite ? ' is-fav' : ''}" title="${escapeHtml(favTitle(favorite))}">${STAR_SVG}</button>
                <div class="server-name">${server.locked ? `<span title="${escapeHtml(t('servers.passworded'))}">${LOCK_SVG}</span>` : ''}<span>${escapeHtml(server.name)}</span></div>
                <span class="server-map">${escapeHtml(server.map)}</span>
                <span class="server-mode"><span class="badge server-mode-badge">${escapeHtml(`${server.mode.toUpperCase()} · ${server.gametype.toUpperCase()}`)}</span></span>
                <span class="server-region"${server.countryName ? ` title="${escapeHtml(server.countryName)}"` : ''}>${escapeHtml(server.region)}</span>
                <span class="server-players"${playersTitle}>${server.players}/${server.maxPlayers}</span>
                <span class="server-ping ${pingClass}">${pinged ? `${server.ping}ms` : '—'}</span>
                <button class="mods-btn server-join-btn">${escapeHtml(t('servers.join'))}</button>
            </div>`;
    }

    function renderList(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.servers-list-host');
        if (!host) return;
        renderUpdated(gameId);

        if (s.loading) return;
        if (s.error) {
            host.innerHTML = `<div class="mods-empty servers-error">
                <span>${escapeHtml(t('servers.loadFailed'))}</span>
                <button class="mods-btn servers-retry-btn">${escapeHtml(t('servers.retry'))}</button>
            </div>`;
            host.querySelector('.servers-retry-btn').addEventListener('click', () => loadServers(gameId));
            return;
        }
        if (s.servers === null) return;
        if (!s.servers.length) {
            host.innerHTML = emptyHTML('servers.empty');
            return;
        }

        const favorites = new Set(window.ServersService.getFavorites(gameId));
        const shown = applyFilters(s, favorites);
        if (!shown.length) {
            const noFavorites = s.favoritesOnly && !favorites.size;
            host.innerHTML = emptyHTML(noFavorites ? 'servers.noFavorites' : 'servers.noMatches');
            return;
        }

        const totalPlayers = shown.reduce((sum, server) => sum + server.players, 0);
        host.innerHTML = `
            <div class="servers-count">${escapeHtml(`${t('servers.count', { shown: shown.length, total: s.servers.length })} · ${t('servers.countPlayers', { count: totalPlayers })}`)}</div>
            <div class="servers-list">
                <div class="servers-head">
                    <span></span>
                    <span>${escapeHtml(t('servers.colName'))}</span>
                    <span>${escapeHtml(t('servers.colMap'))}</span>
                    <span>${escapeHtml(t('servers.colMode'))}</span>
                    <span>${escapeHtml(t('servers.colRegion'))}</span>
                    <span>${escapeHtml(t('servers.colPlayers'))}</span>
                    <span>${escapeHtml(t('servers.colPing'))}</span>
                    <span></span>
                </div>
                ${shown.map(server => serverRowHTML(server, favorites.has(server.id))).join('')}
            </div>
        `;
    }

    // One delegated listener per panel instead of two per row.
    function bindListEvents(gameId, host) {
        host.addEventListener('click', event => {
            const row = event.target.closest('.server-row');
            if (!row || !host.contains(row)) return;
            const id = row.dataset.serverId;

            const favButton = event.target.closest('.server-fav-btn');
            if (favButton) {
                const added = window.ServersService.toggleFavorite(gameId, id);
                if (getState(gameId).favoritesOnly) {
                    renderList(gameId);
                    return;
                }
                favButton.classList.toggle('is-fav', added);
                favButton.title = favTitle(added);
                return;
            }

            if (event.target.closest('.server-join-btn')) {
                joinServer(gameId, id);
            }
        });
    }

    async function joinServer(gameId, id) {
        const s = getState(gameId);
        const server = (s.servers || []).find(entry => entry.id === id);
        if (!server) return;

        if (!s.caps.join) {
            window.showToast(t('servers.joinComingSoon'), 'info');
            return;
        }

        const gameState = window.GameStateManager && window.GameStateManager.gameStates[gameId];
        if (!gameState || gameState.installStatus !== 'installed') {
            window.showToast(t('servers.joinInstallFirst'), 'info');
            if (window.showSetupFlow) window.showSetupFlow(gameId);
            return;
        }

        try {
            const result = await window.ServersService.joinServer(gameId, server);
            if (!result || !result.success) {
                throw new Error((result && result.error) || 'Failed to join the server.');
            }
            window.showToast(t('servers.joiningToast', { name: server.name }), 'info');
        } catch (error) {
            console.error(error);
            window.showToast(String(error.message || error), 'error');
        }
    }

    function renderUpdated(gameId) {
        const s = getState(gameId);
        const label = query(gameId, '.servers-updated');
        if (!label) return;
        if (!s.lastUpdated) {
            label.textContent = '—';
            return;
        }
        const seconds = Math.max(0, Math.floor((Date.now() - s.lastUpdated) / 1000));
        if (seconds < 60) {
            label.textContent = t('servers.updatedSecondsAgo');
        } else if (seconds < 3600) {
            label.textContent = t('servers.updatedMinutesAgo', { minutes: Math.floor(seconds / 60) });
        } else {
            label.textContent = t('servers.updatedHoursAgo', { hours: Math.floor(seconds / 3600) });
        }
    }

    // Refresh only while a servers panel is the visible tab of the visible page;
    // polling for that beats having views.js signal tab deactivation.
    function activeServersGame() {
        if (document.visibilityState !== 'visible') return null;
        const panel = document.querySelector('.tab-panel.servers-panel.active');
        if (!panel || panel.offsetParent === null) return null;
        return panel.id.replace(/-servers-panel$/, '');
    }

    function ensureTimers() {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
            const gameId = activeServersGame();
            if (gameId && state[gameId]) loadServers(gameId, true);
        }, STALE_MS);
        setInterval(() => {
            const gameId = activeServersGame();
            if (gameId && state[gameId]) renderUpdated(gameId);
        }, 10000);
    }

    window.ServersView = {
        render,
        supports: gameId => !!(window.ServersService && window.ServersService.supports(gameId))
    };
})();
