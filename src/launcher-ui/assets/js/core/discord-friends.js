// Discord friends list — polls the launcher's Discord Social SDK bridge.
// Slow poll keeps the list fresh; a fast poll runs while an OAuth link
// attempt is in flight so the UI reacts as soon as the user approves.

(function () {
    const POLL_INTERVAL_MS = 30 * 1000;
    const VISIBLE_POLL_INTERVAL_MS = 4 * 1000; // fast refresh while the Friends page is open
    const FAST_POLL_INTERVAL_MS = 2 * 1000;
    const FAST_POLL_MAX_MS = 5 * 60 * 1000;
    const INVITE_POLL_INTERVAL_MS = 3 * 1000;

    let started = false;
    let fastPollTimer = null;
    let fastPollStartedAt = 0;
    let lastStatus = 'unknown';
    const shownInvites = new Set(); // invite ids currently being prompted, to avoid re-prompting

    function t(key) {
        return window.LauncherI18n ? window.LauncherI18n.t(key) : key;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function refresh() {
        if (!window.AppViews || typeof window.AppViews.refreshFriends !== 'function') return;
        await window.AppViews.refreshFriends();
        handleStatusTransition();
    }

    function currentStatus() {
        if (!window.AppViews || typeof window.AppViews.getFriendsState !== 'function') return 'unknown';
        return window.AppViews.getFriendsState().status;
    }

    function friendsPageVisible() {
        const page = document.getElementById('friends-page');
        return !!page && page.style.display !== 'none';
    }

    function syncSettingsRow() {
        const settingsPage = document.getElementById('settings-page');
        if (settingsPage && settingsPage.style.display !== 'none' &&
            typeof window.setupDiscordSettings === 'function') {
            window.setupDiscordSettings();
        }
    }

    function handleStatusTransition() {
        const status = currentStatus();
        const previous = lastStatus;
        lastStatus = status;

        if (status !== 'linking' && status !== 'connecting') {
            stopFastPoll();
        }

        if (status === previous) return;
        syncSettingsRow();

        if (!window.showToast) return;
        const wasLinking = previous === 'linking' || previous === 'connecting';
        if (status === 'linked' && wasLinking) {
            window.showToast(t('toasts.discordLinked'), 'success');
        } else if (status === 'unlinked' && wasLinking) {
            const error = window.AppViews.getFriendsState().error;
            window.showToast(t('toasts.discordLinkFailed') + (error ? ` (${error})` : ''), 'error');
        }
    }

    function stopFastPoll() {
        if (fastPollTimer) {
            clearInterval(fastPollTimer);
            fastPollTimer = null;
        }
    }

    function pollFast() {
        if (fastPollTimer) return;
        fastPollStartedAt = Date.now();
        fastPollTimer = setInterval(() => {
            if (Date.now() - fastPollStartedAt > FAST_POLL_MAX_MS) {
                stopFastPoll();
                return;
            }
            refresh();
        }, FAST_POLL_INTERVAL_MS);
    }

    async function sendInvite(userId) {
        if (!userId) return;
        try {
            await window.executeCommand('discord-invite-friend', { userId });
            if (window.showToast) window.showToast(t('toasts.inviteSent'), 'success');
        } catch (error) {
            console.warn('Failed to send invite:', error);
        }
    }

    async function requestJoin(userId) {
        if (!userId) return;
        try {
            await window.executeCommand('discord-request-join', { userId });
            if (window.showToast) window.showToast(t('toasts.joinRequestSent'), 'success');
        } catch (error) {
            console.warn('Failed to request join:', error);
        }
    }

    async function promptInvite(invite) {
        const name = escapeHtml(invite.senderName || 'A friend');
        const isRequest = !!invite.isRequest;
        const isApproval = !!invite.isApproval;
        let title, bodyKey, acceptLabel;
        if (isApproval) {
            // A host accepted a join request we sent.
            title = t('friends.joinAcceptedTitle');
            bodyKey = 'friends.joinAcceptedBody';
            acceptLabel = t('friends.accept');
        } else if (isRequest) {
            title = t('friends.joinRequestTitle');
            bodyKey = 'friends.joinRequestBody';
            acceptLabel = t('friends.approve');
        } else {
            title = t('friends.inviteTitle');
            bodyKey = 'friends.inviteBody';
            acceptLabel = t('friends.accept');
        }
        const body = t(bodyKey).replace('{name}', name);

        let accepted = false;
        try {
            const idx = await window.showMessageBox(title, body,
                [acceptLabel, { label: t('friends.decline'), danger: true }]);
            accepted = idx === 0;
        } catch (error) {
            console.warn('Invite prompt failed:', error);
            return;
        }

        try {
            const command = accepted ? 'discord-accept-invite' : 'discord-decline-invite';
            await window.executeCommand(command, { id: invite.id });
        } catch (error) {
            console.warn('Failed to respond to invite:', error);
        }
    }

    async function pollInvites() {
        if (currentStatus() !== 'linked') {
            shownInvites.clear();
            return;
        }

        let res;
        try {
            res = await window.executeCommand('discord-get-invites');
        } catch (error) {
            return;
        }

        const invites = (res && res.invites) || [];
        const ids = new Set(invites.map(i => i.id));
        for (const id of [...shownInvites]) {
            if (!ids.has(id)) shownInvites.delete(id);
        }

        for (const invite of invites) {
            if (shownInvites.has(invite.id)) continue;
            shownInvites.add(invite.id);
            window.executeCommand('flash-taskbar').catch(() => {});
            promptInvite(invite);
        }
    }

    async function beginLink() {
        try {
            await window.executeCommand('discord-link');
            pollFast();
            refresh();
        } catch (error) {
            console.warn('Failed to start Discord link:', error);
        }
    }

    async function unlink() {
        try {
            await window.executeCommand('discord-unlink');
            if (window.showToast) window.showToast(t('toasts.discordUnlinked'), 'info');
            pollFast();
            refresh();
        } catch (error) {
            console.warn('Failed to unlink Discord:', error);
        }
    }

    window.DiscordFriendsManager = {
        refresh,
        beginLink,
        unlink,
        pollFast,
        sendInvite,
        requestJoin,

        start() {
            if (started) return;
            started = true;

            const linkBtn = document.getElementById('friends-link-btn');
            if (linkBtn) {
                linkBtn.addEventListener('click', beginLink);
            }

            // Delegated handler for the per-friend Invite buttons (rows are re-rendered on each refresh).
            const list = document.getElementById('friends-list');
            if (list) {
                list.addEventListener('click', (event) => {
                    const inviteBtn = event.target.closest('[data-invite-user]');
                    if (inviteBtn) { sendInvite(inviteBtn.getAttribute('data-invite-user')); return; }
                    const joinBtn = event.target.closest('[data-join-user]');
                    if (joinBtn) requestJoin(joinBtn.getAttribute('data-join-user'));
                });
            }

            refresh();
            setInterval(refresh, POLL_INTERVAL_MS);
            // Keep the list (joinability, online state) live while the user is looking at it.
            setInterval(() => { if (friendsPageVisible()) refresh(); }, VISIBLE_POLL_INTERVAL_MS);
            setInterval(pollInvites, INVITE_POLL_INTERVAL_MS);
        }
    };
})();
