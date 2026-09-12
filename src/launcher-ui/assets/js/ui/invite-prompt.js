// One prompt path for game invites from both sources (Discord friends and CB friends): fetches each
// service's queue, toasts and prompts new entries once, and answers through that source's commands.
// The launcher nudges window.handleInvitesChanged the moment something lands; the interval is only
// the fallback, so a missed nudge costs a few seconds rather than the invite.

(function () {
    const FALLBACK_POLL_MS = 3 * 1000;
    const sources = new Map(); // source -> { config, shown, busy, pending }
    let started = false;

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // The invite carries a fork id (boiii, iw6x, ...), which is the UI id, not the backend key.
    function gameDisplayName(gameId) {
        if (!gameId || !window.GameUtils) return '';
        const config = window.GameUtils.getGameConfigByUIId(gameId);
        return (config && config.displayName) || '';
    }

    // html=true escapes for the in-app modal; the Windows toast takes plain text.
    function inviteStrings(invite, context, html) {
        const esc = html ? escapeHtml : (s) => s;
        const name = esc(invite.senderName || t('cb.aFriend'));
        const game = gameDisplayName(invite.gameId);
        let title, bodyKey, acceptLabel;
        if (invite.isApproval) {
            // A host accepted a join request we sent.
            title = t('friends.joinAcceptedTitle');
            bodyKey = 'friends.joinAcceptedBody';
            acceptLabel = t('friends.accept');
        } else if (invite.isRequest) {
            title = t('friends.joinRequestTitle');
            bodyKey = invite.needsOpen ? 'friends.joinRequestOpenBody' : 'friends.joinRequestBody';
            acceptLabel = t('friends.approve');
        } else {
            title = t('friends.inviteTitle');
            bodyKey = 'friends.inviteBody';
            acceptLabel = t('friends.accept');
        }

        // Naming the game needs its own phrasing per language, so fall back to the game-less
        // wording rather than interpolating an empty name when the fork can't be resolved.
        const lines = [t(game ? bodyKey + 'Game' : bodyKey)
            .replace('{name}', name)
            .replace('{game}', esc(game))];
        if (context && !invite.isRequest) lines.push(esc(context));
        return { title, body: lines.join(html ? '<br>' : '\n'), acceptLabel };
    }

    function dismiss(config, id) {
        window.executeCommand(config.dismissNotification, { id }).catch(() => {});
    }

    async function prompt(config, invite) {
        const context = config.context ? config.context(invite) : '';
        const { title, body, acceptLabel } = inviteStrings(invite, context, true);

        // Approvals normally connect on their own, so a desktop toast for them is just noise.
        if (!invite.isApproval) {
            const plain = inviteStrings(invite, context, false);
            window.executeCommand(config.showNotification, { id: invite.id, title: plain.title, body: plain.body })
                .catch(() => {});
            window.executeCommand('flash-taskbar').catch(() => {});
        }

        let accepted = false;
        try {
            const idx = await window.showMessageBox(title, body,
                [acceptLabel, { label: t('friends.decline'), danger: true }]);
            accepted = idx === 0;
        } catch (error) {
            console.warn('Invite prompt failed:', error);
            return;
        } finally {
            // Answered in the launcher: don't leave a toast around still offering the choice.
            dismiss(config, invite.id);
        }

        try {
            await window.executeCommand(accepted ? config.accept : config.decline, { id: invite.id });
        } catch (error) {
            console.warn('Failed to respond to invite:', error);
        }
    }

    async function syncOnce(entry) {
        const { config, shown } = entry;
        if (!config.active()) { shown.clear(); return; }

        let res;
        try {
            res = await window.executeCommand(config.getInvites);
        } catch (error) {
            return;
        }

        const invites = (res && res.invites) || [];
        const ids = new Set(invites.map(i => i.id));
        for (const id of [...shown]) {
            if (!ids.has(id)) {
                shown.delete(id);
                dismiss(config, id);
            }
        }
        for (const invite of invites) {
            if (shown.has(invite.id)) continue;
            shown.add(invite.id);
            prompt(config, invite);
        }
    }

    // A nudge that lands mid-sync runs one more pass rather than a second concurrent one.
    async function sync(source) {
        const entry = sources.get(source);
        if (!entry) return;
        if (entry.busy) { entry.pending = true; return; }
        entry.busy = true;
        try {
            do {
                entry.pending = false;
                await syncOnce(entry);
            } while (entry.pending);
        } finally {
            entry.busy = false;
        }
    }

    window.handleInvitesChanged = function (source) {
        sync(source);
    };

    window.InvitePrompt = {
        // config: { active(), getInvites, accept, decline, showNotification, dismissNotification, context(invite) }
        register(source, config) {
            sources.set(source, { config, shown: new Set(), busy: false, pending: false });
        },
        sync,
        start() {
            if (started) return;
            started = true;
            setInterval(() => { for (const source of sources.keys()) sync(source); }, FALLBACK_POLL_MS);
        },
    };
})();
