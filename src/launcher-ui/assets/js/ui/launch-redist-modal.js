class LaunchRedistModalController {
    constructor() {
        this.backdrop = null;
        this.popup = null;
        this.resolver = null;
        this.create();
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    create() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'component-selection-backdrop launch-redist-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'component-selection-popup launch-redist-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3 class="launch-redist-title"></h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <p class="launch-redist-body"></p>
                <ul class="launch-redist-list"></ul>
                <div class="popup-actions">
                    <button class="btn-cancel launch-redist-cancel-btn"></button>
                    <button class="btn-apply launch-redist-install-btn"></button>
                </div>
            </div>
        `;
        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) this.resolve(false);
        });
        this.popup.querySelector('.popup-close').addEventListener('click', () => this.resolve(false));
        this.popup.querySelector('.launch-redist-cancel-btn').addEventListener('click', () => this.resolve(false));
        this.popup.querySelector('.launch-redist-install-btn').addEventListener('click', () => this.resolve(true));
    }

    show(missingGroups, gameDisplayName) {
        this.popup.querySelector('.launch-redist-title').textContent = this.t('installer.missingRedistTitle');
        this.popup.querySelector('.launch-redist-body').textContent = this.t('installer.missingRedistBody', { gameName: gameDisplayName || '' });
        this.popup.querySelector('.launch-redist-cancel-btn').textContent = this.t('common.cancel');
        this.popup.querySelector('.launch-redist-install-btn').textContent = this.t('installer.installAndLaunch');

        const listEl = this.popup.querySelector('.launch-redist-list');
        listEl.innerHTML = (missingGroups || []).map(g => {
            const name = (g.group_name || '').replace(/</g, '&lt;');
            return `<li class="launch-redist-row">${name}</li>`;
        }).join('');

        this.backdrop.style.display = 'flex';
        requestAnimationFrame(() => {
            this.backdrop.classList.add('active');
            this.popup.classList.add('active');
        });

        return new Promise((resolve) => { this.resolver = resolve; });
    }

    resolve(value) {
        const r = this.resolver;
        this.resolver = null;
        this.backdrop.classList.remove('active');
        this.popup.classList.remove('active');
        setTimeout(() => { this.backdrop.style.display = 'none'; }, 250);
        if (r) r(value);
    }
}

window.LaunchRedistModal = {
    show(missingGroups, gameDisplayName) {
        if (!this._instance) this._instance = new LaunchRedistModalController();
        return this._instance.show(missingGroups, gameDisplayName);
    }
};
