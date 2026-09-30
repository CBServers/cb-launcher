// Mod download queue: installs run one at a time, holding while their game has a file op running.
(function () {
    'use strict';

    const RETRY_MS = 2000;

    const queue = [];
    let active = null;
    let seq = 0;
    let retryTimer = null;

    function t(key, variables) {
        return window.LauncherI18n ? window.LauncherI18n.t(key, variables) : key;
    }

    function emit(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail }));
        } catch (_) {}
    }

    function changed() {
        emit('cb-mod-queue-changed');
    }

    function gameOpActive(gameId) {
        const games = window.DownloadQueueManager;
        return !!(games && games.active && games.active.blocksGameButtons && games.active.gameId === gameId);
    }

    function startable(entry) {
        return !gameOpActive(entry.gameId) && entry.retryAt <= Date.now();
    }

    function scheduleRetry() {
        clearTimeout(retryTimer);
        const now = Date.now();
        const next = queue.reduce((soonest, entry) => entry.retryAt > now ? Math.min(soonest, entry.retryAt) : soonest, Infinity);
        if (next !== Infinity) {
            retryTimer = setTimeout(processNext, next - now);
        }
    }

    function processNext() {
        if (active) return;
        const index = queue.findIndex(startable);
        if (index < 0) {
            scheduleRetry();
            return;
        }

        const entry = queue.splice(index, 1)[0];
        entry.phase = 'preparing';
        entry.percent = 0;
        entry.waiting = false;
        active = entry;
        changed();
        run(entry);
    }

    async function run(entry) {
        let result = null;
        let error = null;
        try {
            result = await window.ModsService.install(entry.gameId, entry.item, job => {
                // A cancel sent before the backend job existed is repeated until it takes.
                if (entry.cancelled) window.ModsService.cancelInstall(entry.gameId);
                if (job.phase === 'done') return;
                entry.phase = job.phase === 'queued' ? 'preparing' : (job.phase || entry.phase);
                entry.percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
                entry.detail = job.name || '';
                emit('cb-mod-queue-progress', { gameId: entry.gameId, id: entry.id });
            });
        } catch (e) {
            error = e;
        }
        active = null;

        // An in-game Workshop request or an import holds the game's slot; keep our place and retry.
        if (error && error.busy && !entry.cancelled) {
            entry.waiting = true;
            entry.retryAt = Date.now() + RETRY_MS;
            queue.push(entry);
            queue.sort((a, b) => a.seq - b.seq);
        } else if (entry.cancelled && !(result && result.success)) {
            entry.resolve({ success: false, cancelled: true });
        } else if (error) {
            entry.reject(error);
        } else {
            entry.resolve(result);
        }

        changed();
        processNext();
    }

    function find(gameId, id) {
        if (active && active.gameId === gameId && active.id === id) return active;
        return queue.find(entry => entry.gameId === gameId && entry.id === id) || null;
    }

    // info: { id, size, title, kind, preview, op }. Resolves with the install result, rejects on failure.
    function enqueue(gameId, info) {
        const existing = find(gameId, info.id);
        if (existing) return existing.promise;

        const entry = {
            seq: ++seq,
            gameId,
            id: info.id,
            item: { id: info.id, size: info.size || 0 },
            title: info.title || info.id,
            kind: info.kind || 'mod',
            preview: info.preview || '',
            size: info.size || 0,
            op: info.op || 'install',
            phase: 'queued',
            percent: 0,
            detail: '',
            retryAt: 0,
            waiting: false,
            cancelled: false
        };
        entry.promise = new Promise((resolve, reject) => {
            entry.resolve = resolve;
            entry.reject = reject;
        });

        queue.push(entry);
        changed();
        processNext();

        if (active !== entry && typeof window.showToast === 'function') {
            window.showToast(t('mods.queuedToast', { name: entry.title }), 'info');
        }
        return entry.promise;
    }

    function cancel(gameId, id) {
        const index = queue.findIndex(entry => entry.gameId === gameId && entry.id === id);
        if (index >= 0) {
            const entry = queue.splice(index, 1)[0];
            entry.resolve({ success: false, cancelled: true });
            changed();
            scheduleRetry();
            return;
        }

        if (active && active.gameId === gameId && active.id === id && !active.cancelled) {
            active.cancelled = true;
            window.ModsService.cancelInstall(gameId);
            changed();
        }
    }

    function snapshot(entry, isActive, queuePosition) {
        return {
            gameId: entry.gameId,
            id: entry.id,
            title: entry.title,
            kind: entry.kind,
            preview: entry.preview,
            size: entry.size,
            op: entry.op,
            phase: entry.phase,
            percent: entry.percent,
            detail: entry.detail,
            waiting: entry.waiting,
            cancelled: entry.cancelled,
            isActive,
            queuePosition
        };
    }

    function get(gameId, id) {
        const entry = find(gameId, id);
        if (!entry) return null;
        return entry === active ? snapshot(entry, true, 0) : snapshot(entry, false, queue.indexOf(entry) + 1);
    }

    function getEntries() {
        const entries = active ? [snapshot(active, true, 0)] : [];
        queue.forEach((entry, index) => entries.push(snapshot(entry, false, index + 1)));
        return entries;
    }

    function isActiveFor(gameId) {
        return !!(active && active.gameId === gameId);
    }

    function hasJobsFor(gameId) {
        return isActiveFor(gameId) || queue.some(entry => entry.gameId === gameId);
    }

    // A game op finishing can free a held job.
    window.addEventListener('cb-download-queue-changed', processNext);

    window.ModQueue = {
        enqueue,
        cancel,
        get,
        getEntries,
        isActiveFor,
        hasJobsFor,
        count: () => (active ? 1 : 0) + queue.length
    };
})();
