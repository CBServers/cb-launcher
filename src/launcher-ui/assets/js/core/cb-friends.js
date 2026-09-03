// The CB Friends sub-tab: profile, friend graph, and game invites. The Discord panel is untouched.

(function () {
    const POLL_INTERVAL_MS = 20 * 1000;
    const VISIBLE_POLL_MS = 5 * 1000;   // while the CB panel is open
    const CREATING_POLL_MS = 1500;
    const HANDLE_RE = /^[a-z0-9_]{2,32}$/i;

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }

    let started = false;
    let activeSource = 'discord';
    let creatingTimer = null;
    let lastState = 'unknown';
    let lastStatus = null;
    let editingProfile = false;
    let myJoinable = false; // we're hosting a joinable match => can invite
    let friends = { friends: [], incoming: [], outgoing: [] };
    let playedWith = [];
    const people = new Map(); // cbId -> { person, relation }, rebuilt on every list render
    const shownCbInvites = new Set();
    const announcedRequests = new Set();
    let requestsPrimed = false; // the first pass only records, so a cold start stays quiet

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

    function discordProfile() {
        if (window.AppViews && typeof window.AppViews.getFriendsState === 'function') {
            const s = window.AppViews.getFriendsState();
            return (s && s.status === 'linked' && s.profile) ? s.profile : null;
        }
        return null;
    }

    function panelVisible() {
        const page = document.getElementById('friends-page');
        const panel = document.getElementById('friends-cb-panel');
        return !!page && page.style.display !== 'none' && !!panel && panel.style.display !== 'none';
    }

    // True while the user is typing, so a poll never rebuilds the DOM under them.
    function interacting() {
        const panel = document.getElementById('friends-cb-panel');
        const el = document.activeElement;
        return !!(panel && el && panel.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    }

    function switchSource(source) {
        activeSource = source;
        const discord = document.getElementById('friends-discord-panel');
        const cb = document.getElementById('friends-cb-panel');
        if (discord) discord.style.display = source === 'discord' ? '' : 'none';
        if (cb) cb.style.display = source === 'cb' ? '' : 'none';
        document.querySelectorAll('.friends-source-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-source') === source);
        });
        if (source === 'cb') refresh();
    }

    // ---- profile ----

    // The service's published presence, with the frontend's running game as a fallback.
    function ownPresence() {
        const me = (lastStatus && lastStatus.presence) || {};
        const game = me.game || (window.GameStateManager && window.GameStateManager.runningGameId) || '';
        return Object.assign({}, me, { game });
    }

    function matchContext(p) {
        return window.PersonMenu ? window.PersonMenu.matchContext(p) : '';
    }

    function renderProfileCard(profile) {
        const avatar = profile.avatarUrl
            ? `<img class="cb-profile-avatar-img" src="${escapeHtml(profile.avatarUrl)}" alt="" />`
            : `<span class="cb-profile-avatar-initials">${escapeHtml(initials(profile.displayName || profile.handle))}</span>`;
        const handle = profile.handle ? '@' + escapeHtml(profile.handle) : '';
        const me = ownPresence();
        const game = me.game;
        const chip = game && me.joinable ? `<span class="friend-chip" data-kind="joinable">${escapeHtml(t('joinable'))}</span>` : '';
        const sub = game ? matchContext(me) : '';
        const activity = game
            ? `<div class="cb-profile-activity"><span class="friend-status-dot" data-status="online"></span>${escapeHtml(t("playing", { game: gameName(game) }))}${chip}</div>`
              + (sub ? `<div class="cb-profile-activity-sub">${escapeHtml(sub)}</div>` : '')
            : `<div class="cb-profile-activity is-idle"><span class="friend-status-dot" data-status="idle"></span>${escapeHtml(t('online'))}</div>`;
        return `
            <div class="cb-profile-card">
                <div class="cb-profile-avatar">
                    ${avatar}
                    <span class="friend-status-dot cb-profile-dot" data-status="${game ? 'online' : 'idle'}"></span>
                </div>
                <div class="cb-profile-body">
                    <div class="cb-profile-name">${escapeHtml(profile.displayName || profile.handle || t('displayName'))}</div>
                    <div class="cb-profile-handle">${handle}</div>
                    ${activity}
                </div>
                <div class="cb-profile-actions">
                    <button class="cb-ghost-btn" id="cb-view-btn" type="button">${escapeHtml(t('viewProfile'))}</button>
                    <button class="cb-ghost-btn" id="cb-edit-btn" type="button">${escapeHtml(t('edit'))}</button>
                    <button class="cb-profile-recovery-btn" id="cb-recovery-btn" type="button">${escapeHtml(t('recoveryCode'))}</button>
                </div>
            </div>
        `;
    }

    function gameOptions(selected) {
        if (!window.GameUtils || typeof window.GameUtils.getAllGameIds !== 'function') return '';
        return window.GameUtils.getAllGameIds().map(id =>
            `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(gameName(id))}</option>`).join('');
    }

    function renderEditForm(profile) {
        const accent = /^#[0-9a-f]{6}$/i.test(profile.accent || '') ? profile.accent : '#6C63FF';
        return `
            <div class="cb-profile-card cb-profile-edit">
                <div class="cb-edit-fields">
                    <label class="cb-create-label">${escapeHtml(t('displayName'))}</label>
                    <input id="cb-edit-name" class="cb-create-input" type="text" maxlength="64"
                        value="${escapeHtml(profile.displayName || '')}" autocomplete="off" />
                    <label class="cb-create-label">${escapeHtml(t('handle'))}</label>
                    <div class="cb-create-handle">
                        <span class="cb-create-at">@</span>
                        <input id="cb-edit-handle" class="cb-create-input" type="text" maxlength="32"
                            value="${escapeHtml(profile.handle || '')}" spellcheck="false" autocomplete="off" />
                    </div>
                    <label class="cb-create-label">${escapeHtml(t('avatarUrl'))}</label>
                    <input id="cb-edit-avatar" class="cb-create-input" type="text" maxlength="512"
                        value="${escapeHtml(profile.avatarUrl || '')}" placeholder="https://..." spellcheck="false" autocomplete="off" />
                    <div class="cb-create-hint">${escapeHtml(t('avatarHint'))}</div>
                    <label class="cb-create-label">${escapeHtml(t('aboutMe'))}</label>
                    <input id="cb-edit-bio" class="cb-create-input" type="text" maxlength="200"
                        value="${escapeHtml(profile.bio || '')}" placeholder="${escapeHtml(t('aboutMePlaceholder'))}" autocomplete="off" />
                    <label class="cb-create-label">${escapeHtml(t('favouriteGame'))}</label>
                    <select id="cb-edit-game" class="cb-create-input">
                        <option value="">${escapeHtml(t('none'))}</option>
                        ${gameOptions(profile.favoriteGame || '')}
                    </select>
                    <label class="cb-create-label">${escapeHtml(t('profileColour'))}</label>
                    <div class="cb-accent-row">
                        <input id="cb-edit-accent" type="color" value="${escapeHtml(accent)}" />
                        <span class="cb-create-hint" style="margin:0">${escapeHtml(t('profileColourHint'))}</span>
                    </div>
                </div>
                <div class="cb-edit-actions">
                    <button id="cb-edit-save" class="cb-add-btn" type="button">${escapeHtml(t('save'))}</button>
                    <button id="cb-edit-cancel" class="cb-ghost-btn" type="button">${escapeHtml(t('cancel'))}</button>
                </div>
            </div>
        `;
    }

    function renderCreateForm(error) {
        const dp = discordProfile();
        const suggestedName = dp ? dp.displayName : '';
        const linkedNote = dp
            ? t('linkedNote')
            : t('unlinkedNote');
        const errorHtml = error ? `<div class="cb-create-error">${escapeHtml(error)}</div>` : '';
        return `
            <div class="cb-create">
                <div class="cb-create-title">Create your CB profile</div>
                <div class="cb-create-sub">A launcher-native identity so friends work even without Discord open.</div>
                ${errorHtml}
                <label class="cb-create-label">${escapeHtml(t('handle'))}</label>
                <div class="cb-create-handle">
                    <span class="cb-create-at">@</span>
                    <input id="cb-handle-input" class="cb-create-input" type="text" maxlength="32"
                        placeholder="yourname" autocomplete="off" spellcheck="false" />
                </div>
                <div class="cb-create-hint">${escapeHtml(t('handleHint'))}</div>
                <label class="cb-create-label">${escapeHtml(t('displayName'))}</label>
                <input id="cb-name-input" class="cb-create-input" type="text" maxlength="64"
                    placeholder="Display name" value="${escapeHtml(suggestedName)}" autocomplete="off" />
                <div class="cb-create-note">${escapeHtml(linkedNote)}</div>
                <button id="cb-create-btn" class="cb-create-btn" type="button">${escapeHtml(t('createBtn'))}</button>
            </div>
        `;
    }

    // ---- friends ----

    // First line: what they are doing. Offline rows carry "last seen" when the worker knows it.
    function presenceLabel(p) {
        if (p.online) return p.game ? t('playing', { game: gameName(p.game) }) : t('online');
        if (p.lastSeen && window.PersonMenu) return t('lastSeenAgo', { when: window.PersonMenu.formatAgo(p.lastSeen) });
        return t('offline');
    }

    // Second line: the match, only while there is one.
    function presenceSub(p) {
        return p.online && p.game ? matchContext(p) : '';
    }

    function presenceChip(p) {
        if (!p.online || !p.game) return '';
        if (p.sameMatch) return `<span class="friend-chip" data-kind="same">${escapeHtml(t('inYourMatch'))}</span>`;
        if (p.joinable) return `<span class="friend-chip" data-kind="joinable">${escapeHtml(t('joinable'))}</span>`;
        if (p.openable) return `<span class="friend-chip" data-kind="open">${escapeHtml(t('openMatch'))}</span>`;
        return '';
    }

    // In-game first, then idle, then offline by most recently seen.
    function presenceRank(p) {
        if (p.online) return p.game ? 0 : 1;
        return 2;
    }
    function sortByPresence(list) {
        return list.slice().sort((a, b) => presenceRank(a) - presenceRank(b) || (b.lastSeen || 0) - (a.lastSeen || 0));
    }

    function personRow(p, relation, actionsHtml) {
        people.set(p.cbId, { person: p, relation });
        const status = p.online ? (p.game ? 'online' : 'idle') : 'offline';
        const avatar = p.avatarUrl
            ? `<img class="friend-avatar-img" src="${escapeHtml(p.avatarUrl)}" alt="" loading="lazy" />`
            : `<span class="friend-avatar-initials">${escapeHtml(initials(p.displayName || p.handle))}</span>`;
        const sub = presenceSub(p);
        return `
            <div class="friend-row" data-status="${status}" data-person-id="${escapeHtml(p.cbId)}" data-person-handle="${escapeHtml(p.handle)}" data-person-name="${escapeHtml(p.displayName || p.handle)}" data-person-relation="${escapeHtml(relation)}">
                <div class="friend-avatar">
                    ${avatar}
                    <span class="friend-status-dot" data-status="${status}"></span>
                </div>
                <div class="friend-row-body">
                    <div class="friend-name">${escapeHtml(p.displayName || p.handle)} <span class="cb-friend-handle">@${escapeHtml(p.handle)}</span>${presenceChip(p)}</div>
                    <div class="friend-activity">${escapeHtml(presenceLabel(p))}</div>
                    ${sub ? `<div class="friend-activity-sub">${escapeHtml(sub)}</div>` : ''}
                </div>
                <div class="friend-actions">
                    ${actionsHtml || ''}
                    <button class="friend-more-btn" type="button" data-cb-more="${escapeHtml(p.cbId)}" title="${escapeHtml(t('more'))}" aria-label="${escapeHtml(t('more'))}">&#8943;</button>
                </div>
            </div>
        `;
    }

    // Inline row actions are the live ones only; everything else lives in the menu.
    function friendActions(p) {
        if (p.sameMatch) return '';
        const btns = [];
        if (p.joinable || p.openable) {
            const label = p.joinable ? t('join') : t('askToJoin');
            btns.push(`<button class="friend-join-btn" data-cb-join="${escapeHtml(p.cbId)}">${escapeHtml(label)}</button>`);
        }
        if (myJoinable && p.online) {
            btns.push(`<button class="friend-invite-btn" data-cb-invite="${escapeHtml(p.cbId)}">${escapeHtml(t('invite'))}</button>`);
        }
        return btns.join('');
    }

    async function confirmRemove(p) {
        try {
            const idx = await window.showMessageBox(
                t('removeTitle', { handle: p.handle }), t('removeBody'),
                [{ label: t('removeConfirm'), danger: true }, t('cancel')]);
            if (idx !== 0) return;
        } catch (error) { return; }
        friendAction('cbfriends-remove', p.cbId);
    }

    // Menu items for a row: session actions on top, relationship actions beside block/report.
    function menuItemsFor(p, relation) {
        const top = [];
        const bottom = [];
        if (relation === 'friend') {
            const live = p.online && p.game;
            if (live && !p.sameMatch && (p.joinable || p.openable)) {
                top.push({ label: t(p.joinable ? 'join' : 'askToJoin'), action: () => friendAction('cbfriends-request-join', p.cbId) });
            }
            if (p.online && !p.sameMatch) {
                // Greyed rather than hidden: the reason is on our side and obvious.
                top.push({ label: t('invite'), disabled: !myJoinable, action: () => friendAction('cbfriends-invite-friend', p.cbId) });
            }
            bottom.push({ label: t('remove'), danger: true, action: () => confirmRemove(p) });
        } else if (relation === 'incoming') {
            top.push({ label: t('accept'), action: () => friendAction('cbfriends-accept', p.cbId) });
            top.push({ label: t('decline'), action: () => friendAction('cbfriends-decline', p.cbId) });
        } else if (relation === 'requested') {
            bottom.push({ label: t('cancelRequest'), action: () => friendAction('cbfriends-cancel', p.cbId) });
        }
        return { top, bottom };
    }

    function openRowMenu(event, cbId) {
        const entry = people.get(cbId);
        if (!entry || !window.PersonMenu) return;
        const { person, relation } = entry;
        window.PersonMenu.open(event, {
            cbId: person.cbId, handle: person.handle, displayName: person.displayName, relation,
        }, menuItemsFor(person, relation));
    }

    function renderFriendsSection() {
        const addRow = `
            <div class="cb-add-row">
                <div class="cb-create-handle cb-add-handle">
                    <span class="cb-create-at">@</span>
                    <input id="cb-add-input" class="cb-create-input" type="text" maxlength="32"
                        placeholder="${escapeHtml(t('addByHandle'))}" autocomplete="off" spellcheck="false" />
                </div>
                <button id="cb-add-btn" class="cb-add-btn" type="button">${escapeHtml(t('add'))}</button>
            </div>
        `;

        let sections = '';
        people.clear();

        if (friends.incoming.length) {
            const rows = friends.incoming.map(p => personRow(p, 'incoming', `
                    <button class="friend-invite-btn" data-cb-accept="${escapeHtml(p.cbId)}">${escapeHtml(t('accept'))}</button>
                    <button class="cb-ghost-btn" data-cb-decline="${escapeHtml(p.cbId)}">${escapeHtml(t('decline'))}</button>`)).join('');
            sections += `<div class="cb-section-head">${escapeHtml(t('requests'))} <span class="friends-group-count">${friends.incoming.length}</span></div>${rows}`;
        }

        if (friends.friends.length) {
            const rows = sortByPresence(friends.friends).map(p => personRow(p, 'friend', friendActions(p))).join('');
            sections += `<div class="cb-section-head">${escapeHtml(t('friends'))} <span class="friends-group-count">${friends.friends.length}</span></div>${rows}`;
        } else if (!friends.incoming.length && !friends.outgoing.length) {
            sections += `<div class="friends-empty" style="display:block">${escapeHtml(t('noFriends'))}</div>`;
        }

        if (friends.outgoing.length) {
            const rows = friends.outgoing.map(p => personRow(p, 'requested', `
                    <span class="cb-pending-label">${escapeHtml(t('pending'))}</span>
                    <button class="cb-ghost-btn" data-cb-cancel="${escapeHtml(p.cbId)}">${escapeHtml(t('cancel'))}</button>`)).join('');
            sections += `<div class="cb-section-head">${escapeHtml(t('sent'))}</div>${rows}`;
        }

        if (playedWith.length) {
            const rows = playedWith.map(p => personRow(p, 'none', `
                    <button class="friend-invite-btn" data-cb-add-handle="${escapeHtml(p.handle)}">${escapeHtml(t('add'))}</button>`)).join('');
            sections += `<div class="cb-section-head">${escapeHtml(t('playedWith'))} <span class="friends-group-count">${playedWith.length}</span></div>${rows}`;
        }

        return addRow + sections;
    }

    function render(status) {
        const host = document.getElementById('cb-profile');
        const list = document.getElementById('cb-friends-list');
        const empty = document.getElementById('cb-friends-empty');
        if (!host) return;
        if (empty) empty.style.display = 'none';

        const state = status ? status.state : 'none';

        if (state === 'ready' && status.profile) {
            host.innerHTML = editingProfile ? renderEditForm(status.profile) : renderProfileCard(status.profile);
            if (list) list.innerHTML = editingProfile ? '' : renderFriendsSection();
        } else if (state === 'creating') {
            host.innerHTML = `<div class="cb-create"><div class="cb-create-title">Creating your profile…</div></div>`;
            if (list) list.innerHTML = '';
        } else {
            host.innerHTML = renderCreateForm(state === 'error' ? (status && status.error) : '');
            if (list) list.innerHTML = '';
        }
    }

    // ---- actions ----

    async function showRecoveryCode() {
        try {
            const res = await window.executeCommand('cbfriends-get-recovery-code');
            const code = res && res.code;
            if (!code) {
                if (window.showToast) window.showToast(t('noRecoveryCode'), 'info');
                return;
            }
            await window.showMessageBox(t('recoveryTitle'),
                `Save this somewhere safe. You'll need it to recover your CB profile on a new PC if you haven't linked Discord.\n\n${code}`,
                [t('done')]);
        } catch (error) {
            console.warn('Failed to read recovery code:', error);
        }
    }

    async function submitCreate() {
        const handleInput = document.getElementById('cb-handle-input');
        const nameInput = document.getElementById('cb-name-input');
        if (!handleInput) return;
        const handle = handleInput.value.trim();
        const displayName = (nameInput ? nameInput.value.trim() : '') || handle;
        if (!HANDLE_RE.test(handle)) {
            render({ state: 'error', error: t('handleInvalid') });
            return;
        }
        try {
            await window.executeCommand('cbfriends-create-profile', { handle, displayName });
            render({ state: 'creating' });
            startCreatingPoll();
        } catch (error) {
            console.warn('Failed to start profile creation:', error);
            render({ state: 'error', error: 'Could not reach the launcher.' });
        }
    }

    async function submitEdit() {
        const nameEl = document.getElementById('cb-edit-name');
        const handleEl = document.getElementById('cb-edit-handle');
        const displayName = nameEl ? nameEl.value.trim() : '';
        const handle = handleEl ? handleEl.value.trim() : '';
        const bioEl = document.getElementById('cb-edit-bio');
        const gameEl = document.getElementById('cb-edit-game');
        const accentEl = document.getElementById('cb-edit-accent');
        const bio = bioEl ? bioEl.value.trim() : '';
        const favoriteGame = gameEl ? gameEl.value : '';
        const accent = accentEl ? accentEl.value : '';
        const avatarEl = document.getElementById('cb-edit-avatar');
        const avatarUrl = avatarEl ? avatarEl.value.trim() : '';
        if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
            if (window.showToast) window.showToast(t('avatarInvalid'), 'error');
            return;
        }
        if (handle && !HANDLE_RE.test(handle)) {
            if (window.showToast) window.showToast(t('handleInvalid'), 'error');
            return;
        }
        try {
            await window.executeCommand('cbfriends-update-profile', { displayName, handle, bio, accent, favoriteGame, avatarUrl });
            editingProfile = false;
            render(lastStatus);
            // The update runs async, so the outcome shows on the next poll.
            setTimeout(async () => {
                await refresh();
                if (lastStatus && lastStatus.error) {
                    if (window.showToast) window.showToast('Could not update profile (' + lastStatus.error + ')', 'error');
                    editingProfile = true;
                    render(lastStatus);
                } else if (window.showToast) {
                    window.showToast(t('profileUpdated'), 'success');
                }
            }, 700);
        } catch (error) {
            console.warn('Update profile failed:', error);
        }
    }

    async function submitAdd() {
        const input = document.getElementById('cb-add-input');
        if (!input) return;
        const handle = input.value.trim();
        if (!HANDLE_RE.test(handle)) {
            if (window.showToast) window.showToast(t('addInvalid'), 'error');
            return;
        }
        input.value = '';
        try {
            await window.executeCommand('cbfriends-add-friend', { handle });
            if (window.showToast) window.showToast(t('requestSent', { handle }), 'success');
            setTimeout(fetchFriends, 400);
        } catch (error) {
            console.warn('Add friend failed:', error);
        }
    }

    async function friendAction(command, cbId) {
        try {
            await window.executeCommand(command, { cbId });
            setTimeout(fetchFriends, 300);
        } catch (error) {
            console.warn(command + ' failed:', error);
        }
    }

    function startCreatingPoll() {
        if (creatingTimer) return;
        creatingTimer = setInterval(refresh, CREATING_POLL_MS);
    }
    function stopCreatingPoll() {
        if (creatingTimer) { clearInterval(creatingTimer); creatingTimer = null; }
    }

    async function fetchFriends() {
        try {
            const res = await window.executeCommand('cbfriends-get-friends');
            if (res) {
                friends = { friends: res.friends || [], incoming: res.incoming || [], outgoing: res.outgoing || [] };
                try {
                    const seen = await window.executeCommand('cbfriends-get-played-with');
                    playedWith = (seen && seen.people) || [];
                } catch (error) { playedWith = []; }
                if (activeSource === 'cb' && lastState === 'ready' && !editingProfile && !interacting()) {
                    const list = document.getElementById('cb-friends-list');
                    if (list) list.innerHTML = renderFriendsSection();
                }
            }
        } catch (error) { /* offline / preview */ }
    }

    // Prompts incoming invites and join-requests, like the Discord flow.
    async function pollCbInvites() {
        if (lastState !== 'ready') { shownCbInvites.clear(); return; }
        let res;
        try {
            res = await window.executeCommand('cbfriends-get-invites');
        } catch (error) { return; }
        const invites = (res && res.invites) || [];
        const ids = new Set(invites.map(i => i.id));
        for (const id of [...shownCbInvites]) if (!ids.has(id)) shownCbInvites.delete(id);
        for (const inv of invites) {
            if (shownCbInvites.has(inv.id)) continue;
            shownCbInvites.add(inv.id);
            promptCbInvite(inv);
        }
    }

    // Naming the game needs its own phrasing per language, so fall back to the game-less wording
    // rather than interpolating an empty name.
    function cbInviteStrings(inv) {
        const name = inv.senderName || t('aFriend');
        const game = gameName(inv.gameId);
        const key = inv.isRequest ? 'joinRequestBody' : 'inviteBody';
        return {
            title: t(inv.isRequest ? 'joinRequestTitle' : 'inviteTitle'),
            body: t(game ? key : key + 'NoGame', { name, game })
                + (inv.isRequest && inv.needsOpen ? t('joinRequestOpen') : ''),
            acceptLabel: t(inv.isRequest ? 'approve' : 'join'),
        };
    }

    async function promptCbInvite(inv) {
        const { title, body, acceptLabel } = cbInviteStrings(inv);

        // Approvals normally connect on their own, so a desktop toast for them is just noise.
        if (!inv.isApproval) {
            window.executeCommand('cbfriends-show-invite-notification', { id: inv.id, title, body }).catch(() => {});
        }

        let accepted = false;
        try {
            const idx = await window.showMessageBox(title, body, [acceptLabel, { label: t('decline'), danger: true }]);
            accepted = idx === 0;
        } catch (error) { return; }
        window.executeCommand('cbfriends-dismiss-invite-notification', { id: inv.id }).catch(() => {});
        try {
            await window.executeCommand(accepted ? 'cbfriends-accept-invite' : 'cbfriends-decline-invite', { id: inv.id });
        } catch (error) { console.warn('CB invite response failed:', error); }
    }

    async function refresh() {
        let status;
        try {
            status = await window.executeCommand('cbfriends-get-status');
        } catch (error) {
            return;
        }
        if (!status) return;
        lastStatus = status;
        myJoinable = !!status.joinable;

        const previous = lastState;
        lastState = status.state;
        if (status.state !== 'creating') stopCreatingPoll();

        if (previous === 'creating' && status.state === 'ready' && window.showToast) {
            window.showToast(t('created'), 'success');
            showRecoveryCode();
        } else if (previous === 'creating' && status.state === 'error' && window.showToast) {
            window.showToast(t('createFailed') + (status.error ? ` (${status.error})` : ''), 'error');
        }

        if (status.state === 'ready') await fetchFriends();
        announceRequests();
        refreshBadge();

        // Don't rebuild the panel while the user is editing their profile or typing in a field.
        if (activeSource === 'cb' && !editingProfile && !interacting()) render(status);
    }

    // Shows a count on a sidebar item, or hides it when there is nothing waiting.
    function setNavBadge(id, count) {
        const badge = document.getElementById(id);
        if (!badge) return;
        badge.textContent = String(count);
        badge.style.display = count > 0 ? '' : 'none';
    }

    // Announces each incoming request once, so a minimised launcher still surfaces it.
    function announceRequests() {
        const ids = new Set(friends.incoming.map(p => p.cbId));
        for (const id of [...announcedRequests]) if (!ids.has(id)) announcedRequests.delete(id);
        for (const person of friends.incoming) {
            if (announcedRequests.has(person.cbId)) continue;
            announcedRequests.add(person.cbId);
            if (!requestsPrimed) continue;
            const who = person.handle ? '@' + person.handle : (person.displayName || t('aFriend'));
            window.executeCommand('cbfriends-show-person-notification', {
                cbId: person.cbId,
                title: t('requestTitle'),
                body: t('requestBody', { name: who }),
            }).catch(() => {});
        }
        requestsPrimed = true;
    }

    // Pending requests and unread messages both want the user's attention, so they share a badge.
    function refreshBadge() {
        const dms = window.DirectMessages ? window.DirectMessages.getUnread() : 0;
        setNavBadge('friends-badge', friends.incoming.length + dms);
    }

    window.CbFriendsManager = {
        refresh,
        refreshBadge,
        start() {
            if (started) return;
            started = true;

            const tabs = document.getElementById('friends-source-tabs');
            if (tabs) {
                tabs.addEventListener('click', (event) => {
                    const tab = event.target.closest('.friends-source-tab');
                    if (tab) switchSource(tab.getAttribute('data-source'));
                });
            }

            const panel = document.getElementById('friends-cb-panel');
            if (panel) {
                panel.addEventListener('click', (event) => {
                    const t = event.target;
                    if (t.closest('#cb-create-btn')) return submitCreate();
                    if (t.closest('#cb-recovery-btn')) return showRecoveryCode();
                    if (t.closest('#cb-view-btn')) {
                        const me = lastStatus && lastStatus.profile;
                        if (me && me.cbId && window.PersonMenu) {
                            window.PersonMenu.showCard({ cbId: me.cbId, handle: me.handle, displayName: me.displayName });
                        }
                        return;
                    }
                    if (t.closest('#cb-edit-btn')) { editingProfile = true; return render(lastStatus); }
                    if (t.closest('#cb-edit-save')) return submitEdit();
                    if (t.closest('#cb-edit-cancel')) { editingProfile = false; return render(lastStatus); }
                    if (t.closest('#cb-add-btn')) return submitAdd();
                    const accept = t.closest('[data-cb-accept]');
                    if (accept) return friendAction('cbfriends-accept', accept.getAttribute('data-cb-accept'));
                    const decline = t.closest('[data-cb-decline]');
                    if (decline) return friendAction('cbfriends-decline', decline.getAttribute('data-cb-decline'));
                    const cancel = t.closest('[data-cb-cancel]');
                    if (cancel) return friendAction('cbfriends-cancel', cancel.getAttribute('data-cb-cancel'));
                    const more = t.closest('[data-cb-more]');
                    if (more) return openRowMenu(event, more.getAttribute('data-cb-more'));
                    const join = t.closest('[data-cb-join]');
                    if (join) return friendAction('cbfriends-request-join', join.getAttribute('data-cb-join'));
                    const invite = t.closest('[data-cb-invite]');
                    if (invite) return friendAction('cbfriends-invite-friend', invite.getAttribute('data-cb-invite'));
                    const byHandle = t.closest('[data-cb-add-handle]');
                    if (byHandle) return friendAction('cbfriends-add-friend', byHandle.getAttribute('data-cb-add-handle'));
                });
                panel.addEventListener('contextmenu', (event) => {
                    const el = event.target.closest('[data-person-id]');
                    if (!el || !window.PersonMenu) return;
                    const cbId = el.getAttribute('data-person-id');
                    if (people.has(cbId)) return openRowMenu(event, cbId);
                    window.PersonMenu.open(event, {
                        cbId,
                        handle: el.getAttribute('data-person-handle'),
                        displayName: el.getAttribute('data-person-name'),
                        relation: el.getAttribute('data-person-relation') || '',
                    });
                });
                panel.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter') return;
                    if (event.target.id === 'cb-handle-input') submitCreate();
                    if (event.target.id === 'cb-add-input') submitAdd();
                    if (event.target.id === 'cb-edit-name' || event.target.id === 'cb-edit-handle') submitEdit();
                });
            }

            refresh();
            setInterval(refresh, POLL_INTERVAL_MS);
            setInterval(() => { if (panelVisible()) refresh(); }, VISIBLE_POLL_MS);
            setInterval(pollCbInvites, 3000);
        }
    };
})();
