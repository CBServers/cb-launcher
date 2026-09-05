// Right-click menu and profile card for any CB user shown in chat, on the community board, or in the
// friends list. Reuses the library card menu styling so it matches the rest of the launcher.

(function () {

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }
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

    // Drops hidden items, then collapses separators that would lead, trail, or double up.
    function tidy(items) {
        const out = [];
        for (const item of items) {
            if (!item || item.hidden) continue;
            if (item.separator) {
                if (!out.length || out[out.length - 1].separator) continue;
            }
            out.push(item);
        }
        while (out.length && out[out.length - 1].separator) out.pop();
        return out;
    }

    function showMenu(x, y, items) {
        const el = ensureMenu();
        const usable = tidy(items);
        el.innerHTML = usable.map((item, idx) => {
            if (item.separator) return '<div class="library-card-menu-separator"></div>';
            const cls = (item.danger ? ' is-danger' : '') + (item.disabled ? ' is-disabled' : '');
            return `<button type="button" class="library-card-menu-item${cls}" role="menuitem" data-idx="${idx}"${item.disabled ? ' aria-disabled="true"' : ''}>${escapeHtml(item.label)}</button>`;
        }).join('');

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
                if (item && item.action && !item.disabled) {
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
            case 'self': return `<span class="cb-pending-label">${escapeHtml(t('thisIsYou'))}</span>`;
            case 'friend': return `<span class="cb-pending-label">${escapeHtml(t('friendsAlready'))}</span>`;
            case 'requested': return `<span class="cb-pending-label">${escapeHtml(t('requested'))}</span>`;
            case 'incoming': return `<button class="cb-add-btn" data-person-accept="${escapeHtml(p.cbId)}">${escapeHtml(t('acceptRequest'))}</button>`;
            default: return `<button class="cb-add-btn" data-person-add="${escapeHtml(p.handle)}">${escapeHtml(t('addFriend'))}</button>`;
        }
    }

    // "<gametype> on <map> · <server | Private Match | Campaign> · n/m", the second presence line.
    function matchContext(p) {
        if (!p.mapDisplay) return '';
        const parts = [p.gametype ? `${p.gametype} on ${p.mapDisplay}` : p.mapDisplay];
        parts.push(p.serverName || (p.mode === 'sp' ? t('campaign') : t('privateMatch')));
        if (p.maxPlayers > 0) parts.push(`${p.players}/${p.maxPlayers}`);
        return parts.join(' · ');
    }

    function hours(seconds) {
        const h = seconds / 3600;
        if (h < 1) return t('underAnHour');
        return t('hoursPlayed', { n: h < 10 ? h.toFixed(1) : Math.round(h) });
    }

    function ago(ms) {
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 60) return t('minutesAgo', { n: Math.max(1, mins) });
        const h = Math.round(mins / 60);
        return h < 24 ? t('hoursAgo', { n: h }) : t('daysAgo', { n: Math.round(h / 24) });
    }

    // The three games they have actually put time into; anything below an hour is noise.
    function playedRows(playtime) {
        const top = Object.entries(playtime || {})
            .filter(([, seconds]) => seconds >= 60)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        if (!top.length) return '';
        return top.map(([game, seconds]) =>
            `<div class="cb-person-field"><span>${escapeHtml(gameName(game))}</span>${escapeHtml(hours(seconds))}</div>`).join('');
    }

    function cardHtml(p, loading) {
        if (loading) {
            return `<div class="cb-person-card"><div class="cb-person-loading">${escapeHtml(t('loading'))}</div></div>`;
        }
        if (!p) {
            return `<div class="cb-person-card"><div class="cb-person-loading">${escapeHtml(t('profileUnavailable'))}</div></div>`;
        }

        const accent = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '';
        // A custom property, not the background shorthand, or the inline value wipes the overlay.
        const banner = accent ? `style="--card-accent:${accent}"` : '';
        const avatar = p.avatarUrl
            ? `<img class="cb-person-avatar-img" src="${escapeHtml(p.avatarUrl)}" alt="" />`
            : `<span class="cb-person-avatar-initials">${escapeHtml(initials(p.displayName || p.handle))}</span>`;
        const presence = p.online
            ? (p.game ? escapeHtml(t('playing', { game: gameName(p.game) })) : t('online'))
            : t('offline');
        const presenceSub = p.online && p.game && p.mapDisplay ? escapeHtml(matchContext(p)) : '';
        const since = memberSince(p.createdAt);
        const meta = [
            p.favoriteGame ? `<div class="cb-person-field"><span>${escapeHtml(t('favouriteGame'))}</span>${escapeHtml(gameName(p.favoriteGame))}</div>` : '',
            since ? `<div class="cb-person-field"><span>${escapeHtml(t('memberSince'))}</span>${escapeHtml(since)}</div>` : '',
            !p.online && p.lastSeen ? `<div class="cb-person-field"><span>${escapeHtml(t('lastSeen'))}</span>${escapeHtml(ago(p.lastSeen))}</div>` : '',
        ].filter(Boolean).join('');
        const played = playedRows(p.playtime);

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
                    ${presenceSub ? `<div class="cb-person-presence-sub">${presenceSub}</div>` : ''}
                    ${p.bio ? `<div class="cb-person-bio">${escapeHtml(p.bio)}</div>` : ''}
                    ${meta ? `<div class="cb-person-meta">${meta}</div>` : ''}
                    ${played ? `<div class="cb-person-section">
                        <div class="cb-person-section-title">${escapeHtml(t('playtime'))}</div>
                        <div class="cb-person-meta">${played}</div>
                    </div>` : ''}
                </div>
                <div class="cb-person-actions">${relationAction(p)}</div>
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
                    if (window.showToast) window.showToast(t('requestSent', { handle }), 'success');
                } catch (error) { console.warn('Add friend failed:', error); }
                hideCard();
                return;
            }
            const accept = event.target.closest('[data-person-accept]');
            if (accept) {
                try {
                    await window.executeCommand('cbfriends-accept', { cbId: accept.getAttribute('data-person-accept') });
                    if (window.showToast) window.showToast(t('acceptRequest'), 'success');
                } catch (error) { console.warn('Accept failed:', error); }
                hideCard();
            }
        });
    }

    // Blocking is destructive to an existing friendship, so it is confirmed first.
    async function blockUser(person) {
        try {
            const idx = await window.showMessageBox(
                t('blockTitle', { handle: person.handle }), t('blockBody'),
                [{ label: t('blockConfirm'), danger: true }, t('cancel')]);
            if (idx !== 0) return;
            await window.executeCommand('cbfriends-block', { cbId: person.cbId });
            if (window.showToast) window.showToast(t('blockedToast', { handle: person.handle }), 'info');
            hideCard();
        } catch (error) {
            console.warn('Block failed:', error);
        }
    }

    async function reportUser(person) {
        try {
            const idx = await window.showMessageBox(
                t('reportTitle', { handle: person.handle }), t('reportBody'),
                [{ label: t('reportConfirm'), danger: true }, t('cancel')]);
            if (idx !== 0) return;
            await window.executeCommand('cbfriends-report', { cbId: person.cbId, reason: '' });
            if (window.showToast) window.showToast(t('reportedToast'), 'success');
        } catch (error) {
            console.warn('Report failed:', error);
        }
    }

    async function addFriend(handle) {
        if (!handle) return;
        try {
            await window.executeCommand('cbfriends-add-friend', { handle });
            if (window.showToast) window.showToast(t('requestSent', { handle }), 'success');
        } catch (error) {
            console.warn('Add friend failed:', error);
        }
    }

    // A keyboard-activated button has no pointer position, so anchor to the element instead.
    function positionFor(event) {
        let x = event.clientX, y = event.clientY;
        if (!x && !y && event.currentTarget instanceof Element) {
            const rect = (event.target.closest('button') || event.currentTarget).getBoundingClientRect();
            x = rect.left; y = rect.bottom + 4;
        }
        return { x, y };
    }

    window.PersonMenu = {
        // extra: { top, bottom } item groups or an array (bottom); items may set disabled, danger or separator.
        open(event, person, extra) {
            if (!person || !person.cbId) return;
            event.preventDefault();
            // Keep it from reaching the document dismiss handler, which would close it immediately.
            event.stopPropagation();
            const groups = Array.isArray(extra) ? { bottom: extra } : (extra || {});
            const isSelf = person.relation === 'self';
            const known = person.relation === 'friend' || person.relation === 'requested' || person.relation === 'incoming';
            const items = [].concat(groups.top || [], [
                { separator: true },
                { label: t('viewProfile'), action: () => showCard(person) },
                { label: t('message'), hidden: isSelf || person.relation !== 'friend' || !window.DirectMessages,
                  action: () => window.DirectMessages.open(person.cbId) },
                { label: t('addFriend'), hidden: isSelf || known || !person.handle, action: () => addFriend(person.handle) },
                { separator: true },
            ], groups.bottom || [], [
                { label: t('block'), hidden: isSelf, danger: true, action: () => blockUser(person) },
                { label: t('report'), hidden: isSelf, danger: true, action: () => reportUser(person) },
            ]);
            const pos = positionFor(event);
            showMenu(pos.x, pos.y, items);
        },
        // A plain menu at the pointer, for rows that are not CB people (Discord friends).
        showMenuAt(event, items) {
            event.preventDefault();
            event.stopPropagation();
            const pos = positionFor(event);
            showMenu(pos.x, pos.y, items);
        },
        showCard,
        matchContext,
        formatAgo: ago,
        init() { bindCardActions(); }
    };

    document.addEventListener('DOMContentLoaded', () => window.PersonMenu.init());
})();
