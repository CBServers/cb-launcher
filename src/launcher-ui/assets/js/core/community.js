// Community hub: a grid of game rooms plus an all-games room. Each room has an LFG board and a
// chat channel. Polls only while the tab is open, and never rebuilds inputs the user is editing.

(function () {
    const POLL_MS = 6 * 1000;
    const BADGE_POLL_MS = 60 * 1000;
    const ALL = 'all';

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }

    let active = false;
    let timer = null;
    let badgeTimer = null;
    let bound = false;
    let room = null;           // null = hub, otherwise ALL or a game id
    let posts = [];            // LFG posts for the open room
    let allPosts = [];         // every post, for the hub counts
    let chat = [];
    let broadcast = { on: false, game: '', note: '', slots: 0 };
    let profileReady = false;
    let atChatBottom = true;
    let chatHasMore = false;
    let myHandle = '';
    let chatHeads = {};   // room -> newest message id on the server
    let chatSeen = {};    // room -> newest id we have shown the user

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

    function gameConfig(id) {
        return (window.GameUtils && window.GameUtils.getGameConfigByUIId) ? window.GameUtils.getGameConfigByUIId(id) : null;
    }

    function gameName(id) {
        if (id === ALL) return t('allGames');
        const cfg = gameConfig(id);
        return (cfg && cfg.displayName) || id || '';
    }

    function avatarHtml(p) {
        return p.avatarUrl
            ? `<img class="friend-avatar-img" src="${escapeHtml(p.avatarUrl)}" alt="" loading="lazy" />`
            : `<span class="friend-avatar-initials">${escapeHtml(initials(p.displayName || p.handle))}</span>`;
    }

    // True while the user is typing, so a poll never rebuilds the DOM under them.
    function interacting() {
        const body = document.getElementById('community-body');
        const el = document.activeElement;
        return !!(body && el && body.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    }

    function renderNoProfile() {
        return `
            <div class="cb-create" style="max-width:460px">
                <div class="cb-create-title">${escapeHtml(t('communityJoin'))}</div>
                <div class="cb-create-sub">${escapeHtml(t('communityJoinSub'))}</div>
                <button id="community-goto-profile" class="cb-create-btn" type="button">${escapeHtml(t('communityJoin'))}</button>
            </div>
        `;
    }

    // ---- hub ----

    function countFor(id) {
        return id === ALL ? allPosts.length : allPosts.filter(p => p.game === id).length;
    }

    function unreadIn(id) {
        const head = chatHeads[id] || 0;
        return head > (chatSeen[id] || 0);
    }

    function hubCard(id) {
        const cfg = gameConfig(id);
        const count = countFor(id);
        const badge = count
            ? `<span class="community-room-badge">${escapeHtml(t('looking', { count }))}</span>`
            : '';
        const unread = unreadIn(id) ? `<span class="community-unread-dot" title="${escapeHtml(t('newMessages'))}"></span>` : '';
        const art = cfg && cfg.capsulePath
            ? `<img class="library-card-art" src="${escapeHtml(cfg.capsulePath)}" alt="${escapeHtml(gameName(id))}" loading="lazy">`
            : '';
        return `
            <article class="library-card community-room-card" data-room="${escapeHtml(id)}">
                ${art}
                ${badge}
                ${unread}
                <div class="library-card-body">
                    <div class="library-card-title">${escapeHtml(gameName(id))}</div>
                </div>
            </article>
        `;
    }

    function renderHub() {
        const ids = (window.GameUtils && window.GameUtils.getAllGameIds) ? window.GameUtils.getAllGameIds() : [];
        const total = allPosts.length;
        const allCard = `
            <article class="library-card community-room-card community-room-all" data-room="${ALL}">
                <div class="community-all-art"><span class="community-all-glyph">CB</span></div>
                ${total ? `<span class="community-room-badge">${escapeHtml(t('looking', { count: total }))}</span>` : ''}
                ${unreadIn(ALL) ? `<span class="community-unread-dot" title="${escapeHtml(t('newMessages'))}"></span>` : ''}
                <div class="library-card-body">
                    <div class="library-card-title">${escapeHtml(t('allGames'))}</div>
                </div>
            </article>`;
        return `
            <div class="community-hub-lead">${escapeHtml(t('pickRoom'))}</div>
            <div class="library-grid community-room-grid">${allCard}${ids.map(hubCard).join('')}</div>
        `;
    }

    // ---- room ----

    function slotBadge(p) {
        if (!p.slots) return '';
        const full = p.joined >= p.slots;
        return `<span class="community-slot-badge${full ? ' is-full' : ''}">${full ? t('full') : p.joined + '/' + p.slots}</span>`;
    }

    function postRow(p) {
        const isSelf = p.relation === 'self';
        const line = p.note ? escapeHtml(p.note) : (p.game ? escapeHtml(t('playing', { game: gameName(p.game) })) : t('lookingForGroupHead'));
        let action;
        if (isSelf) action = `<button class="cb-ghost-btn" id="community-bc-stop" type="button">${escapeHtml(t('stop'))}</button>`;
        else if (p.iJoined) action = `<span class="cb-pending-label">${escapeHtml(t('joined'))}</span>`;
        else if (p.relation === 'requested') action = `<span class="cb-pending-label">${escapeHtml(t('requested'))}</span>`;
        else action = `<button class="friend-invite-btn" data-community-join="${escapeHtml(p.cbId)}">${escapeHtml(t('join'))}</button>`;

        // The all-games room mixes titles, so tag each row with its game.
        const gameTag = (room === ALL && p.game) ? `<span class="community-game-tag">${escapeHtml(gameName(p.game))}</span>` : '';
        const youTag = isSelf ? `<span class="community-you-tag">${escapeHtml(t('you'))}</span>` : '';
        const status = p.online ? (p.game ? 'online' : 'idle') : 'offline';
        return `
            <div class="friend-row${isSelf ? ' is-self' : ''}" data-status="${status}" data-person-id="${escapeHtml(p.cbId)}" data-person-handle="${escapeHtml(p.handle)}" data-person-name="${escapeHtml(p.displayName || p.handle)}" data-person-relation="${escapeHtml(p.relation || '')}">
                <div class="friend-avatar">${avatarHtml(p)}<span class="friend-status-dot" data-status="${status}"></span></div>
                <div class="friend-row-body">
                    <div class="friend-name">${escapeHtml(p.displayName || p.handle)} <span class="cb-friend-handle">@${escapeHtml(p.handle)}</span> ${gameTag}${youTag}</div>
                    <div class="friend-activity">${line}</div>
                </div>
                <div class="friend-actions">${slotBadge(p)}${action}</div>
            </div>
        `;
    }

    // An empty room is the moment to offer the action, not just report the absence.
    function lfgEmptyHtml() {
        const listed = broadcast.on && broadcast.game === room;
        const line = listed ? t('waitingForOthers') : t('noOneLooking', { game: gameName(room) });
        const cta = (listed || room === ALL) ? '' :
            `<button class="cb-add-btn" id="community-be-first" type="button">${escapeHtml(t('beFirst'))}</button>`;
        return `
            <div class="community-empty">
                <div class="community-empty-line">${escapeHtml(line)}</div>
                ${cta}
            </div>`;
    }

    function lfgListHtml() {
        if (!posts.length) {
            return lfgEmptyHtml();
        }
        // Your own lobby sits at the top of the room you're broadcasting to.
        const ordered = posts.slice().sort((a, b) => (b.relation === 'self') - (a.relation === 'self'));
        return ordered.map(postRow).join('');
    }

    function chatTime(ms) {
        if (!ms) return '';
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return t('justNow');
        if (mins < 60) return t('minutesAgo', { n: mins });
        const hours = Math.round(mins / 60);
        if (hours < 24) return t('hoursAgo', { n: hours });
        return t('daysAgo', { n: Math.round(hours / 24) });
    }

    // Matches @handle on a word boundary, so "@div" does not light up for "@divity".
    function mentionsMe(text) {
        if (!myHandle) return false;
        return new RegExp('@' + myHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text || '');
    }

    function chatListHtml() {
        const more = chatHasMore
            ? `<button class="cb-ghost-btn community-chat-more" id="community-chat-more" type="button">${escapeHtml(t('loadOlder'))}</button>`
            : '';
        if (!chat.length) {
            return more + `<div class="community-chat-empty">${escapeHtml(t('noMessages'))}</div>`;
        }
        return more + chat.map((m, i) => {
            const prev = chat[i - 1];
            // Group runs from one author within a few minutes, so a conversation reads as one block.
            const grouped = prev && prev.cbId === m.cbId && Math.abs((m.at || 0) - (prev.at || 0)) < 5 * 60000;
            const accent = /^#[0-9a-f]{6}$/i.test(m.accent || '') ? ` style="color:${m.accent}"` : '';
            const head = grouped ? '' : `
                <div class="community-chat-head">
                    <span class="community-chat-author"${accent}>${escapeHtml(m.displayName || m.handle)}</span>
                    <span class="community-chat-when">${escapeHtml(chatTime(m.at))}</span>
                </div>`;
            return `
            <div class="community-chat-line${grouped ? ' is-grouped' : ''}${mentionsMe(m.text) ? ' is-mention' : ''}"
                 data-person-id="${escapeHtml(m.cbId)}" data-person-handle="${escapeHtml(m.handle)}" data-person-name="${escapeHtml(m.displayName || m.handle)}">
                ${head}
                <div class="community-chat-text">${escapeHtml(m.text)}</div>
            </div>`;
        }).join('');
    }

    // The all-games room aggregates posts, so it has no post form of its own.
    function postFormHtml() {
        if (room === ALL) {
            return `<div class="community-hub-lead">${escapeHtml(t('postFromGameRoom'))}</div>`;
        }

        const on = broadcast.on && broadcast.game === room;
        const toggle = `
            <label class="cb-switch" title="${escapeHtml(t('lookingForGroup'))}">
                <input type="checkbox" id="community-broadcast-toggle" ${on ? 'checked' : ''}>
                <span class="cb-switch-slider"></span>
            </label>`;

        // Details only mean anything once you are listed, so they stay out of the way until then.
        // Two labelled rows rather than one crowded line, with the action on its own row.
        const details = on ? `
            <div class="community-listing">
                <div class="community-listing-row">
                    <span class="community-listing-label">${escapeHtml(t('needLead'))}</span>
                    <select id="community-bc-slots" class="cdn-select community-slots-select">
                        ${[0, 2, 3, 4, 5, 6, 8, 12].map(n =>
                            `<option value="${n}"${(broadcast.slots || 0) === n ? ' selected' : ''}>${
                                n ? escapeHtml(t('nPlayers', { n })) : escapeHtml(t('anyNumber'))}</option>`).join('')}
                    </select>
                </div>
                <div class="community-listing-row">
                    <span class="community-listing-label">${escapeHtml(t('noteLabel'))}</span>
                    <input id="community-bc-note" class="community-listing-note" type="text" maxlength="120"
                        value="${escapeHtml(broadcast.note || '')}" placeholder="${escapeHtml(t('notePlaceholder'))}" />
                </div>
                <div class="community-listing-foot">
                    <span class="community-broadcast-expiry">${escapeHtml(t('broadcastExpiry'))}</span>
                    <button id="community-bc-update" class="cb-ghost-btn" type="button">${escapeHtml(t('update'))}</button>
                </div>
            </div>` : '';

        return `
            <div class="community-broadcast-card${on ? ' is-on' : ''}">
                <div class="community-broadcast-head">
                    <div>
                        <div class="community-broadcast-title">
                            ${on ? `<span class="community-live-dot"></span>${escapeHtml(t('listedIn', { game: gameName(room) }))}` : escapeHtml(t('lookingForGroup'))}
                        </div>
                        <div class="community-broadcast-sub">${escapeHtml(on ? t('discoverableSub') : t('privateSub'))}</div>
                    </div>
                    ${toggle}
                </div>
                ${details}
            </div>
        `;
    }

    function renderRoom() {
        const cfg = room === ALL ? null : gameConfig(room);
        const hero = cfg && cfg.heroImagePath
            ? `<img class="community-hero-art" src="${escapeHtml(cfg.heroImagePath)}" alt="" />`
            : '';
        return `
            <div class="community-room-header">
                ${hero}
                <button class="cb-ghost-btn community-back" id="community-back" type="button">${escapeHtml(t('back'))}</button>
                <div class="community-room-title">${escapeHtml(gameName(room))}</div>
            </div>
            <div class="community-room-body">
                <div class="community-room-main">
                    ${postFormHtml()}
                    <div class="cb-section-head">${escapeHtml(t('lookingForGroupHead'))}
                        <span class="friends-group-count" id="community-lfg-count"${posts.length ? '' : ' style="display:none"'}>${posts.length}</span></div>
                    <div class="friends-list" id="community-lfg">${lfgListHtml()}</div>
                </div>
                <div class="community-chat">
                    <div class="cb-section-head">${escapeHtml(t('chat', { game: gameName(room) }))}</div>
                    <div class="community-chat-log" id="community-chat-log">${chatListHtml()}</div>
                    <div class="community-chat-input">
                        <input id="community-chat-text" class="cb-create-input" type="text" maxlength="300" placeholder="${escapeHtml(t('chatPlaceholder', { game: gameName(room) }))}" />
                        <span class="community-chat-count" id="community-chat-count"></span>
                        <button id="community-chat-send" class="cb-add-btn" type="button">${escapeHtml(t('send'))}</button>
                    </div>
                </div>
            </div>
        `;
    }

    function render() {
        const body = document.getElementById('community-body');
        if (!body) return;
        if (!profileReady) { body.innerHTML = renderNoProfile(); return; }
        body.innerHTML = room ? renderRoom() : renderHub();
        if (room) scrollChat();
    }

    function scrollChat() {
        const log = document.getElementById('community-chat-log');
        if (log && atChatBottom) log.scrollTop = log.scrollHeight;
    }

    // ---- data ----

    async function checkProfile() {
        try {
            const status = await window.executeCommand('cbfriends-get-status');
            profileReady = !!(status && status.state === 'ready');
            myHandle = (status && status.profile && status.profile.handle) || myHandle;
        } catch (error) {
            profileReady = false;
        }
    }

    // Last-seen ids live in launcher properties, so unread survives a restart.
    async function loadSeen() {
        try {
            const raw = await window.executeCommand('get-property', PROPERTY_KEYS.LAUNCHER.CB_CHAT_SEEN);
            chatSeen = raw ? JSON.parse(raw) : {};
        } catch (error) { chatSeen = {}; }
    }

    function saveSeen() {
        window.executeCommand('set-property', {
            [PROPERTY_KEYS.LAUNCHER.CB_CHAT_SEEN]: JSON.stringify(chatSeen),
        }).catch(() => {});
    }

    // Standing in a room is what marks it read.
    function markRead() {
        if (!room) return;
        const head = chatHeads[room] || 0;
        const newest = chat.length ? chat[chat.length - 1].id : 0;
        const seen = Math.max(head, newest);
        if (seen && chatSeen[room] !== seen) {
            chatSeen[room] = seen;
            saveSeen();
        }
    }

    function anyUnread() {
        return Object.keys(chatHeads).some(id => (chatHeads[id] || 0) > (chatSeen[id] || 0));
    }

    async function fetchData() {
        if (!profileReady) return;
        try {
            const [lfgRes, bcRes, chatRes, headRes] = await Promise.all([
                window.executeCommand('cbfriends-get-lfg'),
                window.executeCommand('cbfriends-get-broadcast'),
                room ? window.executeCommand('cbfriends-get-chat') : Promise.resolve(null),
                window.executeCommand('cbfriends-get-chat-heads'),
            ]);
            chatHeads = (headRes && headRes.rooms) || chatHeads;
            allPosts = (lfgRes && lfgRes.posts) || [];
            posts = (room && room !== ALL) ? allPosts.filter(p => p.game === room) : allPosts;
            broadcast = bcRes || broadcast;
            if (chatRes) { chat = chatRes.messages || []; chatHasMore = !!chatRes.hasMore; }
            markRead();
        } catch (error) {
            allPosts = []; posts = [];
        }
    }

    // Full rebuild, used on open and after user actions but never on the timer.
    async function refresh() {
        if (!active) return;
        await checkProfile();
        await fetchData();
        render();
    }

    // Timer tick: patches the live lists in place. These hold no inputs, so they stay live even while
    // the user is typing; only a full rebuild is deferred until they finish.
    async function pollTick() {
        if (!active) return;
        await checkProfile();
        if (!profileReady) { if (!interacting()) render(); return; }
        await fetchData();

        const list = document.getElementById('community-lfg');
        const log = document.getElementById('community-chat-log');
        if (!room || !list) {
            if (!interacting()) render();
            return;
        }

        list.innerHTML = lfgListHtml();
        const count = document.getElementById('community-lfg-count');
        if (count) {
            count.textContent = posts.length;
            count.style.display = posts.length ? '' : 'none';
        }

        if (log) {
            atChatBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
            log.innerHTML = chatListHtml();
            scrollChat();
        }
    }

    // ---- actions ----

    async function openRoom(next) {
        room = next;
        chat = [];
        atChatBottom = true;
        try {
            await window.executeCommand('cbfriends-set-chat-room', { room: next || '' });
            await window.executeCommand('cbfriends-set-lfg-filter', { game: '' });
        } catch (error) { /* preview */ }
        refresh();
        // The launcher fetches the room's history asynchronously, so catch it as soon as it lands
        // instead of waiting for the next tick.
        if (next) {
            setTimeout(pollTick, 350);
            setTimeout(pollTick, 1000);
        }
    }

    async function applyBroadcast(on) {
        const noteEl = document.getElementById('community-bc-note');
        const slotsEl = document.getElementById('community-bc-slots');
        const note = noteEl ? noteEl.value.trim() : '';
        const slots = slotsEl && slotsEl.value ? Math.max(0, Math.min(16, parseInt(slotsEl.value, 10) || 0)) : 0;
        broadcast = { on, game: room, note, slots };
        try {
            await window.executeCommand('cbfriends-set-broadcast', { on, game: room, note, slots });
            if (window.showToast) {
                window.showToast(on ? t('listedIn', { game: gameName(room) }) : t('broadcastOff'), on ? 'success' : 'info');
            }
            setTimeout(refresh, 400);
        } catch (error) {
            console.warn('Broadcast toggle failed:', error);
        }
        render();
    }

    async function sendChat() {
        const input = document.getElementById('community-chat-text');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        atChatBottom = true;
        try {
            await window.executeCommand('cbfriends-send-chat', { room, text });
            // The launcher posts then re-polls, so check twice rather than racing that round trip.
            setTimeout(pollTick, 400);
            setTimeout(pollTick, 1200);
        } catch (error) {
            console.warn('Chat send failed:', error);
        }
    }

    async function joinLfg(cbId) {
        try {
            await window.executeCommand('cbfriends-lfg-join', { cbId });
            if (window.showToast) window.showToast(t('joinedLfg'), 'success');
            setTimeout(refresh, 400);
        } catch (error) {
            console.warn('Join failed:', error);
        }
    }

    function bind() {
        if (bound) return;
        const body = document.getElementById('community-body');
        if (!body) return;
        bound = true;

        body.addEventListener('click', (event) => {
            const t = event.target;
            if (t.closest('#community-goto-profile')) {
                const friends = document.getElementById('friends');
                if (friends) friends.click();
                return;
            }
            if (t.closest('#community-back')) return openRoom(null);
            if (t.closest('#community-be-first')) return applyBroadcast(true);
            if (t.closest('#community-bc-update')) return applyBroadcast(true);
            if (t.closest('#community-bc-stop')) return applyBroadcast(false);
            if (t.closest('#community-chat-send')) return sendChat();
            if (t.closest('#community-chat-more')) {
                // Keep the scroll anchored to what the user was reading, not the newly prepended page.
                atChatBottom = false;
                window.executeCommand('cbfriends-load-older-chat').catch(() => {});
                setTimeout(pollTick, 500);
                return;
            }
            const join = t.closest('[data-community-join]');
            if (join) return joinLfg(join.getAttribute('data-community-join'));
            const card = t.closest('[data-room]');
            if (card) return openRoom(card.getAttribute('data-room'));
        });

        body.addEventListener('change', (event) => {
            if (event.target.id === 'community-broadcast-toggle') applyBroadcast(event.target.checked);
        });

        body.addEventListener('contextmenu', (event) => {
            const el = event.target.closest('[data-person-id]');
            if (!el || !window.PersonMenu) return;
            window.PersonMenu.open(event, {
                cbId: el.getAttribute('data-person-id'),
                handle: el.getAttribute('data-person-handle'),
                displayName: el.getAttribute('data-person-name'),
                relation: el.getAttribute('data-person-relation') || '',
            });
        });

        body.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.id === 'community-chat-text') sendChat();
        });

        body.addEventListener('input', (event) => {
            if (event.target.id !== 'community-chat-text') return;
            const count = document.getElementById('community-chat-count');
            const left = 300 - event.target.value.length;
            // Only worth showing as the cap approaches; a counter on an empty box is clutter.
            if (count) count.textContent = left <= 60 ? String(left) : '';
        });
    }

    // Counts the board while the tab is closed, so the sidebar can say someone is looking.
    async function pollBadge() {
        const nav = document.getElementById('community');
        const badge = document.getElementById('community-badge');
        if (!badge) return;
        if (active || !nav || nav.style.display === 'none') { badge.style.display = 'none'; return; }

        await checkProfile();
        let count = 0;
        if (profileReady) {
            try {
                const [res, headRes] = await Promise.all([
                    window.executeCommand('cbfriends-get-lfg'),
                    window.executeCommand('cbfriends-get-chat-heads'),
                ]);
                count = ((res && res.posts) || []).length;
                chatHeads = (headRes && headRes.rooms) || chatHeads;
            } catch (error) { count = 0; }
        }
        badge.textContent = String(count);
        badge.style.display = count > 0 ? '' : 'none';
        nav.classList.toggle('has-unread', anyUnread());
    }

    window.CommunityManager = {
        startBadgePolling() {
            if (badgeTimer) return;
            loadSeen().then(pollBadge);
            badgeTimer = setInterval(pollBadge, BADGE_POLL_MS);
        },
        setActive(on) {
            active = on;
            bind();
            window.executeCommand('cbfriends-set-community-active', { active: on }).catch(() => {});
            if (!on) {
                window.executeCommand('cbfriends-set-chat-room', { room: '' }).catch(() => {});
            }
            if (on) {
                // Leaving the tab clears the launcher's room, so re-assert it when coming back to
                // one that's still open, or its chat would never be polled.
                if (room) {
                    window.executeCommand('cbfriends-set-chat-room', { room }).catch(() => {});
                    setTimeout(pollTick, 350);
                    setTimeout(pollTick, 1000);
                }
                refresh();
                if (!timer) timer = setInterval(pollTick, POLL_MS);
            } else if (timer) {
                clearInterval(timer);
                timer = null;
            }
            pollBadge();
        }
    };
})();
