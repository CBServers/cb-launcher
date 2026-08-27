// The CB Friends sub-tab: profile, friend graph, and game invites. The Discord panel is untouched.

(function () {
    const POLL_INTERVAL_MS = 20 * 1000;
    const VISIBLE_POLL_MS = 5 * 1000;   // while the CB panel is open
    const CREATING_POLL_MS = 1500;
    const HANDLE_RE = /^[a-z0-9_]{2,32}$/i;

    let started = false;
    let activeSource = 'discord';
    let creatingTimer = null;
    let lastState = 'unknown';
    let lastStatus = null;
    let editingProfile = false;
    let myJoinable = false; // we're hosting a joinable match => can invite
    let friends = { friends: [], incoming: [], outgoing: [] };
    const shownCbInvites = new Set();

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

    function currentGameId() {
        return (window.GameStateManager && window.GameStateManager.runningGameId) || '';
    }

    function renderProfileCard(profile) {
        const avatar = profile.avatarUrl
            ? `<img class="cb-profile-avatar-img" src="${escapeHtml(profile.avatarUrl)}" alt="" />`
            : `<span class="cb-profile-avatar-initials">${escapeHtml(initials(profile.displayName || profile.handle))}</span>`;
        const handle = profile.handle ? '@' + escapeHtml(profile.handle) : '';
        const game = currentGameId();
        const activity = game
            ? `<div class="cb-profile-activity"><span class="friend-status-dot" data-status="online"></span>Playing ${escapeHtml(gameName(game))}</div>`
            : '';
        return `
            <div class="cb-profile-card">
                <div class="cb-profile-avatar">
                    ${avatar}
                    ${game ? '<span class="friend-status-dot cb-profile-dot" data-status="online"></span>' : ''}
                </div>
                <div class="cb-profile-body">
                    <div class="cb-profile-name">${escapeHtml(profile.displayName || profile.handle || 'CB user')}</div>
                    <div class="cb-profile-handle">${handle}</div>
                    ${activity}
                </div>
                <div class="cb-profile-actions">
                    <button class="cb-ghost-btn" id="cb-edit-btn" type="button">Edit</button>
                    <button class="cb-profile-recovery-btn" id="cb-recovery-btn" type="button">Recovery code</button>
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
                    <label class="cb-create-label">Display name</label>
                    <input id="cb-edit-name" class="cb-create-input" type="text" maxlength="64"
                        value="${escapeHtml(profile.displayName || '')}" autocomplete="off" />
                    <label class="cb-create-label">Handle</label>
                    <div class="cb-create-handle">
                        <span class="cb-create-at">@</span>
                        <input id="cb-edit-handle" class="cb-create-input" type="text" maxlength="32"
                            value="${escapeHtml(profile.handle || '')}" spellcheck="false" autocomplete="off" />
                    </div>
                    <label class="cb-create-label">Avatar URL</label>
                    <input id="cb-edit-avatar" class="cb-create-input" type="text" maxlength="512"
                        value="${escapeHtml(profile.avatarUrl || '')}" placeholder="https://..." spellcheck="false" autocomplete="off" />
                    <div class="cb-create-hint">Direct link to an image. Leave blank to use your Discord avatar.</div>
                    <label class="cb-create-label">About me</label>
                    <input id="cb-edit-bio" class="cb-create-input" type="text" maxlength="200"
                        value="${escapeHtml(profile.bio || '')}" placeholder="A line about you" autocomplete="off" />
                    <label class="cb-create-label">Favourite game</label>
                    <select id="cb-edit-game" class="cb-create-input">
                        <option value="">None</option>
                        ${gameOptions(profile.favoriteGame || '')}
                    </select>
                    <label class="cb-create-label">Profile colour</label>
                    <div class="cb-accent-row">
                        <input id="cb-edit-accent" type="color" value="${escapeHtml(accent)}" />
                        <span class="cb-create-hint" style="margin:0">Shown on your profile card and your name in chat.</span>
                    </div>
                </div>
                <div class="cb-edit-actions">
                    <button id="cb-edit-save" class="cb-add-btn" type="button">Save</button>
                    <button id="cb-edit-cancel" class="cb-ghost-btn" type="button">Cancel</button>
                </div>
            </div>
        `;
    }

    function renderCreateForm(error) {
        const dp = discordProfile();
        const suggestedName = dp ? dp.displayName : '';
        const linkedNote = dp
            ? `Your CB profile will link to your Discord account so you can recover it anywhere.`
            : `No Discord linked — you'll get a recovery code to save. You can link Discord later.`;
        const errorHtml = error ? `<div class="cb-create-error">${escapeHtml(error)}</div>` : '';
        return `
            <div class="cb-create">
                <div class="cb-create-title">Create your CB profile</div>
                <div class="cb-create-sub">A launcher-native identity so friends work even without Discord open.</div>
                ${errorHtml}
                <label class="cb-create-label">Handle</label>
                <div class="cb-create-handle">
                    <span class="cb-create-at">@</span>
                    <input id="cb-handle-input" class="cb-create-input" type="text" maxlength="32"
                        placeholder="yourname" autocomplete="off" spellcheck="false" />
                </div>
                <div class="cb-create-hint">2–32 characters: letters, numbers, underscores. Must be unique.</div>
                <label class="cb-create-label">Display name</label>
                <input id="cb-name-input" class="cb-create-input" type="text" maxlength="64"
                    placeholder="Display name" value="${escapeHtml(suggestedName)}" autocomplete="off" />
                <div class="cb-create-note">${escapeHtml(linkedNote)}</div>
                <button id="cb-create-btn" class="cb-create-btn" type="button">Create profile</button>
            </div>
        `;
    }

    // ---- friends ----

    function presenceLabel(p) {
        if (p.online) {
            if (p.game) return 'Playing ' + escapeHtml(gameName(p.game));
            return 'Online';
        }
        return 'Offline';
    }

    function personRow(p, actionsHtml) {
        const status = p.online ? (p.game ? 'online' : 'idle') : 'offline';
        const avatar = p.avatarUrl
            ? `<img class="friend-avatar-img" src="${escapeHtml(p.avatarUrl)}" alt="" loading="lazy" />`
            : `<span class="friend-avatar-initials">${escapeHtml(initials(p.displayName || p.handle))}</span>`;
        return `
            <div class="friend-row" data-status="${status}" data-person-id="${escapeHtml(p.cbId)}" data-person-handle="${escapeHtml(p.handle)}" data-person-name="${escapeHtml(p.displayName || p.handle)}" data-person-relation="friend">
                <div class="friend-avatar">
                    ${avatar}
                    <span class="friend-status-dot" data-status="${status}"></span>
                </div>
                <div class="friend-row-body">
                    <div class="friend-name">${escapeHtml(p.displayName || p.handle)} <span class="cb-friend-handle">@${escapeHtml(p.handle)}</span></div>
                    <div class="friend-activity">${presenceLabel(p)}</div>
                </div>
                ${actionsHtml || ''}
            </div>
        `;
    }

    // Row actions, mirroring the Discord friends list.
    function friendActions(p) {
        if (p.sameMatch) {
            return `<div class="friend-actions"><span class="cb-pending-label">In your match</span>
                <button class="cb-ghost-btn" data-cb-remove="${escapeHtml(p.cbId)}">Remove</button></div>`;
        }
        const btns = [];
        if (p.joinable || p.openable) {
            const label = p.joinable ? 'Join' : 'Ask to Join';
            btns.push(`<button class="friend-join-btn" data-cb-join="${escapeHtml(p.cbId)}">${label}</button>`);
        }
        if (myJoinable && p.online) {
            btns.push(`<button class="friend-invite-btn" data-cb-invite="${escapeHtml(p.cbId)}">Invite</button>`);
        }
        btns.push(`<button class="cb-ghost-btn" data-cb-remove="${escapeHtml(p.cbId)}">Remove</button>`);
        return `<div class="friend-actions">${btns.join('')}</div>`;
    }

    function renderFriendsSection() {
        const addRow = `
            <div class="cb-add-row">
                <div class="cb-create-handle cb-add-handle">
                    <span class="cb-create-at">@</span>
                    <input id="cb-add-input" class="cb-create-input" type="text" maxlength="32"
                        placeholder="add a friend by handle" autocomplete="off" spellcheck="false" />
                </div>
                <button id="cb-add-btn" class="cb-add-btn" type="button">Add</button>
            </div>
        `;

        let sections = '';

        if (friends.incoming.length) {
            const rows = friends.incoming.map(p => personRow(p, `
                <div class="friend-actions">
                    <button class="friend-invite-btn" data-cb-accept="${escapeHtml(p.cbId)}">Accept</button>
                    <button class="cb-ghost-btn" data-cb-decline="${escapeHtml(p.cbId)}">Decline</button>
                </div>`)).join('');
            sections += `<div class="cb-section-head">Requests <span class="friends-group-count">${friends.incoming.length}</span></div>${rows}`;
        }

        const online = friends.friends.filter(p => p.online);
        const offline = friends.friends.filter(p => !p.online);
        if (friends.friends.length) {
            const rowFor = p => personRow(p, friendActions(p));
            sections += `<div class="cb-section-head">Friends <span class="friends-group-count">${friends.friends.length}</span></div>`;
            sections += online.map(rowFor).join('') + offline.map(rowFor).join('');
        } else if (!friends.incoming.length && !friends.outgoing.length) {
            sections += `<div class="friends-empty" style="display:block">No CB friends yet. Add someone by their handle.</div>`;
        }

        if (friends.outgoing.length) {
            const rows = friends.outgoing.map(p => personRow(p, `
                <div class="friend-actions">
                    <span class="cb-pending-label">Pending</span>
                    <button class="cb-ghost-btn" data-cb-cancel="${escapeHtml(p.cbId)}">Cancel</button>
                </div>`)).join('');
            sections += `<div class="cb-section-head">Sent</div>${rows}`;
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
                if (window.showToast) window.showToast('No recovery code stored for this profile.', 'info');
                return;
            }
            await window.showMessageBox('Your recovery code',
                `Save this somewhere safe. You'll need it to recover your CB profile on a new PC if you haven't linked Discord.\n\n${code}`,
                ['Done']);
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
            render({ state: 'error', error: 'Handle must be 2–32 characters: letters, numbers, underscores.' });
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
            if (window.showToast) window.showToast('Avatar must be a http(s) image link.', 'error');
            return;
        }
        if (handle && !HANDLE_RE.test(handle)) {
            if (window.showToast) window.showToast('Handle must be 2–32 chars: letters, numbers, underscores.', 'error');
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
                    window.showToast('Profile updated.', 'success');
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
            if (window.showToast) window.showToast('Enter a valid handle (letters, numbers, underscores).', 'error');
            return;
        }
        input.value = '';
        try {
            await window.executeCommand('cbfriends-add-friend', { handle });
            if (window.showToast) window.showToast(`Friend request sent to @${handle}.`, 'success');
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

    async function promptCbInvite(inv) {
        const name = inv.senderName || 'A friend';
        const game = gameName(inv.gameId);
        let title, body, acceptLabel;
        if (inv.isRequest) {
            title = 'Join request';
            body = `${name} wants to join your ${game || 'game'}.` + (inv.needsOpen ? ' Accepting opens your match to them.' : '');
            acceptLabel = 'Approve';
        } else {
            title = 'Game invite';
            body = `${name} invited you to join their ${game || 'game'}.`;
            acceptLabel = 'Join';
        }
        let accepted = false;
        try {
            const idx = await window.showMessageBox(title, body, [acceptLabel, { label: 'Decline', danger: true }]);
            accepted = idx === 0;
        } catch (error) { return; }
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
            window.showToast('CB profile created.', 'success');
            showRecoveryCode();
        } else if (previous === 'creating' && status.state === 'error' && window.showToast) {
            window.showToast('Could not create CB profile' + (status.error ? ` (${status.error})` : ''), 'error');
        }

        if (status.state === 'ready') await fetchFriends();
        // Don't rebuild the panel while the user is editing their profile or typing in a field.
        if (activeSource === 'cb' && !editingProfile && !interacting()) render(status);
    }

    window.CbFriendsManager = {
        refresh,
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
                    const remove = t.closest('[data-cb-remove]');
                    if (remove) return friendAction('cbfriends-remove', remove.getAttribute('data-cb-remove'));
                    const join = t.closest('[data-cb-join]');
                    if (join) return friendAction('cbfriends-request-join', join.getAttribute('data-cb-join'));
                    const invite = t.closest('[data-cb-invite]');
                    if (invite) return friendAction('cbfriends-invite-friend', invite.getAttribute('data-cb-invite'));
                });
                panel.addEventListener('contextmenu', (event) => {
                    const el = event.target.closest('[data-person-id]');
                    if (!el || !window.PersonMenu) return;
                    window.PersonMenu.open(event, {
                        cbId: el.getAttribute('data-person-id'),
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
