// Workshop item detail popup: screenshots, description, rating, install.
class ModDetailPopup {
    constructor() {
        this.backdrop = null;
        this.popup = null;
        this.gameId = null;
        this.item = null;
    }

    t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    esc(value) {
        return GameUtils.escapeHtml(value);
    }

    // Steam descriptions are BBCode; escape first, then convert a whitelist.
    bbcodeToHtml(text) {
        let html = this.esc(String(text || ''));

        html = html
            .replace(/\[img\][\s\S]*?\[\/img\]/gi, '')
            .replace(/\[previewicon=[^\]]*\][\s\S]*?\[\/previewicon\]/gi, '')
            .replace(/\[(b|i|u|strike)\]([\s\S]*?)\[\/\1\]/gi, (m, tag, body) => {
                const map = { b: 'strong', i: 'em', u: 'u', strike: 's' };
                return `<${map[tag.toLowerCase()]}>${body}</${map[tag.toLowerCase()]}>`;
            })
            .replace(/\[(h[1-3])\]([\s\S]*?)\[\/\1\]/gi, '<h4>$2</h4>')
            .replace(/\[hr\]\[\/hr\]|\[hr\]/gi, '<hr>')
            .replace(/\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>')
            .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '$1')
            .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (m, url, label) => {
                return /^https?:\/\//i.test(url) ? `<a data-url="${url}">${label}</a>` : label;
            })
            .replace(/\[(olist|list)\]/gi, (m, tag) => tag.toLowerCase() === 'olist' ? '<ol>' : '<ul>')
            .replace(/\[\/(olist)\]/gi, '</ol>')
            .replace(/\[\/(list)\]/gi, '</ul>')
            .replace(/\[\*\]([^\[<\r\n]*)/gi, '<li>$1</li>')
            .replace(/\[\/?[a-z0-9=*#:\/. _-]*\]/gi, '');

        return html.replace(/\r\n|\n/g, '<br>').replace(/(<\/(?:h4|li|ul|ol|blockquote|hr)>)<br>/gi, '$1');
    }

    show(gameId, item) {
        this.close();
        this.gameId = gameId;
        this.item = item;

        this.backdrop = document.createElement('div');
        this.backdrop.className = 'component-selection-backdrop mod-detail-backdrop';
        this.popup = document.createElement('div');
        this.popup.className = 'component-selection-popup mod-detail-popup';
        this.popup.innerHTML = `
            <div class="popup-header">
                <h3>${this.esc(item.title)}</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-content">
                <div class="mod-detail-body">
                    <div class="detection-loading"><div class="spinner"></div><span class="loading-text">${this.esc(this.t('mods.loading'))}</span></div>
                </div>
            </div>`;

        this.backdrop.appendChild(this.popup);
        document.body.appendChild(this.backdrop);

        this.backdrop.addEventListener('click', event => {
            if (event.target === this.backdrop) this.close();
        });
        this.popup.querySelector('.popup-close').addEventListener('click', () => this.close());

        this.backdrop.style.display = 'flex';
        requestAnimationFrame(() => {
            this.backdrop.classList.add('active');
            this.popup.classList.add('active');
        });

        this.load();
    }

    async load() {
        const body = this.popup && this.popup.querySelector('.mod-detail-body');
        if (!body) return;

        let detail;
        try {
            detail = await window.ModsService.getDetails(this.gameId, this.item.id);
        } catch (error) {
            console.error(error);
            body.innerHTML = `<div class="mods-empty">${this.esc(this.t('mods.detailsFailed'))}</div>`;
            return;
        }
        if (!this.popup || !this.popup.isConnected) return;

        this.render(body, detail);
    }

    render(body, detail) {
        const images = [detail.preview, ...detail.screenshots].filter(Boolean);
        const language = window.LauncherI18n ? window.LauncherI18n.getLanguage() : 'en';
        const updated = detail.updatedAt ? new Date(detail.updatedAt * 1000).toLocaleDateString(language) : '';
        const percent = detail.votes ? Math.round(detail.votes.score * 100) : 0;
        const votes = detail.votes ? detail.votes.up + detail.votes.down : 0;

        body.innerHTML = `
            ${images.length ? `<div class="mod-detail-hero"><img src="${this.esc(images[0])}" alt=""></div>` : ''}
            ${images.length > 1 ? `<div class="mod-detail-thumbs">${images.map((url, index) =>
                `<img src="${this.esc(url)}" data-index="${index}" class="${index === 0 ? 'active' : ''}" alt="" loading="lazy">`).join('')}</div>` : ''}
            <div class="mod-detail-meta">
                ${window.ModsView.kindBadge(detail.kind)}
                ${this.item.author ? `<span>${this.esc(this.t('mods.by', { author: this.item.author }))}</span>` : ''}
                <span>${this.esc(this.t('mods.subscribers', { count: GameUtils.formatCount(detail.subscribers) }))}</span>
                <span>${this.esc(GameUtils.formatBytes(detail.size))}</span>
                ${votes ? `<span class="mod-detail-rating">${this.esc(this.t('mods.rating', { percent, votes: GameUtils.formatCount(votes) }))}</span>` : ''}
                ${updated ? `<span>${this.esc(this.t('mods.updatedDate', { date: updated }))}</span>` : ''}
            </div>
            <div class="mod-detail-desc">${this.bbcodeToHtml(detail.description) || this.esc(detail.title)}</div>
            <div class="popup-actions">
                <button class="btn-cancel mod-detail-steam">${this.esc(this.t('mods.viewOnSteam'))}</button>
                <button class="btn-apply mod-detail-install"></button>
            </div>`;

        const hero = body.querySelector('.mod-detail-hero img');
        body.querySelectorAll('.mod-detail-thumbs img').forEach(thumb => {
            thumb.addEventListener('click', () => {
                hero.src = thumb.src;
                body.querySelectorAll('.mod-detail-thumbs img').forEach(other => other.classList.toggle('active', other === thumb));
            });
        });

        body.querySelectorAll('.mod-detail-desc a[data-url]').forEach(link => {
            link.addEventListener('click', () => window.executeCommand('open-url', { url: link.dataset.url }));
        });

        body.querySelector('.mod-detail-steam').addEventListener('click', () => {
            window.executeCommand('open-url', { url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${this.item.id}` });
        });

        this.installButton = body.querySelector('.mod-detail-install');
        this.installButton.addEventListener('click', () => {
            if (!window.ModsView) return;
            const state = window.ModsView.cardButtonFor(this.gameId, this.item.id);
            if (state && state.stateName === 'installing') {
                window.ModsService.cancelInstall(this.gameId);
            } else {
                window.ModsView.installFromDetail(this.gameId, this.item.id);
            }
        });
        this.syncInstallButton();
    }

    // Mirrors the card's install state; ModsView calls this while a transfer runs.
    syncInstallButton(label, disabled) {
        if (!this.installButton || !this.installButton.isConnected) return;
        if (label === undefined && window.ModsView) {
            const state = window.ModsView.cardButtonFor(this.gameId, this.item.id);
            if (!state) return;
            label = state.label;
            disabled = state.disabled;
        }
        this.installButton.textContent = label || this.t('mods.install');
        this.installButton.disabled = !!disabled;
    }

    close() {
        if (!this.backdrop) return;
        this.backdrop.remove();
        this.backdrop = null;
        this.popup = null;
        this.installButton = null;
    }
}

window.ModDetailPopup = new ModDetailPopup();
