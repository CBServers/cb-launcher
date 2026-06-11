// Discord friends list — polls the launcher's Discord Social SDK bridge.
// Slow poll keeps the list fresh; a fast poll runs while an OAuth link
// attempt is in flight so the UI reacts as soon as the user approves.

(function () {
    const POLL_INTERVAL_MS = 30 * 1000;
    const FAST_POLL_INTERVAL_MS = 2 * 1000;
    const FAST_POLL_MAX_MS = 5 * 60 * 1000;

    let started = false;
    let fastPollTimer = null;
    let fastPollStartedAt = 0;
    let lastStatus = 'unknown';

    function t(key) {
        return window.LauncherI18n ? window.LauncherI18n.t(key) : key;
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
        } else if (status === 'unlinked' && previous === 'linking') {
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

    async function beginLink() {
        try {
            await window.executeCommand('discord-link');
            lastStatus = 'linking';
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

        start() {
            if (started) return;
            started = true;

            const linkBtn = document.getElementById('friends-link-btn');
            if (linkBtn) {
                linkBtn.addEventListener('click', beginLink);
            }

            refresh();
            setInterval(refresh, POLL_INTERVAL_MS);
        }
    };
})();
