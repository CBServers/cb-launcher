// Direct messages, as a dock in the bottom-right corner rather than a page. It stays collapsed to a
// small bar until you need it, so messaging never takes over whatever you were doing.

(function () {
    const POLL_MS = 4 * 1000;

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }

    let peer = null;        // the open conversation, or null for the list
    let expanded = false;   // dock open rather than collapsed to its bar
    let ready = false;      // no CB profile means no dock at all
    let messages = [];
    let conversations = [];
    let unread = 0;
    let myHandle = '';
    let timer = null;
    let bound = false;
    const announced = new Map();
    let primed = false;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function name(p) {
        return p.handle ? '@' + p.handle : (p.displayName || t('unknownAccount'));
    }

    function when(ms) {
        if (!ms) return '';
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return t('justNow');
        if (mins < 60) return t('minutesAgo', { n: mins });
        const hours = Math.round(mins / 60);
        if (hours < 24) return t('hoursAgo', { n: hours });
        return t('daysAgo', { n: Math.round(hours / 24) });
    }

    function mentionsMe(text) {
        if (!myHandle) return false;
        return new RegExp('@' + myHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text || '');
    }

    function host() { return document.getElementById('dm-dock'); }

    function conversationHtml(c) {
        return `
            <div class="dm-row" data-open="${escapeHtml(c.cbId)}">
                <span class="friend-status-dot" data-status="${c.online ? 'online' : 'offline'}"></span>
                <div class="dm-row-main">
                    <div class="dm-row-name">${escapeHtml(name(c))}</div>
                    <div class="dm-row-preview">${escapeHtml(c.preview || '')}</div>
                </div>
                ${c.unread ? `<span class="dm-unread">${c.unread}</span>` : ''}
            </div>`;
    }

    function messageHtml(m, i) {
        const prev = messages[i - 1];
        const grouped = prev && prev.cbId === m.cbId && Math.abs((m.at || 0) - (prev.at || 0)) < 5 * 60000;
        const style = m.accent ? ` style="color:${escapeHtml(m.accent)}"` : '';
        const head = grouped ? '' : `
                <div class="dm-msg-head">
                    <span class="dm-msg-who"${style}>${escapeHtml(m.displayName || m.handle)}</span>
                    <span class="dm-msg-when">${escapeHtml(when(m.at))}</span>
                </div>`;
        return `
            <div class="dm-msg${grouped ? ' is-grouped' : ''}${mentionsMe(m.text) ? ' is-mention' : ''}"
                 data-person-id="${escapeHtml(m.cbId)}" data-person-handle="${escapeHtml(m.handle)}"
                 data-person-name="${escapeHtml(m.displayName)}">
                ${head}
                <div class="dm-msg-text">${escapeHtml(m.text)}</div>
            </div>`;
    }

    function listHtml() {
        return conversations.length
            ? `<div class="dm-list">${conversations.map(conversationHtml).join('')}</div>`
            : `<div class="dm-empty">${escapeHtml(t('noConversations'))}</div>`;
    }

    function bodyHtml() {
        if (!peer) return listHtml();
        return `
            <div class="dm-log" id="dm-log">${messages.map(messageHtml).join('')}</div>
            <div class="dm-compose">
                <input type="text" id="dm-text" maxlength="300" placeholder="${escapeHtml(t('messagePlaceholder'))}" />
                <button class="dm-send" id="dm-send" type="button">${escapeHtml(t('send'))}</button>
            </div>`;
    }

    function titleHtml() {
        if (!peer) return `<span class="dm-title-name">${escapeHtml(t('messages'))}</span>`;
        const who = conversations.find(c => c.cbId === peer);
        return `<button class="dm-back" id="dm-back" type="button">&larr;</button>
                <span class="dm-title-name">${escapeHtml(who ? name(who) : '')}</span>`;
    }

    function render() {
        const el = host();
        if (!el) return;

        if (!ready) { el.innerHTML = ''; el.className = ''; return; }

        el.className = expanded ? 'is-open' : '';
        if (!expanded) {
            el.innerHTML = `
                <button class="dm-tab" id="dm-tab" type="button">
                    <span class="dm-tab-label">${escapeHtml(t('messages'))}</span>
                    ${unread ? `<span class="dm-unread">${unread}</span>` : ''}
                </button>`;
            return;
        }

        el.innerHTML = `
            <div class="dm-panel">
                <div class="dm-panel-head">
                    <div class="dm-title">${titleHtml()}</div>
                    <button class="dm-min" id="dm-min" type="button" title="${escapeHtml(t('minimise'))}">&minus;</button>
                </div>
                ${bodyHtml()}
            </div>`;
        scrollLog();
    }

    // Patches only the moving parts, so the compose box keeps focus and text on the timer.
    function patch() {
        const el = host();
        if (!el || !ready) return;

        // Collapsed, only the count can change; rewriting the bar every tick churns the DOM and
        // drops hover state for nothing.
        if (!expanded) {
            const tab = document.getElementById('dm-tab');
            if (!tab) return render();
            const badge = tab.querySelector('.dm-unread');
            if (unread && badge) badge.textContent = String(unread);
            else if (unread !== (badge ? Number(badge.textContent) : 0)) render();
            return;
        }

        if (peer) {
            const log = document.getElementById('dm-log');
            if (log) { log.innerHTML = messages.map(messageHtml).join(''); scrollLog(); }
            return;
        }
        const list = el.querySelector('.dm-list, .dm-empty');
        if (list) list.outerHTML = listHtml();
    }

    function scrollLog() {
        const log = document.getElementById('dm-log');
        if (log) log.scrollTop = log.scrollHeight;
    }

    async function fetchAll() {
        try {
            const status = await window.executeCommand('cbfriends-get-status');
            ready = !!(status && status.state === 'ready');
            myHandle = (status && status.profile && status.profile.handle) || myHandle;
            if (!ready) { conversations = []; unread = 0; return; }

            const [list, thread] = await Promise.all([
                window.executeCommand('cbfriends-get-dm-list'),
                peer ? window.executeCommand('cbfriends-get-dm') : Promise.resolve(null),
            ]);
            conversations = (list && list.conversations) || [];
            unread = (list && list.unread) || 0;
            if (thread) messages = thread.messages || [];
            announce();
            primed = true;
        } catch (error) { /* offline / preview */ }
        if (window.CbFriendsManager && window.CbFriendsManager.refreshBadge) {
            window.CbFriendsManager.refreshBadge();
        }
    }

    // One toast per conversation per new message, and never for the one already on screen.
    function announce() {
        for (const c of conversations) {
            const showing = expanded && c.cbId === peer;
            if (!c.unread || showing) { announced.set(c.cbId, c.lastId); continue; }
            if (announced.get(c.cbId) === c.lastId) continue;
            announced.set(c.cbId, c.lastId);
            if (!primed) continue;
            window.executeCommand('cbfriends-show-person-notification', {
                cbId: c.cbId, title: name(c), body: c.preview || '',
            }).catch(() => {});
        }
    }

    async function openPeer(cbId) {
        peer = cbId || null;
        messages = [];
        try { await window.executeCommand('cbfriends-set-dm-peer', { cbId: peer || '' }); } catch (error) { /* preview */ }
        render();
        // Fetch once straight away: the launcher usually already has the history by now, and this
        // avoids paying a timer hop before anything is on screen.
        await fetchAll();
        patch();
        if (!messages.length) chase();
    }

    // History is fetched by the launcher in the background, so poll quickly for a moment rather than
    // waiting on the next tick. Stops the instant anything lands.
    function chase(attempts = 12) {
        if (attempts <= 0) return;
        setTimeout(async () => {
            const had = messages.length;
            await fetchAll();
            patch();
            if (messages.length === had) chase(attempts - 1);
        }, 120);
    }

    async function send() {
        const input = document.getElementById('dm-text');
        const text = input ? input.value.trim() : '';
        if (!text || !peer) return;
        input.value = '';
        try { await window.executeCommand('cbfriends-send-dm', { cbId: peer, text }); } catch (error) { return; }
        chase();
    }

    function bind() {
        if (bound) return;
        const el = host();
        if (!el) return;
        bound = true;

        el.addEventListener('click', (event) => {
            if (event.target.closest('#dm-tab')) { expanded = true; return render(); }
            if (event.target.closest('#dm-min')) { expanded = false; return render(); }
            if (event.target.closest('#dm-back')) return openPeer(null);
            if (event.target.closest('#dm-send')) return send();
            const row = event.target.closest('[data-open]');
            if (row) return openPeer(row.getAttribute('data-open'));
        });

        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.id === 'dm-text') send();
            if (event.key === 'Escape') { expanded = false; render(); }
        });

        el.addEventListener('contextmenu', (event) => {
            const m = event.target.closest('[data-person-id]');
            if (!m || !window.PersonMenu) return;
            window.PersonMenu.open(event, {
                cbId: m.getAttribute('data-person-id'),
                handle: m.getAttribute('data-person-handle'),
                displayName: m.getAttribute('data-person-name'),
                relation: 'friend',
            });
        });
    }

    window.DirectMessages = {
        getUnread() { return unread; },
        open(cbId) {
            bind();
            expanded = true;
            openPeer(cbId);
        },
        start() {
            if (timer) return;
            bind();
            fetchAll().then(render);
            timer = setInterval(async () => { await fetchAll(); patch(); }, POLL_MS);
        }
    };
})();
