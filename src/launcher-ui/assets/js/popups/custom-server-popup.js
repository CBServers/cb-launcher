class CustomServerPopup {
    constructor() {
        this.popup = null;
        this.backdrop = null;
        this.resolver = null;
        this.escHandler = null;
        this.createPopup();
    }

    createPopup() {
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'custom-server-backdrop';
        this.backdrop.style.display = 'none';

        this.popup = document.createElement('div');
        this.popup.className = 'custom-server-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3 class="custom-server-title">Custom Download Server</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="setting-item">
                    <label class="custom-server-label" for="custom-server-input">Server URL</label>
                    <input type="url" id="custom-server-input" class="custom-server-input" placeholder="https://my-mirror.example.com/" autocomplete="off" spellcheck="false" />
                    <span class="custom-server-error" style="display:none;"></span>
                </div>
                <div class="popup-actions">
                    <div style="flex: 1;"></div>
                    <button class="btn-cancel">Cancel</button>
                    <button class="btn-save">Save</button>
                </div>
            </div>
        `;

        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.bindEvents();
    }

    t(key) {
        return window.LauncherI18n ? window.LauncherI18n.t(key) : key;
    }

    refreshTexts() {
        this.popup.querySelector('.custom-server-title').textContent = this.t('popup.customServer.title');
        this.popup.querySelector('.custom-server-label').textContent = this.t('popup.customServer.label');
        this.popup.querySelector('#custom-server-input').placeholder = this.t('popup.customServer.placeholder');
        this.popup.querySelector('.btn-cancel').textContent = this.t('common.cancel');
        this.popup.querySelector('.btn-save').textContent = this.t('common.save');
    }

    bindEvents() {
        const closeBtn = this.popup.querySelector('.popup-close');
        const cancelBtn = this.popup.querySelector('.btn-cancel');
        const saveBtn = this.popup.querySelector('.btn-save');
        const input = this.popup.querySelector('#custom-server-input');

        closeBtn.addEventListener('click', () => this.cancel());
        cancelBtn.addEventListener('click', () => this.cancel());
        saveBtn.addEventListener('click', () => this.handleSave());

        this.backdrop.addEventListener('click', (e) => {
            if (e.target === this.backdrop) {
                this.cancel();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.handleSave();
            }
        });

        input.addEventListener('input', () => {
            this.clearError();
        });
    }

    isVisible() {
        return this.backdrop.style.display !== 'none';
    }

    show(currentUrl) {
        return new Promise((resolve) => {
            this.resolver = resolve;
            this.refreshTexts();
            this.clearError();

            const input = this.popup.querySelector('#custom-server-input');
            input.value = currentUrl || '';

            this.backdrop.style.display = 'flex';

            this.escHandler = (e) => {
                if (e.key === 'Escape' && this.isVisible()) {
                    this.cancel();
                }
            };
            document.addEventListener('keydown', this.escHandler);

            setTimeout(() => {
                input.focus();
                input.select();
            }, 0);
        });
    }

    hide() {
        this.backdrop.style.display = 'none';
        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler);
            this.escHandler = null;
        }
    }

    cancel() {
        this.hide();
        if (this.resolver) {
            const resolve = this.resolver;
            this.resolver = null;
            resolve(undefined);
        }
    }

    showError(message) {
        const errorEl = this.popup.querySelector('.custom-server-error');
        errorEl.textContent = message;
        errorEl.style.display = '';
    }

    clearError() {
        const errorEl = this.popup.querySelector('.custom-server-error');
        errorEl.textContent = '';
        errorEl.style.display = 'none';
    }

    handleSave() {
        const input = this.popup.querySelector('#custom-server-input');
        const value = (input.value || '').trim();

        if (value !== '' && !/^https?:\/\//i.test(value)) {
            this.showError(this.t('popup.customServer.invalidUrl'));
            return;
        }

        this.hide();
        if (this.resolver) {
            const resolve = this.resolver;
            this.resolver = null;
            resolve(value);
        }
    }
}

window.CustomServerPopup = CustomServerPopup;
