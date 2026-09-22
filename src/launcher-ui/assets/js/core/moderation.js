// Moderation page. Only drawn for accounts the worker reports a role for, and that is cosmetic:
// every endpoint behind these actions re-checks authority server-side.

(function () {
    const POLL_MS = 15 * 1000;
    const ROLE_POLL_MS = 60 * 1000;

    function t(k, v) { return window.LauncherI18n ? window.LauncherI18n.t('cb.' + k, v) : k; }

    let active = false;
    let timer = null;
    let roleTimer = null;
    let bound = false;
    let role = '';
    let tab = 'reports';
    let reports = [];
    let log = [];
    let lookup = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function when(ms) {
        if (!ms) return '';
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 1) return t('justNow');
        if (mins < 60) return t('minutesAgo', { n: mins });
        const hours = Math.round(mins / 60);
        if (hours < 24) return t('hoursAgo', { n: hours });
        return t('daysAgo', { n: Math.round(hours / 24) });
    }

    function name(person) {
        if (!person || !person.cbId) return t('unknownAccount');
        return person.handle ? '@' + person.handle : (person.displayName || t('unknownAccount'));
    }

    function roomName(id) {
        if (id === 'all') return t('allGames');
        const cfg = window.GameUtils && window.GameUtils.getGameConfigByUIId ? window.GameUtils.getGameConfigByUIId(id) : null;
        return (cfg && cfg.displayName) || id || '';
    }

    function categoryLabel(category) {
        return category ? t('reportCategories.' + category) : '';
    }

    function evidenceLine(m, reported) {
        return `
            <div class="mod-evidence-line${reported ? ' is-reported' : ''}">
                <span class="mod-evidence-who">${escapeHtml(m.displayName || m.handle || '')}</span>
                <span class="mod-evidence-text">${escapeHtml(m.text)}</span>
            </div>`;
    }

    // The reported line with what led up to it, as the worker read it from the room.
    function evidenceHtml(r) {
        if (!r.message) return '';
        const actions = r.messageRemoved
            ? `<span class="mod-tag is-muted">${escapeHtml(t('messageDeleted'))}</span>`
            : `<button class="mod-btn" data-remove-message="${escapeHtml(r.message.id)}">${escapeHtml(t('deleteMessage'))}</button>`;
        return `
            <div class="mod-evidence">
                <div class="mod-evidence-head">
                    <span>${escapeHtml(t('inRoomChat', { room: roomName(r.room) }))}</span>
                    <span class="mod-evidence-actions">
                        ${actions}
                        <button class="mod-btn" data-purge>${escapeHtml(t('purgeRoom'))}</button>
                    </span>
                </div>
                ${(r.lines || []).map(m => evidenceLine(m, false)).join('')}
                ${evidenceLine(r.message, true)}
            </div>`;
    }

    // A profile report keeps what the reporter saw, since the account can edit it afterwards.
    function profileHtml(r) {
        if (!r.profile) return '';
        const p = r.profile;
        const fields = [
            [t('handle'), p.handle ? '@' + p.handle : ''],
            [t('displayName'), p.displayName],
            [t('aboutMe'), p.bio],
            [t('avatarUrl'), p.avatarUrl],
        ].filter(([, v]) => v);
        return `
            <div class="mod-evidence">
                <div class="mod-evidence-head"><span>${escapeHtml(t('profileAsReported'))}</span></div>
                ${fields.map(([k, v]) => `
                    <div class="mod-evidence-line">
                        <span class="mod-evidence-who">${escapeHtml(k)}</span>
                        <span class="mod-evidence-text">${escapeHtml(v)}</span>
                    </div>`).join('')}
            </div>`;
    }

    function muteButtons() {
        return `
            <button class="mod-btn" data-mute="60">${escapeHtml(t('mute1h'))}</button>
            <button class="mod-btn" data-mute="1440">${escapeHtml(t('mute1d'))}</button>
            <button class="mod-btn" data-mute="10080">${escapeHtml(t('mute1w'))}</button>
            <button class="mod-btn" data-mute-permanent>${escapeHtml(t('mutePermanent'))}</button>`;
    }

    // A row carries the target, room and a ready-made mute reason, so the actions need no second lookup.
    function reportHtml(r) {
        const category = categoryLabel(r.category);
        const muteReason = [category, r.reason].filter(Boolean).join(': ');
        return `
            <div class="mod-row mod-report" data-report="${escapeHtml(r.id)}" data-target="${escapeHtml(r.target.cbId || '')}"
                 data-target-handle="${escapeHtml(r.target.handle || '')}" data-room="${escapeHtml(r.room || '')}"
                 data-mute-reason="${escapeHtml(muteReason)}">
                <div class="mod-row-main">
                    <div class="mod-row-title">${escapeHtml(name(r.target))}
                        ${category ? `<span class="mod-tag">${escapeHtml(category)}</span>` : ''}</div>
                    ${r.reason || !category ? `<div class="mod-row-reason">${escapeHtml(r.reason || t('noReasonGiven'))}</div>` : ''}
                    ${evidenceHtml(r)}
                    ${profileHtml(r)}
                    <div class="mod-row-meta">${escapeHtml(t('reportedBy', { name: name(r.reporter) }))} &middot; ${escapeHtml(when(r.at))}</div>
                </div>
                <div class="mod-row-actions">
                    ${muteButtons()}
                    <button class="mod-btn is-primary" data-resolve>${escapeHtml(t('resolve'))}</button>
                </div>
            </div>`;
    }

    function logHtml(e) {
        const target = e.target && e.target.cbId ? ' → ' + name(e.target) : '';
        return `
            <div class="mod-log-row">
                <span class="mod-log-action">${escapeHtml(e.action)}</span>
                <span class="mod-log-who">${escapeHtml(name(e.by))}${escapeHtml(target)}</span>
                <span class="mod-log-detail">${escapeHtml(e.detail || '')}</span>
                <span class="mod-log-when">${escapeHtml(when(e.at))}</span>
            </div>`;
    }

    function lookupHtml() {
        if (!lookup) return `<div class="mod-empty">${escapeHtml(t('lookupHint'))}</div>`;
        const p = lookup.person || {};
        const permanent = lookup.muted && !lookup.mutedUntil;
        const muted = permanent || (lookup.mutedUntil && lookup.mutedUntil > Date.now());
        const muteLine = permanent
            ? t('mutedPermanently', { reason: lookup.muteReason || '' })
            : t('mutedUntil', { when: new Date(lookup.mutedUntil).toLocaleString(), reason: lookup.muteReason || '' });
        return `
            <div class="mod-card" data-target="${escapeHtml(p.cbId || '')}" data-target-handle="${escapeHtml(p.handle || '')}">
                <div class="mod-card-title">${escapeHtml(name(p))}</div>
                <div class="mod-card-meta">
                    ${escapeHtml(t('memberSince'))} ${escapeHtml(p.createdAt ? new Date(p.createdAt * 1000).toLocaleDateString() : '?')}
                    &middot; ${escapeHtml(t('deviceCount', { n: lookup.deviceCount || 0 }))}
                    ${lookup.role ? ' &middot; <strong>' + escapeHtml(lookup.role) + '</strong>' : ''}
                </div>
                ${muted ? `<div class="mod-card-mute">${escapeHtml(muteLine)}</div>` : ''}
                <div class="mod-row-actions">
                    ${muted
                        ? `<button class="mod-btn is-primary" data-mute="0">${escapeHtml(t('unmute'))}</button>`
                        : muteButtons()}
                    ${role === 'admin' && lookup.role !== 'admin'
                        ? `<button class="mod-btn" data-role="${lookup.role === 'mod' ? 'none' : 'mod'}">${escapeHtml(lookup.role === 'mod' ? t('revokeMod') : t('grantMod'))}</button>`
                        : ''}
                </div>
            </div>`;
    }

    function render() {
        const body = document.getElementById('moderation-body');
        if (!body) return;
        if (!role) { body.innerHTML = ''; return; }

        const tabs = [['reports', t('reportQueue')], ['lookup', t('lookup')], ['log', t('auditLog')]];
        body.innerHTML = `
            <div class="mod-tabs">
                ${tabs.map(([id, label]) =>
                    `<button class="mod-tab${tab === id ? ' active' : ''}" data-tab="${id}">${escapeHtml(label)}</button>`).join('')}
            </div>
            <div class="mod-panel">${panelHtml()}</div>`;
    }

    function panelHtml() {
        if (tab === 'log') {
            return log.length ? log.map(logHtml).join('') : `<div class="mod-empty">${escapeHtml(t('noActions'))}</div>`;
        }
        if (tab === 'lookup') {
            return `
                <div class="mod-lookup-bar">
                    <input type="text" id="mod-lookup-input" placeholder="${escapeHtml(t('lookupPlaceholder'))}" />
                    <button class="mod-btn is-primary" id="mod-lookup-btn">${escapeHtml(t('lookup'))}</button>
                </div>
                ${lookupHtml()}`;
        }
        return reports.length ? reports.map(reportHtml).join('') : `<div class="mod-empty">${escapeHtml(t('queueClear'))}</div>`;
    }

    // Patches the list in place so the lookup field keeps focus and text while the timer runs.
    function patch() {
        const panel = document.querySelector('#moderation-body .mod-panel');
        if (!panel) return render();
        if (tab === 'lookup') {
            const card = panel.querySelector('.mod-card, .mod-empty');
            if (card) card.outerHTML = lookupHtml();
            return;
        }
        panel.innerHTML = panelHtml();
    }

    async function fetchAll() {
        try {
            const [rep, lg, look] = await Promise.all([
                window.executeCommand('cbfriends-mod-get-reports'),
                window.executeCommand('cbfriends-mod-get-log'),
                window.executeCommand('cbfriends-mod-get-lookup'),
            ]);
            reports = (rep && rep.reports) || [];
            log = (lg && lg.entries) || [];
            lookup = (look && look.account) || null;
        } catch (error) { /* offline / preview */ }
    }

    async function refreshRole() {
        let res;
        try { res = await window.executeCommand('cbfriends-mod-status'); } catch (error) { return; }
        const next = (res && res.role) || '';
        if (next === role) return;
        role = next;
        applyVisible();
        if (active) { await fetchAll(); render(); }
    }

    // The nav item only exists for accounts the worker gave a role to.
    function applyVisible() {
        const nav = document.getElementById('moderation');
        if (!nav) return;
        nav.style.display = role ? '' : 'none';
        if (!role && nav.classList.contains('active')) {
            const home = document.getElementById('home');
            if (home) home.click();
        }
    }

    async function act(command, data) {
        try { await window.executeCommand(command, data); } catch (error) { return; }
        setTimeout(async () => { await fetchAll(); patch(); }, 400);
    }

    async function confirmThen(title, body, confirmLabel, run) {
        const idx = await window.showMessageBox(escapeHtml(title), escapeHtml(body),
            [{ label: confirmLabel, danger: true }, t('cancel')]);
        if (idx === 0) run();
    }

    function bind() {
        if (bound) return;
        const body = document.getElementById('moderation-body');
        if (!body) return;
        bound = true;

        body.addEventListener('click', (event) => {
            const tabBtn = event.target.closest('[data-tab]');
            if (tabBtn) { tab = tabBtn.getAttribute('data-tab'); return render(); }

            if (event.target.closest('#mod-lookup-btn')) {
                const input = document.getElementById('mod-lookup-input');
                const handle = input ? input.value.trim().replace(/^@/, '') : '';
                if (handle) act('cbfriends-mod-lookup', { handle });
                return;
            }

            const row = event.target.closest('[data-target]');
            const target = row ? row.getAttribute('data-target') : '';

            const reason = row ? row.getAttribute('data-mute-reason') || '' : '';
            const handle = row ? row.getAttribute('data-target-handle') || '' : '';

            const mute = event.target.closest('[data-mute]');
            if (mute && target) {
                const minutes = parseInt(mute.getAttribute('data-mute'), 10) || 0;
                return act('cbfriends-mod-mute', { cbId: target, minutes, reason });
            }

            if (event.target.closest('[data-mute-permanent]') && target) {
                return confirmThen(t('mutePermanentTitle', { handle }), t('mutePermanentBody'), t('mutePermanent'),
                    () => act('cbfriends-mod-mute', { cbId: target, minutes: 0, permanent: true, reason }));
            }

            const removeBtn = event.target.closest('[data-remove-message]');
            if (removeBtn && row) {
                return act('cbfriends-mod-remove-message', {
                    room: row.getAttribute('data-room'),
                    id: Number(removeBtn.getAttribute('data-remove-message')),
                    reportId: row.getAttribute('data-report') || '',
                });
            }

            if (event.target.closest('[data-purge]') && row && target) {
                const room = row.getAttribute('data-room');
                return confirmThen(t('purgeTitle', { handle }), t('purgeBody', { room: roomName(room) }), t('purgeConfirm'),
                    () => act('cbfriends-mod-purge', { room, cbId: target }));
            }

            const roleBtn = event.target.closest('[data-role]');
            if (roleBtn && target) {
                return act('cbfriends-mod-set-role', { cbId: target, role: roleBtn.getAttribute('data-role') });
            }

            const resolve = event.target.closest('[data-resolve]');
            if (resolve) {
                const reportRow = event.target.closest('[data-report]');
                if (reportRow) return act('cbfriends-mod-resolve', { id: reportRow.getAttribute('data-report') });
            }
        });

        body.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && event.target.id === 'mod-lookup-input') {
                document.getElementById('mod-lookup-btn').click();
            }
        });
    }

    window.ModerationManager = {
        getRole() { return role; },
        start() {
            if (roleTimer) return;
            refreshRole();
            roleTimer = setInterval(refreshRole, ROLE_POLL_MS);
        },
        setActive(on) {
            active = on && !!role;
            window.executeCommand('cbfriends-set-mod-active', { active }).catch(() => {});
            if (active) {
                bind();
                fetchAll().then(render);
                if (!timer) timer = setInterval(async () => { await fetchAll(); patch(); }, POLL_MS);
            } else if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
    };
})();
