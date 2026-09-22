// The Friends page: the profile card, and one list merging CB friends with Discord friends.

(function () {
    const POLL_INTERVAL_MS = 20 * 1000;
    const VISIBLE_POLL_MS = 5 * 1000;   // while the Friends page is open
    const CREATING_POLL_MS = 1500;
    const HANDLE_RE = /^[a-z0-9_]{2,32}$/i;
    const RECOVERY_CODE_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/;
    const PENCIL_SVG = '<svg class="cb-profile-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    const PERSON_SVG = '<svg class="cb-profile-avatar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
    const DISCORD_SVG = '<svg class="friend-source-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';

    const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a17.6 17.6 0 0 1-2.16 3.19"/><path d="M6.61 6.61A17.4 17.4 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M2 2l20 20"/></svg>';
    const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }
    function tGlobal(k, v) { return window.LauncherI18n ? window.LauncherI18n.t(k, v) : k; }
    function tf(k, v) { return tGlobal('friends.' + k, v); }

    let started = false;
    let creatingTimer = null;
    let lastState = 'unknown';
    let lastStatus = null;
    let editingProfile = false;
    let createOpen = false;       // the setup card was swapped for the create form
    let createError = '';         // a local validation or launcher error for the create form
    let recoverOpen = false;      // the setup card was swapped for the recovery-code form
    let recoverError = '';        // a local validation or launcher error for the recovery form
    let lastAction = 'create';    // which form a service error belongs to
    let dismissedError = null;    // a service error the user closed the form on
    let myJoinable = false; // we're hosting a joinable match => can invite
    let friends = { friends: [], incoming: [], outgoing: [] };
    let playedWith = [];
    const people = new Map(); // cbId -> { person, relation }, rebuilt on every list render
    const rows = new Map();   // friend row key -> { cb, discord }, rebuilt on every list render
    const renderedHtml = new WeakMap();
    let openRecoveryCode = '';    // the code behind the open recovery dialog, in the DOM only while revealed
    let recoveryBound = false;
    let recoveryCopyTimer = null;
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

    function discordState() {
        const s = window.AppViews && typeof window.AppViews.getFriendsState === 'function'
            ? window.AppViews.getFriendsState() : null;
        return s || { status: 'unknown', profile: null, friends: [], registryOk: true, joinable: false };
    }

    function discordProfile() {
        const s = discordState();
        return s.status === 'linked' && s.profile ? s.profile : null;
    }

    function discordFriends() {
        const s = discordState();
        return s.status === 'linked' ? (s.friends || []) : [];
    }

    function cbReady() {
        return lastState === 'ready' && !!(lastStatus && lastStatus.profile);
    }

    function pageVisible() {
        const page = document.getElementById('friends-page');
        return !!page && page.style.display !== 'none';
    }

    // True while the user is typing, so a poll never rebuilds the DOM under them.
    function interacting() {
        const panel = document.getElementById('friends-panel');
        const el = document.activeElement;
        return !!(panel && el && panel.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    }

    // Skips identical markup, so polls keep hover state, loaded images and half-typed input.
    function setHtml(el, html) {
        if (!el || renderedHtml.get(el) === html) return;
        renderedHtml.set(el, html);
        el.innerHTML = html;
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
            ? `<div class="cb-profile-activity">${escapeHtml(t("playing", { game: gameName(game) }))}${chip}</div>`
              + (sub ? `<div class="cb-profile-activity-sub">${escapeHtml(sub)}</div>` : '')
            : `<div class="cb-profile-activity is-idle">${escapeHtml(t('online'))}</div>`;
        return `
            <div class="cb-profile-card" data-cb-self-card>
                <div class="cb-profile-avatar" data-cb-view-self title="${escapeHtml(t('viewProfile'))}">
                    ${avatar}
                    <span class="friend-status-dot cb-profile-dot" data-status="${game ? 'online' : 'idle'}"></span>
                </div>
                <div class="cb-profile-body">
                    <div class="cb-profile-name"><span class="cb-profile-link" data-cb-view-self title="${escapeHtml(t('viewProfile'))}">${escapeHtml(profile.displayName || profile.handle || t('displayName'))}</span></div>
                    <div class="cb-profile-handle">${handle}</div>
                    ${activity}
                </div>
                <div class="cb-profile-actions">
                    <button class="cb-profile-btn" id="cb-edit-btn" type="button">${PENCIL_SVG}<span>${escapeHtml(t('edit'))}</span></button>
                    <button class="cb-profile-btn cb-profile-more" id="cb-self-more" type="button" title="${escapeHtml(t('more'))}" aria-label="${escapeHtml(t('more'))}">&#8943;</button>
                </div>
            </div>
        `;
    }

    // No CB profile yet: the card offers one, and Discord too while it isn't linked.
    function renderSetupCard() {
        const ds = discordState();
        const dp = discordProfile();
        const busy = ds.status === 'linking' || ds.status === 'connecting';
        const avatar = dp
            ? (dp.avatarUrl
                ? `<img class="cb-profile-avatar-img" src="${escapeHtml(dp.avatarUrl)}" alt="" />`
                : `<span class="cb-profile-avatar-initials">${escapeHtml(initials(dp.displayName))}</span>`)
            : PERSON_SVG;
        const heading = dp
            ? `<div class="cb-profile-name">${escapeHtml(dp.displayName)}</div>
               <div class="cb-profile-linked">${DISCORD_SVG}${escapeHtml(tf('discordLinked'))}</div>`
            : `<div class="cb-profile-name">${escapeHtml(tf('setupTitle'))}</div>`;
        const linkBtn = !dp && ds.status !== 'unavailable'
            ? `<button class="cb-profile-btn" id="friends-link-discord" type="button"${busy ? ' disabled' : ''}>${DISCORD_SVG}<span>${escapeHtml(tf('linkDiscord'))}</span></button>`
            : '';
        return `
            <div class="cb-profile-card cb-profile-setup">
                <div class="cb-profile-avatar">${avatar}</div>
                <div class="cb-profile-body">
                    ${heading}
                    <div class="cb-profile-text">${escapeHtml(tf(dp ? 'setupCbBody' : 'setupBody'))}</div>
                    <button class="cb-create-link" id="friends-recover-open" type="button">${escapeHtml(t('recoverLink'))}</button>
                </div>
                <div class="cb-profile-actions">
                    <button class="cb-profile-btn is-primary" id="friends-create-open" type="button">${escapeHtml(tf('createCb'))}</button>
                    ${linkBtn}
                </div>
            </div>
        `;
    }

    function profileHtml() {
        const status = lastStatus;
        const state = status ? status.state : 'none';
        if (state === 'ready' && status.profile) {
            return editingProfile ? renderEditForm(status.profile) : renderProfileCard(status.profile);
        }
        if (state === 'creating') {
            return `<div class="cb-create"><div class="cb-create-title">${escapeHtml(t('creating'))}</div></div>`;
        }
        const serviceError = state === 'error' && status.error && status.error !== dismissedError ? friendlyError(status.error) : '';
        if (recoverOpen || (serviceError && lastAction === 'recover')) return renderRecoverForm(recoverError || serviceError);
        if (createOpen || serviceError) return renderCreateForm(createError || serviceError);
        return renderSetupCard();
    }

    function viewOwnProfile() {
        const me = lastStatus && lastStatus.profile;
        if (me && me.cbId && window.PersonMenu) {
            window.PersonMenu.showCard({ cbId: me.cbId, handle: me.handle, displayName: me.displayName });
        }
    }

    function editOwnProfile() {
        editingProfile = true;
        renderPage(true);
    }

    const copyText = (text) => window.copyTextToClipboard(text);

    async function copyOwnHandle() {
        const me = lastStatus && lastStatus.profile;
        if (!me || !me.handle) return;
        const ok = await copyText('@' + me.handle);
        if (window.showToast) {
            window.showToast(ok ? t('handleCopied', { handle: me.handle }) : t('copyFailed'), ok ? 'success' : 'error');
        }
    }

    function linkDiscord() {
        if (window.DiscordFriendsManager) window.DiscordFriendsManager.beginLink();
    }

    function unlinkDiscord() {
        if (window.DiscordFriendsManager) window.DiscordFriendsManager.unlink();
    }

    function openSelfMenu(event) {
        if (!window.PersonMenu) return;
        const me = lastStatus && lastStatus.profile;
        const ds = discordState();
        const linked = ds.status === 'linked';
        const busy = ds.status === 'linking' || ds.status === 'connecting';
        window.PersonMenu.showMenuAt(event, [
            { label: t('viewProfile'), action: viewOwnProfile },
            { label: t('editProfile'), action: editOwnProfile },
            { label: t('copyHandle'), hidden: !(me && me.handle), action: copyOwnHandle },
            { separator: true },
            { label: linked ? tf('unlinkDiscord') : tf(busy ? 'linking' : 'linkDiscord'),
              hidden: ds.status === 'unavailable', disabled: busy, action: linked ? unlinkDiscord : linkDiscord },
            { label: t('recoveryCode'), action: showRecoveryCode },
        ]);
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
                <div class="cb-create-title">${escapeHtml(t('createTitle'))}</div>
                <div class="cb-create-sub">${escapeHtml(t('createSub'))}</div>
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
                <div class="cb-create-actions">
                    <button id="cb-create-btn" class="cb-create-btn" type="button">${escapeHtml(t('createBtn'))}</button>
                    <button id="cb-create-cancel" class="cb-ghost-btn" type="button">${escapeHtml(t('cancel'))}</button>
                </div>
                <button class="cb-create-link" id="friends-recover-open" type="button">${escapeHtml(t('recoverLink'))}</button>
            </div>
        `;
    }

    // Server error strings are terse; the ones a user can act on get a fuller message.
    function friendlyError(error) {
        if (error === 'handle taken') return t('handleTaken');
        if (error === 'no account for this anchor') return t('recoverNoAccount');
        if (error === 'too many recovery attempts') return t('recoverRateLimited');
        return error;
    }

    function renderRecoverForm(error) {
        const errorHtml = error ? `<div class="cb-create-error">${escapeHtml(error)}</div>` : '';
        return `
            <div class="cb-create">
                <div class="cb-create-title">${escapeHtml(t('recoverTitle'))}</div>
                <div class="cb-create-sub">${escapeHtml(t('recoverSub'))}</div>
                ${errorHtml}
                <label class="cb-create-label">${escapeHtml(t('recoveryCode'))}</label>
                <input id="cb-recover-input" class="cb-create-input cb-recover-input" type="text" maxlength="39"
                    placeholder="1A2B-3C4D-5E6F-7A8B-9C0D-1E2F-3A4B-5C6D" autocomplete="off" spellcheck="false" />
                <div class="cb-create-hint">${escapeHtml(t('recoverHint'))}</div>
                <div class="cb-create-actions">
                    <button id="cb-recover-btn" class="cb-create-btn" type="button">${escapeHtml(t('recoverBtn'))}</button>
                    <button id="cb-recover-cancel" class="cb-ghost-btn" type="button">${escapeHtml(t('cancel'))}</button>
                </div>
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

    // Takes a CB person or a Discord friend; both carry the same join flags.
    function matchChip(src) {
        if (src.sameMatch) return `<span class="friend-chip" data-kind="same">${escapeHtml(tf('inYourMatch'))}</span>`;
        if (src.joinable) return `<span class="friend-chip" data-kind="joinable">${escapeHtml(tf('joinable'))}</span>`;
        if (src.openable) return `<span class="friend-chip" data-kind="open">${escapeHtml(tf('openMatch'))}</span>`;
        return '';
    }

    function presenceChip(p) {
        return p.online && p.game ? matchChip(p) : '';
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
                    <div class="friend-name"><span class="cb-profile-link" data-person-link>${escapeHtml(p.displayName || p.handle)}</span> <span class="cb-friend-handle">@${escapeHtml(p.handle)}</span>${presenceChip(p)}</div>
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

    function discordOnline(f) {
        return f.status === 'online' || f.status === 'idle';
    }

    // One entry per person: a CB friend absorbs the Discord friend the worker matched by id.
    function mergedFriends() {
        const byId = new Map(discordFriends().map(f => [f.id, f]));
        const merged = (cbReady() ? friends.friends : []).map(p => {
            const d = p.discordId ? byId.get(p.discordId) : null;
            if (d) byId.delete(d.id);
            return { cb: p, discord: d || null };
        });
        for (const f of byId.values()) merged.push({ cb: null, discord: f });
        return merged;
    }

    function rowKey(row) {
        return row.cb ? 'cb:' + row.cb.cbId : 'discord:' + row.discord.id;
    }

    // Mirrors the in-game list: CB presence wins while they are online on CB, Discord fills in otherwise.
    // Join follows whichever side reports the match; invite goes over CB while they are online there.
    function sessionFor(row) {
        const { cb, discord } = row;
        const cbOnline = !!(cb && cb.online);
        const cbInGame = cbOnline && !!cb.game;
        const dOnline = !!(discord && discordOnline(discord));
        const dInGame = !cbInGame && !!(discord && discord.activityDetails);
        const status = cbInGame || dInGame ? 'online' : (cbOnline || dOnline ? 'idle' : 'offline');
        const match = cbInGame ? cb : (dInGame ? discord : null);
        const sameMatch = !!(match && match.sameMatch);
        const join = match && !sameMatch && (match.joinable || match.openable)
            ? { rail: cbInGame ? 'cb' : 'discord', knock: !match.joinable } : null;
        const inviteRail = cbOnline ? 'cb' : (dOnline ? 'discord' : '');
        const canInvite = inviteRail === 'cb' ? myJoinable : (inviteRail === 'discord' && !!discordState().joinable);
        return { cbOnline, cbInGame, dOnline, dInGame, status, match, sameMatch, join, inviteRail, canInvite };
    }

    function discordActivity(f) {
        const cfg = f.gameId && window.GameUtils ? window.GameUtils.getGameConfigByUIId(f.gameId) : null;
        const sep = f.activityDetails.indexOf(' - ');
        const game = cfg ? cfg.displayName : (sep > 0 ? f.activityDetails.slice(0, sep) : f.activityDetails);
        const parts = [];
        if (sep > 0) parts.push(f.activityDetails.slice(sep + 3));
        if (f.activityState) parts.push(f.activityState);
        return { main: tf('playing', { game }), sub: parts.join(' · '), chip: matchChip(f) };
    }

    function presenceLines(row, x) {
        const { cb, discord } = row;
        if (x.cbInGame) return { main: tf('playing', { game: gameName(cb.game) }), sub: matchContext(cb), chip: matchChip(cb) };
        if (x.dInGame) return discordActivity(discord);
        if (x.cbOnline) return { main: tf('statusOnline'), sub: '', chip: '' };
        if (discord && discord.inLauncher) return { main: tf('inLauncher'), sub: '', chip: '' };
        if (x.dOnline) return { main: tf(discord.status === 'idle' ? 'statusIdle' : 'statusOnline'), sub: '', chip: '' };
        if (cb) return { main: presenceLabel(cb), sub: '', chip: '' };
        return { main: tf('statusOffline'), sub: '', chip: '' };
    }

    // In-game first, then online, then offline by most recently seen.
    function sortRows(list) {
        const rank = { online: 0, idle: 1, offline: 2 };
        const name = row => (row.cb ? (row.cb.displayName || row.cb.handle) : row.discord.displayName) || '';
        return list
            .map(row => ({ row, x: sessionFor(row) }))
            .sort((a, b) => rank[a.x.status] - rank[b.x.status]
                || ((b.row.cb && b.row.cb.lastSeen) || 0) - ((a.row.cb && a.row.cb.lastSeen) || 0)
                || name(a.row).localeCompare(name(b.row)))
            .map(entry => entry.row);
    }

    // Session actions, greyed rather than hidden when the reason is obvious on either side.
    function sessionItems(row) {
        const x = sessionFor(row);
        if (x.sameMatch || !(x.cbOnline || x.dOnline)) return [];
        return [
            { label: tf(x.join && x.join.knock ? 'askToJoin' : 'join'), disabled: !x.join, action: () => joinRow(row) },
            { label: tf('invite'), disabled: !x.canInvite, action: () => inviteRow(row) },
        ];
    }

    function joinRow(row) {
        const x = sessionFor(row);
        if (!x.join) return;
        if (x.join.rail === 'cb') return requestJoin(row.cb.cbId);
        if (window.DiscordFriendsManager) {
            window.DiscordFriendsManager.requestJoin(row.discord.id, row.discord.gameId || '', x.join.knock);
        }
    }

    function inviteRow(row) {
        const x = sessionFor(row);
        if (!x.canInvite) return;
        if (x.inviteRail === 'cb') return sendInvite(row.cb.cbId);
        if (window.DiscordFriendsManager) window.DiscordFriendsManager.sendInvite(row.discord.id);
    }

    function friendRow(row) {
        const key = rowKey(row);
        rows.set(key, row);
        const { cb, discord } = row;
        if (cb) people.set(cb.cbId, { person: cb, relation: 'friend' });

        const x = sessionFor(row);
        const lines = presenceLines(row, x);
        const name = cb ? (cb.displayName || cb.handle) : discord.displayName;
        const avatarUrl = (cb && cb.avatarUrl) || (discord && discord.avatarUrl) || '';
        const avatar = avatarUrl
            ? `<img class="friend-avatar-img" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" />`
            : `<span class="friend-avatar-initials">${escapeHtml(initials(name))}</span>`;
        const handle = cb ? ` <span class="cb-friend-handle">@${escapeHtml(cb.handle)}</span>` : '';
        // Only Discord-only rows get the icon: it explains the missing handle, profile and Message.
        const source = cb ? '' : `<span class="friend-source" title="${escapeHtml(tf('discordFriend'))}">${DISCORD_SVG}</span>`;

        const btns = [];
        if (!x.sameMatch) {
            if (x.join) {
                btns.push(`<button class="friend-join-btn" type="button" data-friend-join="${escapeHtml(key)}">${escapeHtml(tf(x.join.knock ? 'askToJoin' : 'join'))}</button>`);
            }
            if (x.canInvite) {
                btns.push(`<button class="friend-invite-btn" type="button" data-friend-invite="${escapeHtml(key)}">${escapeHtml(tf('invite'))}</button>`);
            }
        }
        if (cb || sessionItems(row).length) {
            btns.push(`<button class="friend-more-btn" type="button" data-friend-more="${escapeHtml(key)}" title="${escapeHtml(tf('more'))}" aria-label="${escapeHtml(tf('more'))}">&#8943;</button>`);
        }

        const personAttrs = cb
            ? ` data-person-id="${escapeHtml(cb.cbId)}" data-person-handle="${escapeHtml(cb.handle)}" data-person-name="${escapeHtml(name)}" data-person-relation="friend"`
            : '';
        const nameHtml = cb ? `<span class="cb-profile-link" data-person-link>${escapeHtml(name)}</span>` : escapeHtml(name);
        return `
            <div class="friend-row" data-status="${x.status}" data-friend-key="${escapeHtml(key)}"${personAttrs}>
                <div class="friend-avatar">
                    ${avatar}
                    <span class="friend-status-dot" data-status="${x.status}"></span>
                </div>
                <div class="friend-row-body">
                    <div class="friend-name">${nameHtml}${handle}${source}${lines.chip}</div>
                    <div class="friend-activity">${escapeHtml(lines.main)}</div>
                    ${lines.sub ? `<div class="friend-activity-sub">${escapeHtml(lines.sub)}</div>` : ''}
                </div>
                <div class="friend-actions">${btns.join('')}</div>
            </div>
        `;
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

    function openFriendRowMenu(event, key) {
        const row = rows.get(key);
        if (!row || !window.PersonMenu) return;
        if (row.cb) {
            const p = row.cb;
            window.PersonMenu.open(event, { cbId: p.cbId, handle: p.handle, displayName: p.displayName, relation: 'friend' },
                { top: sessionItems(row), bottom: [{ label: t('remove'), danger: true, action: () => confirmRemove(p) }] });
            return;
        }
        const items = sessionItems(row);
        if (items.length) window.PersonMenu.showMenuAt(event, items);
    }

    // Menu items for a request row: accept/decline on top, cancel beside block/report.
    function menuItemsFor(p, relation) {
        const top = [];
        const bottom = [];
        if (relation === 'incoming') {
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

    function renderListHtml() {
        people.clear();
        rows.clear();
        const ready = cbReady();
        const discordLinked = discordState().status === 'linked';
        let html = '';

        if (ready) {
            html += `
                <div class="cb-add-row">
                    <div class="cb-create-handle cb-add-handle">
                        <span class="cb-create-at">@</span>
                        <input id="cb-add-input" class="cb-create-input" type="text" maxlength="32"
                            placeholder="${escapeHtml(t('addByHandle'))}" autocomplete="off" spellcheck="false" />
                    </div>
                    <button id="cb-add-btn" class="cb-add-btn" type="button">${escapeHtml(t('add'))}</button>
                </div>
            `;
        }

        const incoming = ready ? friends.incoming : [];
        const outgoing = ready ? friends.outgoing : [];

        if (incoming.length) {
            const list = incoming.map(p => personRow(p, 'incoming', `
                    <button class="friend-invite-btn" data-cb-accept="${escapeHtml(p.cbId)}">${escapeHtml(t('accept'))}</button>
                    <button class="cb-ghost-btn" data-cb-decline="${escapeHtml(p.cbId)}">${escapeHtml(t('decline'))}</button>`)).join('');
            html += `<div class="cb-section-head">${escapeHtml(t('requests'))} <span class="friends-group-count">${incoming.length}</span></div>${list}`;
        }

        const merged = mergedFriends();
        if (merged.length) {
            const list = sortRows(merged).map(friendRow).join('');
            html += `<div class="cb-section-head">${escapeHtml(tf('title'))} <span class="friends-group-count">${merged.length}</span></div>${list}`;
        } else if ((ready || discordLinked) && !incoming.length && !outgoing.length) {
            html += `<div class="friends-empty">${escapeHtml(tf(ready ? 'emptyCb' : 'empty'))}</div>`;
        }

        if (outgoing.length) {
            const list = outgoing.map(p => personRow(p, 'requested', `
                    <span class="cb-pending-label">${escapeHtml(t('pending'))}</span>
                    <button class="cb-ghost-btn" data-cb-cancel="${escapeHtml(p.cbId)}">${escapeHtml(t('cancel'))}</button>`)).join('');
            html += `<div class="cb-section-head">${escapeHtml(t('sent'))}</div>${list}`;
        }

        // Someone already listed as a Discord friend isn't news.
        const discordIds = new Set(discordFriends().map(f => f.id));
        const suggestions = ready ? playedWith.filter(p => !(p.discordId && discordIds.has(p.discordId))) : [];
        if (suggestions.length) {
            const list = suggestions.map(p => personRow(p, 'none', `
                    <button class="friend-invite-btn" data-cb-add-handle="${escapeHtml(p.handle)}">${escapeHtml(t('add'))}</button>`)).join('');
            html += `<div class="cb-section-head">${escapeHtml(t('playedWith'))} <span class="friends-group-count">${suggestions.length}</span></div>${list}`;
        }

        return html;
    }

    function renderNotice() {
        const notice = document.getElementById('friends-notice');
        if (!notice) return;
        const ds = discordState();
        let text = '';
        if (ds.status === 'linking' || ds.status === 'connecting') text = tf('linking');
        else if (ds.status === 'linked' && !ds.registryOk) text = tf('degraded');
        if (notice.textContent !== text) notice.textContent = text;
        notice.style.display = text ? '' : 'none';
    }

    // Polls pass nothing and back off while the user is editing or typing; user actions force it.
    function renderPage(force) {
        if (!started) return;
        if (!force && (editingProfile || interacting())) return;
        const host = document.getElementById('friends-profile');
        const list = document.getElementById('friends-list');
        if (!host || !list) return;
        setHtml(host, profileHtml());
        setHtml(list, editingProfile ? '' : renderListHtml());
        renderNotice();
    }

    // ---- actions ----

    function setRecoveryRevealed(root, show) {
        const value = root.querySelector('.cb-recovery-value');
        const toggle = root.querySelector('[data-recovery-toggle]');
        if (!value || !toggle) return;
        value.textContent = show ? openRecoveryCode : value.dataset.masked;
        value.classList.toggle('is-revealed', show);
        toggle.setAttribute('aria-pressed', String(show));
        toggle.innerHTML = `${show ? EYE_OFF_SVG : EYE_SVG}<span>${escapeHtml(t(show ? 'hideCode' : 'showCode'))}</span>`;
    }

    // One delegated listener on the shared message box; the code itself lives only in openRecoveryCode.
    function bindRecoveryDialog() {
        const box = document.getElementById('message-box');
        if (recoveryBound || !box) return;
        recoveryBound = true;
        box.addEventListener('click', async (event) => {
            const root = event.target.closest('.cb-recovery');
            if (!root || !openRecoveryCode) return;
            const toggle = event.target.closest('[data-recovery-toggle]');
            if (toggle) return setRecoveryRevealed(root, toggle.getAttribute('aria-pressed') !== 'true');
            const copy = event.target.closest('[data-recovery-copy]');
            if (!copy) return;
            const ok = await copyText(openRecoveryCode);
            const label = copy.querySelector('span');
            if (label) label.textContent = t(ok ? 'copied' : 'copyFailedShort');
            copy.classList.toggle('is-done', ok);
            clearTimeout(recoveryCopyTimer);
            recoveryCopyTimer = setTimeout(() => {
                if (label) label.textContent = t('copy');
                copy.classList.remove('is-done');
            }, 1800);
        });
    }

    // Masked until the user asks, so it can't leak onto a stream or a screenshot by accident.
    async function showRecoveryCode() {
        let code = '';
        try {
            const res = await window.executeCommand('cbfriends-get-recovery-code');
            code = (res && res.code) || '';
        } catch (error) {
            console.warn('Failed to read recovery code:', error);
            return;
        }
        if (!code) {
            if (window.showToast) window.showToast(t('noRecoveryCode'), 'info');
            return;
        }

        bindRecoveryDialog();
        const masked = code.replace(/[^-]/g, '•');
        const body = `
            <div class="cb-recovery">
                <p class="cb-recovery-text">${escapeHtml(t('recoveryBody'))}</p>
                <div class="cb-recovery-warning">${escapeHtml(t('recoveryWarning'))}</div>
                <code class="cb-recovery-value" data-masked="${escapeHtml(masked)}">${escapeHtml(masked)}</code>
                <div class="cb-recovery-actions">
                    <button type="button" class="cb-recovery-btn" data-recovery-toggle aria-pressed="false">${EYE_SVG}<span>${escapeHtml(t('showCode'))}</span></button>
                    <button type="button" class="cb-recovery-btn" data-recovery-copy>${COPY_SVG}<span>${escapeHtml(t('copy'))}</span></button>
                </div>
            </div>
        `;
        openRecoveryCode = code;
        try {
            await window.showMessageBox(t('recoveryTitle'), body, [t('done')]);
        } catch (error) {
            console.warn('Failed to show recovery code:', error);
        }
        // The closed box stays in the DOM, so put the mask back before letting go of the code.
        document.querySelectorAll('#message-box .cb-recovery').forEach(root => setRecoveryRevealed(root, false));
        openRecoveryCode = '';
    }

    function openCreateForm() {
        createOpen = true;
        createError = '';
        renderPage(true);
        const input = document.getElementById('cb-handle-input');
        if (input) input.focus();
    }

    function closeCreateForm() {
        createOpen = false;
        createError = '';
        dismissedError = lastStatus && lastStatus.error;
        renderPage(true);
    }

    function showCreateError(message) {
        const handleInput = document.getElementById('cb-handle-input');
        const nameInput = document.getElementById('cb-name-input');
        const typed = { handle: handleInput ? handleInput.value : '', name: nameInput ? nameInput.value : '' };
        createOpen = true;
        createError = message;
        renderPage(true);
        const h = document.getElementById('cb-handle-input');
        const n = document.getElementById('cb-name-input');
        if (h) { h.value = typed.handle; h.focus(); }
        if (n) n.value = typed.name;
    }

    function openRecoverForm() {
        recoverOpen = true;
        recoverError = '';
        createOpen = false;
        createError = '';
        renderPage(true);
        const input = document.getElementById('cb-recover-input');
        if (input) input.focus();
    }

    function closeRecoverForm() {
        recoverOpen = false;
        recoverError = '';
        dismissedError = lastStatus && lastStatus.error;
        renderPage(true);
    }

    function showRecoverError(message) {
        const input = document.getElementById('cb-recover-input');
        const typed = input ? input.value : '';
        recoverOpen = true;
        recoverError = message;
        renderPage(true);
        const again = document.getElementById('cb-recover-input');
        if (again) { again.value = typed; again.focus(); }
    }

    // Accepts the code with or without dashes and in any case.
    function normalizeRecoveryCode(raw) {
        const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
        return hex.length === 32 ? hex.match(/.{4}/g).join('-') : raw.trim().toUpperCase();
    }

    async function submitRecover() {
        const input = document.getElementById('cb-recover-input');
        if (!input) return;
        const code = normalizeRecoveryCode(input.value);
        if (!RECOVERY_CODE_RE.test(code)) {
            showRecoverError(t('recoverInvalid'));
            return;
        }
        try {
            await window.executeCommand('cbfriends-recover-code', { code });
            recoverOpen = false;
            recoverError = '';
            dismissedError = null;
            lastAction = 'recover';
            lastState = 'creating';
            lastStatus = Object.assign({}, lastStatus, { state: 'creating', error: null });
            renderPage(true);
            startCreatingPoll();
        } catch (error) {
            console.warn('Failed to start profile recovery:', error);
            showRecoverError('Could not reach the launcher.');
        }
    }

    async function submitCreate() {
        const handleInput = document.getElementById('cb-handle-input');
        const nameInput = document.getElementById('cb-name-input');
        if (!handleInput) return;
        const handle = handleInput.value.trim();
        const displayName = (nameInput ? nameInput.value.trim() : '') || handle;
        if (!HANDLE_RE.test(handle)) {
            showCreateError(t('handleInvalid'));
            return;
        }
        try {
            await window.executeCommand('cbfriends-create-profile', { handle, displayName });
            createOpen = false;
            createError = '';
            dismissedError = null;
            lastAction = 'create';
            lastState = 'creating';
            lastStatus = Object.assign({}, lastStatus, { state: 'creating', error: null });
            renderPage(true);
            startCreatingPoll();
        } catch (error) {
            console.warn('Failed to start profile creation:', error);
            showCreateError('Could not reach the launcher.');
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
            renderPage(true);
            // The update runs async, so the outcome shows on the next poll.
            setTimeout(async () => {
                await refresh();
                if (lastStatus && lastStatus.error) {
                    if (window.showToast) window.showToast('Could not update profile (' + lastStatus.error + ')', 'error');
                    editingProfile = true;
                    renderPage(true);
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

    // Mirrors the Discord flow: confirm before a join can cold-launch the game, and
    // register the op so the shared invite-result toast knows join from knock.
    async function requestJoin(cbId) {
        const entry = people.get(cbId);
        const p = entry && entry.person;
        if (!p) return;
        try {
            let running = false;
            if (window.GameStateManager) {
                running = await window.GameStateManager.checkGameRunning(p.game || 'boiii');
            }
            if (!running) {
                const idx = await window.showMessageBox(tGlobal('friends.joinLaunchTitle'), tGlobal('friends.joinLaunchBody'),
                    [tGlobal('friends.join'), { label: tGlobal('common.cancel'), danger: true }]);
                if (idx !== 0) return;
            }
        } catch (error) { return; }
        if (window.DiscordFriendsManager) window.DiscordFriendsManager.markPending(cbId, p.joinable ? 'join' : 'knock');
        friendAction('cbfriends-request-join', cbId);
    }

    function sendInvite(cbId) {
        if (window.DiscordFriendsManager) window.DiscordFriendsManager.markPending(cbId, 'invite');
        friendAction('cbfriends-invite-friend', cbId);
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
                renderPage();
            }
        } catch (error) { /* offline / preview */ }
    }

    // The sender's live match (map, mode, server, players) from the friends list, when we have it.
    function inviteContext(inv) {
        const entry = people.get(inv.senderId);
        const p = entry && entry.person;
        if (!p || !p.online || !p.game) return '';
        return matchContext(p);
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
        renderPage();
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
        renderPage,
        start() {
            if (started) return;
            started = true;

            const panel = document.getElementById('friends-panel');
            if (panel) {
                panel.addEventListener('click', (event) => {
                    const target = event.target;
                    if (target.closest('#friends-create-open')) return openCreateForm();
                    if (target.closest('#friends-link-discord')) return linkDiscord();
                    if (target.closest('#cb-create-btn')) return submitCreate();
                    if (target.closest('#cb-create-cancel')) return closeCreateForm();
                    if (target.closest('#friends-recover-open')) return openRecoverForm();
                    if (target.closest('#cb-recover-btn')) return submitRecover();
                    if (target.closest('#cb-recover-cancel')) return closeRecoverForm();
                    if (target.closest('#cb-self-more')) return openSelfMenu(event);
                    if (target.closest('[data-cb-view-self]')) return viewOwnProfile();
                    const personLink = target.closest('[data-person-link]');
                    if (personLink) {
                        const el = personLink.closest('[data-person-id]');
                        if (el && window.PersonMenu) {
                            window.PersonMenu.showCard({
                                cbId: el.getAttribute('data-person-id'),
                                handle: el.getAttribute('data-person-handle'),
                                displayName: el.getAttribute('data-person-name'),
                                relation: el.getAttribute('data-person-relation') || '',
                            });
                        }
                        return;
                    }
                    if (target.closest('#cb-edit-btn')) return editOwnProfile();
                    if (target.closest('#cb-edit-save')) return submitEdit();
                    if (target.closest('#cb-edit-cancel')) { editingProfile = false; return renderPage(true); }
                    if (target.closest('#cb-add-btn')) return submitAdd();
                    const accept = target.closest('[data-cb-accept]');
                    if (accept) return friendAction('cbfriends-accept', accept.getAttribute('data-cb-accept'));
                    const decline = target.closest('[data-cb-decline]');
                    if (decline) return friendAction('cbfriends-decline', decline.getAttribute('data-cb-decline'));
                    const cancel = target.closest('[data-cb-cancel]');
                    if (cancel) return friendAction('cbfriends-cancel', cancel.getAttribute('data-cb-cancel'));
                    const friendMore = target.closest('[data-friend-more]');
                    if (friendMore) return openFriendRowMenu(event, friendMore.getAttribute('data-friend-more'));
                    const join = target.closest('[data-friend-join]');
                    const joinTarget = join && rows.get(join.getAttribute('data-friend-join'));
                    if (joinTarget) return joinRow(joinTarget);
                    const invite = target.closest('[data-friend-invite]');
                    const inviteTarget = invite && rows.get(invite.getAttribute('data-friend-invite'));
                    if (inviteTarget) return inviteRow(inviteTarget);
                    const more = target.closest('[data-cb-more]');
                    if (more) return openRowMenu(event, more.getAttribute('data-cb-more'));
                    const byHandle = target.closest('[data-cb-add-handle]');
                    if (byHandle) return friendAction('cbfriends-add-friend', byHandle.getAttribute('data-cb-add-handle'));
                });
                panel.addEventListener('contextmenu', (event) => {
                    if (event.target.closest('[data-cb-self-card]')) return openSelfMenu(event);
                    const friendEl = event.target.closest('[data-friend-key]');
                    if (friendEl) return openFriendRowMenu(event, friendEl.getAttribute('data-friend-key'));
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
            setInterval(() => { if (pageVisible()) refresh(); }, VISIBLE_POLL_MS);

            if (window.InvitePrompt) {
                window.InvitePrompt.register('cb', {
                    active: () => lastState === 'ready',
                    getInvites: 'cbfriends-get-invites',
                    accept: 'cbfriends-accept-invite',
                    decline: 'cbfriends-decline-invite',
                    showNotification: 'cbfriends-show-invite-notification',
                    dismissNotification: 'cbfriends-dismiss-invite-notification',
                    context: inviteContext,
                });
                window.InvitePrompt.start();
            }
        }
    };
})();
