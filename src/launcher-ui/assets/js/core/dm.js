// Direct messages, shown inside the CB friends panel. Opening a conversation replaces the friends
// list until you go back, so the page never grows a second scroll region.

(function () {
    const POLL_MS = 4 * 1000;

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }

    let peer = null;          // the open conversation, or null for the list
    let messages = [];
    let conversations = [];
    let unread = 0;
    let timer = null;
    let bound = false;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function name(p) {
        return p.handle ? '@' + p.handle : (p.displayName || t('unknownAccount'));
    }

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

    function messageHtml(m) {
        const style = m.accent ? ` style="color:${escapeHtml(m.accent)}"` : '';
        return `
            <div class="dm-msg" data-person-id="${escapeHtml(m.cbId)}" data-person-handle="${escapeHtml(m.handle)}"
                 data-person-name="${escapeHtml(m.displayName)}">
                <span class="dm-msg-who"${style}>${escapeHtml(m.displayName || m.handle)}</span>
                <span class="dm-msg-text">${escapeHtml(m.text)}</span>
            </div>`;
    }

    function listHtml() {
        if (!conversations.length) return `<div class="dm-empty">${escapeHtml(t('noConversations'))}</div>`;
        return `<div class="dm-list">${conversations.map(conversationHtml).join('')}</div>`;
    }

    function threadHtml() {
        const who = conversations.find(c => c.cbId === peer);
        return `
            <div class="dm-thread">
                <div class="dm-thread-head">
                    <button class="dm-back" id="dm-back">&larr;</button>
                    <span class="dm-thread-name">${escapeHtml(who ? name(who) : '')}</span>
                </div>
                <div class="dm-log" id="dm-log">${messages.map(messageHtml).join('')}</div>
                <div class="dm-compose">
                    <input type="text" id="dm-text" maxlength="300" placeholder="${escapeHtml(t('messagePlaceholder'))}" />
                    <button class="mod-btn is-primary" id="dm-send">${escapeHtml(t('send'))}</button>
                </div>
            </div>`;
    }

    function host() { return document.getElementById('cb-dm'); }

    function render() {
        const el = host();
        if (!el) return;
        el.innerHTML = peer ? threadHtml() : listHtml();
        scrollLog();
    }

    // Patches only the log and the list, so the compose box keeps focus and text while polling.
    function patch() {
        const el = host();
        if (!el) return;
        if (!peer) {
            const list = el.querySelector('.dm-list, .dm-empty');
            if (list) list.outerHTML = listHtml();
            return;
        }
        const log = document.getElementById('dm-log');
        if (log) { log.innerHTML = messages.map(messageHtml).join(''); scrollLog(); }
    }

    function scrollLog() {
        const log = document.getElementById('dm-log');
        if (log) log.scrollTop = log.scrollHeight;
    }

    async function fetchAll() {
        try {
            const [list, thread] = await Promise.all([
                window.executeCommand('cbfriends-get-dm-list'),
                peer ? window.executeCommand('cbfriends-get-dm') : Promise.resolve(null),
            ]);
            conversations = (list && list.conversations) || [];
            unread = (list && list.unread) || 0;
            if (thread) messages = thread.messages || [];
        } catch (error) { /* offline / preview */ }
        if (window.CbFriendsManager && window.CbFriendsManager.refreshBadge) {
            window.CbFriendsManager.refreshBadge();
        }
    }

    async function open(cbId) {
        peer = cbId || null;
        messages = [];
        try { await window.executeCommand('cbfriends-set-dm-peer', { cbId: peer || '' }); } catch (error) { /* preview */ }
        render();
        // The launcher fetches history asynchronously, so catch it as soon as it lands.
        setTimeout(async () => { await fetchAll(); patch(); }, 350);
        setTimeout(async () => { await fetchAll(); patch(); }, 1000);
    }

    async function send() {
        const input = document.getElementById('dm-text');
        const text = input ? input.value.trim() : '';
        if (!text || !peer) return;
        input.value = '';
        try { await window.executeCommand('cbfriends-send-dm', { cbId: peer, text }); } catch (error) { return; }
        setTimeout(async () => { await fetchAll(); patch(); }, 300);
    }

    function bind() {
        if (bound) return;
        const el = host();
        if (!el) return;
        bound = true;

        el.addEventListener('click', (event) => {
            const row = event.target.closest('[data-open]');
            if (row) return open(row.getAttribute('data-open'));
            if (event.target.closest('#dm-back')) return open(null);
            if (event.target.closest('#dm-send')) return send();
        });

        el.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.id === 'dm-text') send();
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
        open(cbId) { bind(); open(cbId); },
        start() {
            if (timer) return;
            fetchAll();
            timer = setInterval(async () => {
                await fetchAll();
                if (document.getElementById('cb-dm')) { bind(); patch(); }
            }, POLL_MS);
        },
        render() { bind(); render(); }
    };
})();
