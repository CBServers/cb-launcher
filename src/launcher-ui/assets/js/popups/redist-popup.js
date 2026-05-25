const isMissingRedist = (p) => p.status !== 'installed' && p.status !== 'completed';

class RedistPopupController {
    constructor() {
        this.backdrop = null;
        this.popup = null;
        this.pollId = null;
        this.create();
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    create() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'component-selection-backdrop redist-popup-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'component-selection-popup redist-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3 class="redist-popup-title"></h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="redist-popup-summary"></div>
                <ul class="redist-popup-list"></ul>
                <div class="popup-actions">
                    <button class="btn-cancel redist-popup-close-btn"></button>
                    <button class="btn-apply redist-popup-install-all"></button>
                </div>
            </div>
        `;
        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) this.hide();
        });
        this.popup.querySelector('.popup-close').addEventListener('click', () => this.hide());
        this.popup.querySelector('.redist-popup-close-btn').addEventListener('click', () => this.hide());
        this.popup.querySelector('.redist-popup-install-all').addEventListener('click', () => this.install());
        this.popup.querySelector('.redist-popup-list').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-install-id]');
            if (btn) this.install([btn.dataset.installId]);
        });
    }

    statusLabel(status, progress) {
        switch (status) {
            case 'installed':
            case 'completed': return this.t('support.redistStatusInstalled');
            case 'pending': return this.t('support.redistStatusPending');
            case 'downloading': return this.t('support.redistStatusDownloading') + ' ' + (progress || 0) + '%';
            case 'installing': return this.t('support.redistStatusInstalling');
            case 'failed': return this.t('support.redistStatusFailed');
            default: return '';
        }
    }

    refreshTexts() {
        this.popup.querySelector('.redist-popup-title').textContent = this.t('support.popup.title');
        this.popup.querySelector('.redist-popup-close-btn').textContent = this.t('common.cancel');
    }

    groupPackages(packages) {
        const groups = [];
        const byId = new Map();
        for (const p of packages) {
            const gid = p.group_id || p.id;
            let group = byId.get(gid);
            if (!group) {
                group = { id: gid, name: p.group_name || p.name, archs: [] };
                byId.set(gid, group);
                groups.push(group);
            }
            group.archs.push(p);
        }
        return groups;
    }

    renderArch(p, running) {
        const busy = running;
        const installed = !isMissingRedist(p);
        const label = installed ? this.t('common.reinstall') : this.t('common.install');
        const btnClass = installed ? 'redist-row-install reinstall' : 'redist-row-install';
        const archLabel = p.arch ? `<span class="redist-arch">${p.arch}</span>` : '';
        const titleAttr = p.error ? ` title="${p.error.replace(/"/g, '&quot;')}"` : '';
        const showBadge = p.status === 'downloading' || p.status === 'installing' || p.status === 'failed';
        const badge = showBadge
            ? `<span class="redist-badge ${p.status}"${titleAttr}>${this.statusLabel(p.status, p.progress)}</span>`
            : '';
        const progressFill = p.status === 'downloading'
            ? `<div class="redist-row-progress" style="width:${p.progress || 0}%"></div>`
            : '';
        return `<div class="redist-arch-cell ${p.status}">
            ${progressFill}
            ${archLabel}
            ${badge}
            <button class="${btnClass}" data-install-id="${p.id}"${busy ? ' disabled' : ''}>${label}</button>
        </div>`;
    }

    render(state) {
        const listEl = this.popup.querySelector('.redist-popup-list');
        const summaryEl = this.popup.querySelector('.redist-popup-summary');
        const installAllBtn = this.popup.querySelector('.redist-popup-install-all');

        const packages = state.packages || [];
        const missing = packages.filter(isMissingRedist).length;
        const installed = packages.length - missing;
        const running = !!state.running;
        const groups = this.groupPackages(packages);

        listEl.innerHTML = groups.map(g => `
            <li class="redist-row">
                <span class="redist-name">${g.name}</span>
                <div class="redist-arch-list">
                    ${g.archs.map(p => this.renderArch(p, running)).join('')}
                </div>
            </li>
        `).join('');

        summaryEl.textContent = state.message
            || this.t('support.redistSummary', { installed, total: packages.length });

        installAllBtn.disabled = running || missing === 0;
        installAllBtn.textContent = missing === 0
            ? this.t('support.redistAllInstalled')
            : this.t('support.installAllMissing');
    }

    async poll() {
        try {
            const state = await window.executeCommand('get-redist-progress');
            if (!state) return null;
            this.render(state);
            if (!state.running && this.pollId) {
                clearInterval(this.pollId);
                this.pollId = null;
            }
            return state;
        } catch (e) {
            console.error('get-redist-progress failed', e);
            return null;
        }
    }

    ensurePolling() {
        if (!this.pollId) this.pollId = setInterval(() => this.poll(), 500);
    }

    async install(ids) {
        try { await window.executeCommand('install-redist', ids ? { ids } : {}); }
        catch (e) { console.error('install-redist failed', e); return; }
        await this.poll();
        this.ensurePolling();
    }

    async show() {
        this.refreshTexts();
        this.backdrop.style.display = 'flex';
        requestAnimationFrame(() => {
            this.backdrop.classList.add('active');
            this.popup.classList.add('active');
        });
        try { await window.executeCommand('refresh-redist'); } catch (e) { console.error(e); }
        const state = await this.poll();
        if (state && state.running) this.ensurePolling();
    }

    hide() {
        this.backdrop.classList.remove('active');
        this.popup.classList.remove('active');
        setTimeout(() => { this.backdrop.style.display = 'none'; }, 250);
    }
}

window.RedistPopup = {
    show() {
        if (!this._instance) this._instance = new RedistPopupController();
        return this._instance.show();
    }
};
