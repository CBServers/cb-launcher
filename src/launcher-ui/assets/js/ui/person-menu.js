// Right-click menu and profile card for any CB user shown in chat, on the community board, or in the
// friends list. Reuses the library card menu styling so it matches the rest of the launcher.

(function () {
    let menu = null;
    let card = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initials(name) {
        const parts = String(name || '?').trim().split(/\s+/);
        const first = parts[0] ? parts[0][0] : '?';
        const second = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (first + second).toUpperCase();
    }

    function gameName(id) {
        if (!id || !window.GameUtils) return id || '';
        const cfg = window.GameUtils.getGameConfigByUIId(id);
        return (cfg && cfg.displayName) || id;
    }

    function ensureMenu() {
        if (menu) return menu;
        menu = document.createElement('div');
        menu.className = 'library-card-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        document.body.appendChild(menu);
        document.addEventListener('click', hideMenu);
        document.addEventListener('contextmenu', (e) => { if (!menu.contains(e.target)) hideMenu(); });
        window.addEventListener('blur', hideMenu);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
        return menu;
    }

    function hideMenu() {
        if (menu) menu.hidden = true;
    }

    function showMenu(x, y, items) {
        const el = ensureMenu();
        const usable = items.filter(i => i && !i.hidden);
        el.innerHTML = usable.map((item, idx) =>
            `<button type="button" class="library-card-menu-item${item.danger ? ' is-danger' : ''}" role="menuitem" data-idx="${idx}">${escapeHtml(item.label)}</button>`
        ).join('');

        el.style.left = '0px';
        el.style.top = '0px';
        el.hidden = false;

        const rect = el.getBoundingClientRect();
        el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
        el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

        el.querySelectorAll('.library-card-menu-item').forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                const item = usable[parseInt(btn.dataset.idx, 10)];
                hideMenu();
                if (item && item.action) {
                    try { item.action(); } catch (error) { console.error('Person menu action failed:', error); }
                }
            });
        });
    }

    // ---- profile card ----

    function ensureCard() {
        if (card) return card;
        card = document.createElement('div');
        card.className = 'cb-person-overlay';
        card.hidden = true;
        card.addEventListener('click', (event) => { if (event.target === card) hideCard(); });
        document.body.appendChild(card);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(); });
        return card;
    }

    function hideCard() {
        if (card) card.hidden = true;
    }

    function memberSince(seconds) {
        if (!seconds) return '';
        try {
            return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
        } catch (error) {
            return '';
        }
    }

    function relationAction(p) {
        switch (p.relation) {
            case 'self': return `<span class="cb-pending-label">This is you</span>`;
            case 'friend': return `<span class="cb-pending-label">Friends</span>`;
            case 'requested': return `<span class="cb-pending-label">Request sent</span>`;
            case 'incoming': return `<button class="cb-add-btn" data-person-accept="${escapeHtml(p.cbId)}">Accept request</button>`;
            default: return `<button class="cb-add-btn" data-person-add="${escapeHtml(p.handle)}">Add friend</button>`;
        }
    }

    function cardHtml(p, loading) {
        if (loading) {
            return `<div class="cb-person-card"><div class="cb-person-loading">Loading profile…</div></div>`;
        }
        if (!p) {
            return `<div class="cb-person-card"><div class="cb-person-loading">Profile unavailable.</div></div>`;
        }

        const accent = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '';
        const banner = accent ? `style="background:${accent}"` : '';
        const avatar = p.avatarUrl
            ? `<img class="cb-person-avatar-img" src="${escapeHtml(p.avatarUrl)}" alt="" />`
            : `<span class="cb-person-avatar-initials">${escapeHtml(initials(p.displayName || p.handle))}</span>`;
        const presence = p.online
            ? (p.game ? `Playing ${escapeHtml(gameName(p.game))}` : 'Online')
            : 'Offline';
        const since = memberSince(p.createdAt);
        const rows = [
            p.bio ? `<div class="cb-person-bio">${escapeHtml(p.bio)}</div>` : '',
            p.favoriteGame ? `<div class="cb-person-field"><span>Favourite game</span>${escapeHtml(gameName(p.favoriteGame))}</div>` : '',
            since ? `<div class="cb-person-field"><span>Member since</span>${escapeHtml(since)}</div>` : '',
        ].filter(Boolean).join('');

        return `
            <div class="cb-person-card">
                <div class="cb-person-banner" ${banner}></div>
                <div class="cb-person-avatar" ${accent ? `style="border-color:${accent}"` : ''}>${avatar}</div>
                <div class="cb-person-body">
                    <div class="cb-person-name">${escapeHtml(p.displayName || p.handle)}</div>
                    <div class="cb-person-handle">@${escapeHtml(p.handle)}</div>
                    <div class="cb-person-presence" data-status="${p.online ? 'online' : 'offline'}">
                        <span class="friend-status-dot" data-status="${p.online ? (p.game ? 'online' : 'idle') : 'offline'}"></span>${presence}
                    </div>
                    ${rows}
                    <div class="cb-person-actions">${relationAction(p)}</div>
                </div>
            </div>
        `;
    }

    async function showCard(person) {
        const el = ensureCard();
        // Render what the caller already knows, then replace it with the full profile.
        el.innerHTML = cardHtml(person && person.handle ? person : null, !(person && person.handle));
        el.hidden = false;

        if (!person || !person.cbId) return;
        try {
            await window.executeCommand('cbfriends-request-profile', { cbId: person.cbId });
        } catch (error) { return; }

        for (let i = 0; i < 12 && !el.hidden; i++) {
            await new Promise(r => setTimeout(r, 250));
            let res;
            try {
                res = await window.executeCommand('cbfriends-get-viewed-profile');
            } catch (error) { break; }
            if (res && res.profile) {
                if (!el.hidden) el.innerHTML = cardHtml(res.profile, false);
                break;
            }
        }
    }

    function bindCardActions() {
        ensureCard().addEventListener('click', async (event) => {
            const add = event.target.closest('[data-person-add]');
            if (add) {
                const handle = add.getAttribute('data-person-add');
                try {
                    await window.executeCommand('cbfriends-add-friend', { handle });
                    if (window.showToast) window.showToast(`Friend request sent to @${handle}.`, 'success');
                } catch (error) { console.warn('Add friend failed:', error); }
                hideCard();
                return;
            }
            const accept = event.target.closest('[data-person-accept]');
            if (accept) {
                try {
                    await window.executeCommand('cbfriends-accept', { cbId: accept.getAttribute('data-person-accept') });
                    if (window.showToast) window.showToast('Friend request accepted.', 'success');
                } catch (error) { console.warn('Accept failed:', error); }
                hideCard();
            }
        });
    }

    async function addFriend(handle) {
        if (!handle) return;
        try {
            await window.executeCommand('cbfriends-add-friend', { handle });
            if (window.showToast) window.showToast(`Friend request sent to @${handle}.`, 'success');
        } catch (error) {
            console.warn('Add friend failed:', error);
        }
    }

    window.PersonMenu = {
        // person: { cbId, handle, displayName, relation? }; extra: additional menu items.
        open(event, person, extra) {
            if (!person || !person.cbId) return;
            event.preventDefault();
            // Keep it from reaching the document dismiss handler, which would close it immediately.
            event.stopPropagation();
            const isSelf = person.relation === 'self';
            const known = person.relation === 'friend' || person.relation === 'requested';
            const items = [
                { label: 'View profile', action: () => showCard(person) },
                { label: 'Add friend', hidden: isSelf || known || !person.handle, action: () => addFriend(person.handle) },
            ].concat(extra || []);
            showMenu(event.clientX, event.clientY, items);
        },
        showCard,
        init() { bindCardActions(); }
    };

    document.addEventListener('DOMContentLoaded', () => window.PersonMenu.init());
})();
