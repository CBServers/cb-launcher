(function () {
    'use strict';

    const state = {};
    const escapeHtml = value => GameUtils.escapeHtml(value);
    let searchTimer = null;

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function getState(gameId) {
        if (!state[gameId]) {
            state[gameId] = {
                view: 'installed',
                query: '',
                kind: 'all',
                sort: 'popular',
                installed: null,
                results: null,
                searching: false,
                steam: null,
                busy: {},
                caps: window.ModsService.supports(gameId) || {}
            };
        }
        return state[gameId];
    }

    function query(gameId, selector) {
        const panel = document.getElementById(`${gameId}-mods-panel`);
        if (!panel) return null;
        return selector ? panel.querySelector(selector) : panel;
    }

    function gameName(gameId) {
        const config = GameUtils.getGameConfigByUIId(gameId);
        return config ? config.displayName : gameId;
    }

    function formatCount(value) {
        if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(value);
    }

    function kindBadge(kind) {
        return `<span class="badge mods-type-badge is-${escapeHtml(kind)}">${escapeHtml(t(kind === 'map' ? 'mods.kindMap' : 'mods.kindMod'))}</span>`;
    }

    function reportError(error) {
        console.error(error);
        window.showToast(String(error.message || error), 'error');
    }

    function loadingHTML() {
        return `<div class="mods-loading"><div class="spinner"></div><span>${escapeHtml(t('mods.loading'))}</span></div>`;
    }

    function emptyHTML(key) {
        return `<div class="mods-empty">${escapeHtml(t(key))}</div>`;
    }

    function render(gameId) {
        const panel = query(gameId);
        if (!panel) return;
        const s = getState(gameId);
        const caps = s.caps;
        const subtab = (view, label) => `<button class="mods-subtab${s.view === view ? ' active' : ''}" data-view="${view}">${label}</button>`;
        const viewHost = view => `<div class="mods-view${s.view === view ? ' active' : ''}" data-view="${view}"></div>`;

        panel.innerHTML = `
            <div class="mods-toolbar">
                <div class="mods-subnav">
                    ${subtab('installed', `${escapeHtml(t('mods.installed'))} <span class="badge mods-count" hidden></span>`)}
                    ${caps.workshop ? subtab('workshop', escapeHtml(t('mods.workshop'))) : ''}
                    ${caps.import ? subtab('import', escapeHtml(t('mods.import'))) : ''}
                </div>
                <div class="mods-folder-actions">
                    ${(caps.folders || []).map(folder => `
                    <button class="secondary-action mods-open-folder" data-folder="${escapeHtml(folder)}">
                        <span class="secondary-action-icon folder-icon"></span>
                        ${escapeHtml(t('mods.openFolder', { folder }))}
                    </button>`).join('')}
                </div>
            </div>
            ${viewHost('installed')}
            ${caps.workshop ? viewHost('workshop') : ''}
            ${caps.import ? viewHost('import') : ''}
        `;

        panel.querySelectorAll('.mods-subtab').forEach(button => {
            button.addEventListener('click', () => switchView(gameId, button.dataset.view));
        });
        panel.querySelectorAll('.mods-open-folder').forEach(button => {
            button.addEventListener('click', () => openFolder(gameId, button.dataset.folder));
        });

        renderInstalled(gameId);
        if (caps.workshop) renderWorkshop(gameId);
        if (caps.import) renderImport(gameId);

        loadInstalled(gameId);
        if (caps.workshop) {
            loadSteamStatus(gameId);
            if (s.results === null) runSearch(gameId);
        }
    }

    function switchView(gameId, view) {
        const panel = query(gameId);
        if (!panel) return;
        getState(gameId).view = view;
        panel.querySelectorAll('.mods-subtab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        panel.querySelectorAll('.mods-view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    }

    async function loadInstalled(gameId) {
        const s = getState(gameId);
        try {
            s.installed = await window.ModsService.getInstalled(gameId);
        } catch (error) {
            console.error(error);
            s.installed = [];
        }
        renderInstalled(gameId);

        const badge = query(gameId, '.mods-count');
        if (badge) {
            badge.textContent = String(s.installed.length);
            badge.hidden = false;
        }

        if (s.results) {
            s.results.items.forEach(item => {
                const installed = s.installed.find(mod => mod.workshopId === item.id);
                item.installed = !!installed;
                item.updateAvailable = !!(installed && installed.updateAvailable);
            });
            renderWorkshopGrid(gameId);
        }
    }

    function renderInstalled(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.mods-view[data-view="installed"]');
        if (!host) return;

        if (s.installed === null) {
            host.innerHTML = loadingHTML();
            return;
        }
        if (!s.installed.length) {
            host.innerHTML = emptyHTML(s.caps.workshop ? 'mods.noInstalled' : 'mods.noInstalledImportOnly');
            return;
        }

        host.innerHTML = `<div class="mods-list">${s.installed.map(mod => installedRowHTML(s, mod)).join('')}</div>`;
        host.querySelectorAll('.mods-update-btn').forEach(button => {
            button.addEventListener('click', () => updateMod(gameId, button.dataset.id));
        });
        host.querySelectorAll('.mods-uninstall-btn').forEach(button => {
            button.addEventListener('click', () => uninstallMod(gameId, button.dataset.id));
        });
    }

    function installedRowHTML(s, mod) {
        const busy = s.busy[mod.id];
        const meta = [
            mod.version && mod.version !== '—' ? t('mods.version', { version: mod.version }) : null,
            GameUtils.formatBytes(mod.size || 0),
            t(mod.source === 'workshop' ? 'mods.sourceWorkshop' : 'mods.sourceImport')
        ].filter(Boolean);
        const actions = busy !== undefined
            ? `<span class="mods-row-progress">${escapeHtml(t('mods.installing', { percent: busy }))}</span>`
            : `${mod.updateAvailable ? `<button class="mods-btn mods-update-btn" data-id="${escapeHtml(mod.id)}">${escapeHtml(t('mods.update'))}</button>` : ''}
               <button class="mods-btn is-danger mods-uninstall-btn" data-id="${escapeHtml(mod.id)}">${escapeHtml(t('mods.uninstall'))}</button>`;

        return `
            <div class="mods-row${mod.updateAvailable ? ' is-updatable' : ''}" data-mod-id="${escapeHtml(mod.id)}">
                <div class="mods-row-main">
                    ${kindBadge(mod.kind)}
                    <strong class="mods-row-name">${escapeHtml(mod.name)}</strong>
                    ${mod.updateAvailable ? `<span class="badge status-partial mods-update-badge">${escapeHtml(t('mods.updateAvailable'))}</span>` : ''}
                </div>
                <div class="mods-row-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
                <div class="mods-row-actions">${actions}</div>
                <div class="mods-progress"><div class="mods-progress-bar" style="width:${busy || 0}%"></div></div>
            </div>`;
    }

    async function runTransfer(gameId, id, transfer, onTick, successKey, name) {
        if (!await window.guardOnline()) return;
        const s = getState(gameId);
        if (s.busy[id] !== undefined) return;

        s.busy[id] = 0;
        onTick();
        try {
            await transfer(event => {
                if (event.phase === 'done') return;
                s.busy[id] = event.percent;
                onTick();
            });
            window.showToast(t(successKey, { name }), 'success');
        } catch (error) {
            reportError(error);
        } finally {
            delete s.busy[id];
            await loadInstalled(gameId);
        }
    }

    function updateMod(gameId, id) {
        const mod = (getState(gameId).installed || []).find(m => m.id === id);
        if (!mod) return;
        return runTransfer(gameId, id,
            onProgress => window.ModsService.update(gameId, id, onProgress),
            () => updateRow(gameId, id),
            'mods.updatedToast', mod.name);
    }

    function updateRow(gameId, id) {
        const percent = getState(gameId).busy[id];
        const row = query(gameId, `.mods-row[data-mod-id="${CSS.escape(id)}"]`);
        const label = row && row.querySelector('.mods-row-progress');
        if (!label) {
            renderInstalled(gameId);
            return;
        }
        label.textContent = t('mods.installing', { percent });
        row.querySelector('.mods-progress-bar').style.width = `${percent}%`;
    }

    async function uninstallMod(gameId, id) {
        const mod = (getState(gameId).installed || []).find(m => m.id === id);
        if (!mod) return;

        const choice = await window.showMessageBox(
            t('mods.uninstallConfirmTitle'),
            t('mods.uninstallConfirmBody', { name: escapeHtml(mod.name), game: escapeHtml(gameName(gameId)) }),
            [t('common.cancel'), { label: t('mods.uninstall'), danger: true }]
        );
        if (choice !== 1) return;

        try {
            await window.ModsService.uninstall(gameId, id);
            window.showToast(t('mods.uninstalledToast', { name: mod.name }), 'info');
        } catch (error) {
            reportError(error);
        }
        await loadInstalled(gameId);
    }

    async function loadSteamStatus(gameId) {
        const s = getState(gameId);
        try {
            s.steam = await window.ModsService.getSteamStatus(gameId);
        } catch (error) {
            s.steam = { owned: false, loggedIn: false };
        }
        renderSteamNotice(gameId);
        renderWorkshopGrid(gameId);
    }

    async function runSearch(gameId) {
        const s = getState(gameId);
        s.searching = true;
        renderWorkshopGrid(gameId);
        try {
            s.results = await window.ModsService.search(gameId, { query: s.query, kind: s.kind, sort: s.sort });
        } catch (error) {
            console.error(error);
            s.results = { items: [], total: 0 };
        }
        s.searching = false;
        renderWorkshopGrid(gameId);
    }

    function renderWorkshop(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.mods-view[data-view="workshop"]');
        if (!host) return;

        const chip = (value, label) => `<button class="chip${s.kind === value ? ' active' : ''}" data-kind="${value}">${escapeHtml(label)}</button>`;
        const option = (value, label) => `<option value="${value}"${s.sort === value ? ' selected' : ''}>${escapeHtml(label)}</option>`;

        host.innerHTML = `
            <div class="mods-workshop-controls">
                <div class="search-field">
                    <input type="text" class="mods-search" placeholder="${escapeHtml(t('mods.searchPlaceholder'))}" value="${escapeHtml(s.query)}" />
                    <button type="button" class="search-clear mods-search-clear"${s.query ? '' : ' hidden'}>&times;</button>
                </div>
                <div class="filter-chips">
                    ${chip('all', t('mods.filterAll'))}
                    ${chip('map', t('mods.filterMaps'))}
                    ${chip('mod', t('mods.filterMods'))}
                </div>
                <select class="cdn-select mods-sort">
                    ${option('popular', t('mods.sortPopular'))}
                    ${option('recent', t('mods.sortRecent'))}
                    ${option('name', t('mods.sortName'))}
                </select>
            </div>
            <div class="mods-steam-notice"></div>
            <div class="mods-grid-host"></div>
        `;

        const input = host.querySelector('.mods-search');
        const clear = host.querySelector('.mods-search-clear');
        const setQuery = value => {
            s.query = value;
            input.value = value;
            clear.hidden = !value;
        };
        input.addEventListener('input', () => {
            setQuery(input.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => runSearch(gameId), 250);
        });
        clear.addEventListener('click', () => {
            setQuery('');
            runSearch(gameId);
            input.focus();
        });
        host.querySelectorAll('.chip').forEach(button => {
            button.addEventListener('click', () => {
                s.kind = button.dataset.kind;
                host.querySelectorAll('.chip').forEach(b => b.classList.toggle('active', b === button));
                runSearch(gameId);
            });
        });
        host.querySelector('.mods-sort').addEventListener('change', event => {
            s.sort = event.target.value;
            runSearch(gameId);
        });

        renderSteamNotice(gameId);
        renderWorkshopGrid(gameId);
    }

    function renderSteamNotice(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.mods-steam-notice');
        if (!host) return;

        if (s.steam && !s.steam.owned) {
            host.innerHTML = `<div class="mods-ownership-notice is-warning">${escapeHtml(t('mods.steamNotOwned', { game: gameName(gameId) }))}</div>`;
        } else if (s.steam && !s.steam.loggedIn) {
            host.innerHTML = `
                <div class="mods-ownership-notice">
                    <span>${escapeHtml(t('mods.steamSignIn'))}</span>
                    <button class="mods-btn mods-steam-signin">${escapeHtml(t('mods.steamSignInAction'))}</button>
                </div>`;
            host.querySelector('.mods-steam-signin').addEventListener('click', () => window.showToast(t('mods.comingSoon'), 'info'));
        } else {
            host.innerHTML = '';
        }
    }

    function renderWorkshopGrid(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.mods-grid-host');
        if (!host) return;

        if (s.searching || s.results === null) {
            host.innerHTML = loadingHTML();
            return;
        }
        if (!s.results.items.length) {
            host.innerHTML = emptyHTML('mods.noResults');
            return;
        }

        host.innerHTML = `<div class="mods-grid">${s.results.items.map(item => workshopCardHTML(s, item)).join('')}</div>`;
        host.querySelectorAll('.mods-install-btn').forEach(button => {
            button.addEventListener('click', () => installItem(gameId, button.dataset.id));
        });
    }

    function cardState(s, item) {
        if (s.busy[item.id] !== undefined) return 'installing';
        if (item.installed && item.updateAvailable) return 'update';
        if (item.installed) return 'installed';
        if (!(s.steam && s.steam.owned && s.steam.loggedIn)) return 'locked';
        return 'idle';
    }

    function cardButton(s, item) {
        const stateName = cardState(s, item);
        const percent = s.busy[item.id] || 0;
        const labels = {
            installing: t('mods.installing', { percent }),
            installed: t('mods.installedLabel'),
            update: t('mods.update'),
            locked: t('mods.locked'),
            idle: t('mods.install')
        };
        return {
            stateName,
            percent: stateName === 'installing' ? percent : 0,
            label: labels[stateName],
            disabled: stateName !== 'idle' && stateName !== 'update'
        };
    }

    function workshopCardHTML(s, item) {
        const button = cardButton(s, item);
        return `
            <article class="mods-card" data-id="${escapeHtml(item.id)}">
                <div class="mods-card-art" style="--art: ${escapeHtml(item.preview)}">${kindBadge(item.kind)}</div>
                <div class="mods-card-body">
                    <div class="mods-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                    <div class="mods-card-author">${escapeHtml(t('mods.by', { author: item.author }))}</div>
                    <div class="mods-card-meta">
                        <span>${escapeHtml(t('mods.subscribers', { count: formatCount(item.subscribers) }))}</span>
                        <span>${escapeHtml(GameUtils.formatBytes(item.size))}</span>
                    </div>
                    <button class="mods-install-btn" data-id="${escapeHtml(item.id)}" data-state="${button.stateName}"${button.disabled ? ' disabled' : ''}>
                        <span class="mods-install-label">${escapeHtml(button.label)}</span>
                    </button>
                    <div class="mods-progress"><div class="mods-progress-bar" style="width:${button.percent}%"></div></div>
                </div>
            </article>`;
    }

    function updateCard(gameId, id) {
        const s = getState(gameId);
        const card = query(gameId, `.mods-card[data-id="${CSS.escape(id)}"]`);
        const item = s.results && s.results.items.find(entry => entry.id === id);
        if (!card || !item) return;

        const button = cardButton(s, item);
        const element = card.querySelector('.mods-install-btn');
        element.dataset.state = button.stateName;
        element.disabled = button.disabled;
        element.querySelector('.mods-install-label').textContent = button.label;
        card.querySelector('.mods-progress-bar').style.width = `${button.percent}%`;
    }

    function installItem(gameId, id) {
        const s = getState(gameId);
        const item = s.results && s.results.items.find(entry => entry.id === id);
        if (!item) return;
        return runTransfer(gameId, id,
            onProgress => window.ModsService.install(gameId, id, onProgress).then(() => {
                item.installed = true;
                item.updateAvailable = false;
            }),
            () => updateCard(gameId, id),
            'mods.installedToast', item.title);
    }

    function renderImport(gameId) {
        const s = getState(gameId);
        const host = query(gameId, '.mods-view[data-view="import"]');
        if (!host) return;

        const card = (cls, title, body, icon, label) => `
                <div class="mods-import-card">
                    <h4>${escapeHtml(t(title))}</h4>
                    <p>${escapeHtml(t(body))}</p>
                    <button class="secondary-action ${cls}">
                        <span class="secondary-action-icon ${icon}"></span>
                        ${escapeHtml(t(label))}
                    </button>
                </div>`;

        host.innerHTML = `
            <div class="mods-import-grid">
                ${card('mods-import-folder', 'mods.importFolderTitle', 'mods.importFolderBody', 'folder-icon', 'mods.chooseFolder')}
                ${card('mods-import-zip', 'mods.importZipTitle', 'mods.importZipBody', 'files-icon', 'mods.chooseZip')}
            </div>
            <div class="mods-import-status" hidden><div class="spinner"></div><span></span></div>
            <div class="mods-folders-hint">
                <span>${escapeHtml(t('mods.foldersHint'))}</span>
                ${(s.caps.folders || []).map(f => `<code>${escapeHtml(f)}/</code>`).join('')}
            </div>
        `;

        host.querySelector('.mods-import-folder').addEventListener('click', () => runImport(gameId, 'folder'));
        host.querySelector('.mods-import-zip').addEventListener('click', () => runImport(gameId, 'zip'));
    }

    async function runImport(gameId, kind) {
        const host = query(gameId, '.mods-view[data-view="import"]');
        const status = host && host.querySelector('.mods-import-status');
        const buttons = host ? host.querySelectorAll('.mods-import-card button') : [];
        const setPhase = (phase, name) => {
            if (!status) return;
            status.hidden = !phase;
            status.querySelector('span').textContent = phase ? t(phase === 'extracting' ? 'mods.extracting' : 'mods.importing', { name }) : '';
        };

        try {
            const path = kind === 'zip'
                ? await window.executeCommand('browse-file', { title: t('mods.importZipTitle'), filters: [{ name: 'Zip archives', pattern: '*.zip' }] })
                : await window.executeCommand('browse-folder');
            if (!path) return;

            buttons.forEach(b => b.disabled = true);
            setPhase('copying', path.split(/[\\/]/).pop());
            const importer = kind === 'zip' ? window.ModsService.importZip : window.ModsService.importFolder;
            const result = await importer(gameId, path, setPhase);
            window.showToast(t('mods.importedToast', { name: result.name }), 'success');
            await loadInstalled(gameId);
            switchView(gameId, 'installed');
        } catch (error) {
            reportError(error);
        } finally {
            buttons.forEach(b => b.disabled = false);
            setPhase('');
        }
    }

    async function openFolder(gameId, folder) {
        try {
            const path = await window.ModsService.getModsFolder(gameId, folder);
            if (path) await window.executeCommand('open-folder', { path });
        } catch (error) {
            console.error(error);
        }
    }

    window.ModsView = {
        render,
        refresh: loadInstalled,
        supports: gameId => !!(window.ModsService && window.ModsService.supports(gameId))
    };
})();
