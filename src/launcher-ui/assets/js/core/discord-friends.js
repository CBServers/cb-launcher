// Discord friends list — polls the launcher's Discord Social SDK bridge.
// Slow poll keeps the list fresh; a fast poll runs while an OAuth link
// attempt is in flight so the UI reacts as soon as the user approves.

(function () {
    const POLL_INTERVAL_MS = 30 * 1000;
    const VISIBLE_POLL_INTERVAL_MS = 4 * 1000; // fast refresh while the Friends page is open
    const FAST_POLL_INTERVAL_MS = 2 * 1000;
    const FAST_POLL_MAX_MS = 5 * 60 * 1000;

    let started = false;
    let fastPollTimer = null;
    let fastPollStartedAt = 0;
    let lastStatus = 'unknown';

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
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

    // Discord's reply lands well after the command returns, so the outcome is pushed back
    // separately; toasting on the command alone would report success for a dropped request.
    const pendingOps = new Map(); // userId | cbId -> 'invite' | 'join' | 'knock'

    // CB friends report through the same handleInviteResult path; they register their op here.
    function markPending(id, op) { pendingOps.set(id, op); }

    window.handleInviteResult = function (result) {
        if (!result || !window.showToast) return;

        const isKnock = pendingOps.get(result.userId) === 'knock';

        // 'deferred' is provisional (the real outcome follows once the match opens), and 'dropped'
        // is routine — already in the match, not joinable. Neither is worth interrupting the user for.
        if (result.status === 'deferred') return;
        pendingOps.delete(result.userId);

        switch (result.status) {
            case 'sent':
                window.showToast(t(result.op === 'invite'
                    ? 'toasts.inviteSent'
                    : (isKnock ? 'toasts.joinRequestSent' : 'toasts.joining')), 'success');
                break;
            case 'rate_limited':
                window.showToast(t('toasts.inviteRateLimited',
                    { seconds: Math.max(1, Math.ceil(result.retryAfter || 0)) }), 'error');
                break;
            case 'offline':
                window.showToast(t('toasts.friendOffline'), 'error');
                break;
            case 'dropped':
                console.info('Discord invite/join dropped (nothing to send):', result);
                break;
            default:
                window.showToast(t('toasts.inviteFailed') + (result.error ? ` (${result.error})` : ''), 'error');
                break;
        }
    };

    async function sendInvite(userId) {
        if (!userId) return;
        try {
            pendingOps.set(userId, 'invite');
            await window.executeCommand('discord-invite-friend', { userId });
        } catch (error) {
            pendingOps.delete(userId);
            console.warn('Failed to send invite:', error);
        }
    }

    async function requestJoin(userId, gameId, isKnock) {
        if (!userId) return;
        try {
            // Joining launches the game if it isn't running; confirm so a stray click can't
            // start a game out of nowhere (or yank the user out of a different one).
            const targetGame = gameId || 'boiii';
            let running = false;
            if (window.GameStateManager) {
                running = await window.GameStateManager.checkGameRunning(targetGame);
            }
            if (!running) {
                const idx = await window.showMessageBox(t('friends.joinLaunchTitle'), t('friends.joinLaunchBody'),
                    [t('friends.join'), { label: t('common.cancel'), danger: true }]);
                if (idx !== 0) return;
            }
            pendingOps.set(userId, isKnock ? 'knock' : 'join');
            await window.executeCommand('discord-request-join', { userId });
        } catch (error) {
            pendingOps.delete(userId);
            console.warn('Failed to request join:', error);
        }
    }

    // The sender's live match from the friends list: whatever follows the game in the details, plus the state.
    function inviteContext(invite) {
        if (!window.AppViews || typeof window.AppViews.getFriendsState !== 'function') return '';
        const friends = window.AppViews.getFriendsState().friends || [];
        const f = friends.find(x => x.id === invite.senderId);
        if (!f || !f.activityDetails) return '';
        const sep = f.activityDetails.indexOf(' - ');
        const parts = [];
        if (sep > 0) parts.push(f.activityDetails.slice(sep + 3));
        if (f.activityState) parts.push(f.activityState);
        return parts.join(' · ');
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
        markPending,

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
                    const moreBtn = event.target.closest('[data-friend-more]');
                    if (moreBtn) { window.AppViews.openFriendMenu(event, moreBtn.getAttribute('data-friend-more')); return; }
                    const inviteBtn = event.target.closest('[data-invite-user]');
                    if (inviteBtn) { sendInvite(inviteBtn.getAttribute('data-invite-user')); return; }
                    const joinBtn = event.target.closest('[data-join-user]');
                    if (joinBtn) {
                        requestJoin(joinBtn.getAttribute('data-join-user'), joinBtn.getAttribute('data-game-id'),
                            joinBtn.getAttribute('data-knock') === '1');
                    }
                });
                list.addEventListener('contextmenu', (event) => {
                    const row = event.target.closest('[data-friend-id]');
                    if (row && window.AppViews) window.AppViews.openFriendMenu(event, row.getAttribute('data-friend-id'));
                });
            }

            refresh();
            setInterval(refresh, POLL_INTERVAL_MS);
            // Keep the list (joinability, online state) live while the user is looking at it.
            setInterval(() => { if (friendsPageVisible()) refresh(); }, VISIBLE_POLL_INTERVAL_MS);

            if (window.InvitePrompt) {
                window.InvitePrompt.register('discord', {
                    active: () => currentStatus() === 'linked',
                    getInvites: 'discord-get-invites',
                    accept: 'discord-accept-invite',
                    decline: 'discord-decline-invite',
                    showNotification: 'show-invite-notification',
                    dismissNotification: 'dismiss-invite-notification',
                    context: inviteContext,
                });
                window.InvitePrompt.start();
            }
        }
    };
})();
