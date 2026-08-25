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
                page: 1,
                installed: null,
                results: null,
                searching: false,
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
        if (caps.workshop && s.results === null) runSearch(gameId);
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
            const times = await window.ModsService.getUpdatedTimes(gameId, s.installed.filter(mod => mod.workshopId).map(mod => mod.workshopId));
            s.installed.forEach(mod => {
                mod.updateAvailable = !!(times[mod.workshopId] && times[mod.workshopId] > Date.parse(mod.installedAt) / 1000);
            });
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
        host.querySelectorAll('.mods-details-btn').forEach(button => {
            button.addEventListener('click', () => openModDetails(gameId, button.dataset.id));
        });
        host.querySelectorAll('.mods-row-folder-btn').forEach(button => {
            button.addEventListener('click', () => openModFolder(gameId, button.dataset.id));
        });
        host.querySelectorAll('.mods-uninstall-btn').forEach(button => {
            button.addEventListener('click', () => uninstallMod(gameId, button.dataset.id));
        });
        host.querySelectorAll('.mods-cancel-btn').forEach(button => {
            button.addEventListener('click', () => window.ModsService.cancelInstall(gameId));
        });
    }

    function iconButtonHTML(id, classes, icon, label) {
        return `<button class="mods-btn mods-icon-btn ${classes}" data-id="${escapeHtml(id)}" title="${escapeHtml(label)}">
                    <span class="mods-btn-icon ${icon}"></span>
                </button>`;
    }

    function sourceLabel(source) {
        if (source === 'steam') return t('mods.sourceSteam');
        return t(source === 'workshop' ? 'mods.sourceWorkshop' : 'mods.sourceImport');
    }

    function installedRowHTML(s, mod) {
        const busy = s.busy[mod.id];
        const meta = [
            mod.version && mod.version !== '—' ? t('mods.version', { version: mod.version }) : null,
            GameUtils.formatBytes(mod.size || 0),
            sourceLabel(mod.source)
        ].filter(Boolean);
        const actions = busy !== undefined
            ? `<span class="mods-row-progress">${escapeHtml(t('mods.installing', { percent: busy.percent }))}</span>
               <button class="mods-btn is-danger mods-cancel-btn">${escapeHtml(t('mods.cancel'))}</button>`
            : `${mod.updateAvailable ? `<button class="mods-btn mods-update-btn" data-id="${escapeHtml(mod.id)}">${escapeHtml(t('mods.update'))}</button>` : ''}
               ${mod.workshopId && s.caps.workshop ? iconButtonHTML(mod.id, 'mods-details-btn', 'info-icon', t('mods.details')) : ''}
               ${iconButtonHTML(mod.id, 'mods-row-folder-btn', 'folder-icon', t('mods.openModFolder'))}
               ${iconButtonHTML(mod.id, 'mods-uninstall-btn is-danger', 'trash-icon', t('mods.uninstall'))}`;

        return `
            <div class="mods-row${mod.updateAvailable ? ' is-updatable' : ''}" data-mod-id="${escapeHtml(mod.id)}">
                <div class="mods-row-main">
                    ${kindBadge(mod.kind)}
                    <strong class="mods-row-name">${escapeHtml(mod.name)}</strong>
                    ${mod.updateAvailable ? `<span class="badge status-partial mods-update-badge">${escapeHtml(t('mods.updateAvailable'))}</span>` : ''}
                </div>
                <div class="mods-row-meta">${meta.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>
                <div class="mods-row-actions">${actions}</div>
                <div class="mods-progress"><div class="mods-progress-bar" style="width:${busy ? busy.percent : 0}%"></div></div>
            </div>`;
    }

    async function runTransfer(gameId, id, transfer, onTick, successKey, name) {
        if (!await window.guardOnline()) return;
        const s = getState(gameId);
        if (s.busy[id] !== undefined) return;

        s.busy[id] = { percent: 0, phase: 'queued' };
        onTick();
        try {
            const result = await transfer(event => {
                if (event.phase === 'done') return;
                s.busy[id] = { percent: event.percent || 0, phase: event.phase || '' };
                onTick();
            });
            if (result && result.cancelled) {
                window.showToast(t('mods.cancelledToast'), 'info');
            } else {
                window.showToast(t(successKey, { name }), 'success');
            }
        } catch (error) {
            reportError(error);
        } finally {
            delete s.busy[id];
            await loadInstalled(gameId);
            onTick();
        }
    }

    function updateMod(gameId, id) {
        const mod = (getState(gameId).installed || []).find(m => m.id === id);
        if (!mod || !mod.workshopId) return;
        return runTransfer(gameId, id,
            onProgress => window.ModsService.update(gameId, { id: mod.workshopId, size: mod.size }, onProgress),
            () => updateRow(gameId, id),
            'mods.updatedToast', mod.name);
    }

    function updateRow(gameId, id) {
        const busy = getState(gameId).busy[id] || { percent: 0 };
        const row = query(gameId, `.mods-row[data-mod-id="${CSS.escape(id)}"]`);
        const label = row && row.querySelector('.mods-row-progress');
        if (!label) {
            renderInstalled(gameId);
            return;
        }
        label.textContent = t('mods.installing', { percent: busy.percent });
        row.querySelector('.mods-progress-bar').style.width = `${busy.percent}%`;
    }

    async function uninstallMod(gameId, id) {
        const mod = (getState(gameId).installed || []).find(m => m.id === id);
        if (!mod) return;

        const body = mod.source === 'steam'
            ? t('mods.uninstallSteamConfirmBody', { name: escapeHtml(mod.name) })
            : t('mods.uninstallConfirmBody', { name: escapeHtml(mod.name), game: escapeHtml(gameName(gameId)) });
        const choice = await window.showMessageBox(
            t('mods.uninstallConfirmTitle'),
            body,
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

    async function runSearch(gameId, append) {
        const s = getState(gameId);
        s.page = append ? s.page + 1 : 1;
        s.searching = !append;
        renderWorkshopGrid(gameId);
        try {
            const result = await window.ModsService.search(gameId, { query: s.query, kind: s.kind, sort: s.sort, page: s.page });
            if (append && s.results) {
                s.results.items.push(...result.items);
                s.results.total = result.total;
            } else {
                s.results = result;
            }
        } catch (error) {
            console.error(error);
            if (!append) s.results = { items: [], total: 0 };
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

        renderWorkshopGrid(gameId);
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

        const shown = s.results.items.length;
        host.innerHTML = `
            <div class="mods-grid">${s.results.items.map(item => workshopCardHTML(s, item)).join('')}</div>
            ${shown < s.results.total ? `<div class="mods-load-more"><button class="mods-btn">${escapeHtml(t('mods.loadMore', { shown, total: s.results.total }))}</button></div>` : ''}
        `;
        host.querySelectorAll('.mods-install-btn').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (button.dataset.state === 'installing') {
                    window.ModsService.cancelInstall(gameId);
                } else {
                    installItem(gameId, button.dataset.id);
                }
            });
        });
        host.querySelectorAll('.mods-card').forEach(card => {
            card.addEventListener('click', () => {
                const item = s.results.items.find(entry => entry.id === card.dataset.id);
                if (item && window.ModDetailPopup) window.ModDetailPopup.show(gameId, item);
            });
        });
        const more = host.querySelector('.mods-load-more button');
        if (more) more.addEventListener('click', () => runSearch(gameId, true));
    }

    function cardState(s, item) {
        if (s.busy[item.id] !== undefined) return 'installing';
        if (item.installed && item.updateAvailable) return 'update';
        if (item.installed) return 'installed';
        return 'idle';
    }

    function cardButton(s, item) {
        const stateName = cardState(s, item);
        const busy = s.busy[item.id] || { percent: 0, phase: '' };
        const labels = {
            installing: busy.phase === 'preparing' || busy.phase === 'queued'
                ? t('mods.preparing')
                : t('mods.installing', { percent: busy.percent }),
            installed: t('mods.installedLabel'),
            update: t('mods.update'),
            idle: t('mods.install')
        };
        return {
            stateName,
            percent: stateName === 'installing' ? busy.percent : 0,
            label: labels[stateName],
            disabled: stateName === 'installed'
        };
    }

    function workshopCardHTML(s, item) {
        const button = cardButton(s, item);
        const previewIsUrl = /^https?:/.test(item.preview);
        const preview = escapeHtml(item.preview);
        return `
            <article class="mods-card" data-id="${escapeHtml(item.id)}">
                <div class="mods-card-art"${previewIsUrl ? '' : ` style="--art: ${preview}"`}>${previewIsUrl ? `<img class="mods-card-art-bg" src="${preview}" alt="" loading="lazy"><img src="${preview}" alt="" loading="lazy">` : ''}${kindBadge(item.kind)}</div>
                <div class="mods-card-body">
                    <div class="mods-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
                    <div class="mods-card-author">${escapeHtml(t('mods.by', { author: item.author }))}</div>
                    <div class="mods-card-meta">
                        <span>${escapeHtml(t('mods.subscribers', { count: GameUtils.formatCount(item.subscribers) }))}</span>
                        <span>${escapeHtml(GameUtils.formatBytes(item.size))}</span>
                    </div>
                    <button class="mods-install-btn" data-id="${escapeHtml(item.id)}" data-state="${button.stateName}"${button.disabled ? ' disabled' : ''}>
                        <span class="mods-install-label">${escapeHtml(button.label)}</span><span class="mods-cancel-label">${escapeHtml(t('mods.cancel'))}</span>
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
        if (window.ModDetailPopup && window.ModDetailPopup.item && window.ModDetailPopup.item.id === id) {
            window.ModDetailPopup.syncInstallButton(button.label, button.disabled);
        }
    }

    function installItem(gameId, id) {
        const s = getState(gameId);
        const item = s.results && s.results.items.find(entry => entry.id === id);
        if (!item) return;
        return runTransfer(gameId, id,
            onProgress => window.ModsService.install(gameId, item, onProgress),
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

    function openModDetails(gameId, id) {
        const mod = (getState(gameId).installed || []).find(entry => entry.id === id);
        if (!mod || !mod.workshopId || !window.ModDetailPopup) return;
        window.ModDetailPopup.show(gameId, { id: mod.workshopId, title: mod.name, author: '', size: mod.size });
    }

    async function openModFolder(gameId, id) {
        try {
            const path = await window.ModsService.getModFolder(gameId, id);
            if (path) {
                await window.executeCommand('open-folder', { path });
            } else {
                window.showToast(t('mods.folderMissing'), 'error');
            }
        } catch (error) {
            reportError(error);
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

    function cardButtonFor(gameId, id) {
        const s = getState(gameId);
        // The detail popup also opens from the installed list, where the workshop
        // search results may not hold this item.
        const installed = (s.installed || []).find(mod => mod.workshopId === id);
        const item = (s.results && s.results.items.find(entry => entry.id === id))
            || (installed ? { id, installed: true, updateAvailable: !!installed.updateAvailable } : null);
        return item ? cardButton(s, item) : null;
    }

    async function openDeepLink(gameId, id) {
        if (window.AppViews) window.AppViews.activateDetailTab(document.getElementById(`${gameId}-page`), gameId, 'mods');
        if (!getState(gameId).caps.workshop) return;
        switchView(gameId, 'workshop');
        if (!id) return;
        try {
            const detail = await window.ModsService.getDetails(gameId, id);
            window.ModDetailPopup.show(gameId, { id: detail.id, title: detail.title, author: '', size: detail.size });
        } catch (error) {
            reportError(error);
        }
    }

    window.ModsView = {
        render,
        refresh: loadInstalled,
        installFromDetail: installItem,
        openDeepLink,
        cardButtonFor,
        kindBadge,
        supports: gameId => !!(window.ModsService && window.ModsService.supports(gameId))
    };
})();
