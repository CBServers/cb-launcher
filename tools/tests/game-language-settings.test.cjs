const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const uiRoot = path.join(__dirname, '../../src/launcher-ui/assets/js');
const source = fs.readFileSync(path.join(uiRoot, 'popups/game-settings-popup.js'), 'utf8');

class Element {
    constructor() {
        this.style = {};
        this.options = [];
        this.listeners = {};
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.classes = new Set();
        this.classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key) };
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren() { this.options = []; this.value = ''; }
    appendChild(element) { this.options.push(element); }
    matches(selector) { return selector.split(',').map(value => value.trim()).includes(this.selector); }
}

function fixture(executeCommand) {
    const elements = new Map();
    const popup = { querySelector: selector => {
        if (!elements.has(selector)) {
            const element = new Element();
            element.selector = selector;
            elements.set(selector, element);
        }
        return elements.get(selector);
    }, querySelectorAll: () => [...elements.values()].filter(element => element.isControl) };
    for (const selector of ['#browse-btn', '.btn-reset', '.popup-close', '.btn-cancel', '#other-setting-input', '#other-setting-toggle', '#initially-disabled']) {
        popup.querySelector(selector).isControl = true;
    }
    popup.querySelector('#initially-disabled').disabled = true;
    const timers = new Map();
    let nextTimer = 0;
    const observers = [];
    const context = vm.createContext({
        window: { executeCommand, LauncherI18n: { getLanguage: () => 'fr' } },
        document: { createElement: () => new Element() },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe() { this.active = true; }
            disconnect() { this.active = false; }
        },
        setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: id => timers.delete(id)
    });
    const LanguageSettings = vm.runInContext(source + '\nGameLanguageSettings;', context);
    const controls = new LanguageSettings(popup, key => key.split('.').at(-1));
    return { controls, elements, timers, observers, context, popup };
}

function info(overrides = {}) {
    return {
        supported: true,
        selected: 'source',
        installed: 'Original files',
        options: [{ value: 'source', label: 'Original' }, { value: 'auto', label: 'CB language' }, { value: 'fr', label: 'French' }],
        active: { running: false },
        ...overrides
    };
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

test('only BO1, BO2 and WaW controls are displayed', async () => {
    let calls = 0;
    const { controls } = fixture(async () => { calls++; return info(); });
    await controls.show('bo3');
    assert.equal(controls.section.style.display, 'none');
    assert.equal(calls, 0);
    for (const game of ['t4', 't5', 't6']) {
        await controls.show(game);
        assert.equal(controls.section.style.display, 'block');
        assert.equal(controls.ready, true);
    }
});

test('uses native options and makes no download when viewing settings', async () => {
    const calls = [];
    const { controls } = fixture(async (command, payload) => { calls.push({ command, payload }); return info(); });
    await controls.show('t5');
    assert.deepEqual(controls.select.options.map(option => option.value), ['source', 'auto', 'fr']);
    assert.equal(controls.select.options[0].textContent, 'gameLanguageSource');
    assert.equal(controls.select.options[2].textContent, 'French');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'get-game-languages');
    assert.equal(calls[0].payload.game, 't5');
    assert.equal(controls.applyButton.textContent, 'gameLanguageRestore');
});

test('a download starts once and stays locked until native completion', async () => {
    const calls = [];
    let active = false;
    let finished = false;
    const { controls, elements, timers } = fixture(async (command, payload) => {
        calls.push({ command, payload });
        if (command === 'apply-game-language') { active = true; return { started: true }; }
        return info({ selected: finished ? 'fr' : 'source', active: { running: active, message: active ? 'Downloading' : finished ? 'Verified' : '' } });
    });
    await controls.show('t6');
    controls.select.value = 'fr';
    const request = controls.apply();
    await controls.apply();
    await request;
    assert.equal(calls.filter(call => call.command === 'apply-game-language').length, 1);
    const payload = calls.find(call => call.command === 'apply-game-language').payload;
    assert.equal(payload.game, 't6');
    assert.equal(payload.language, 'fr');
    assert.equal(payload.launcherLanguage, 'fr');
    assert.equal(controls.busy, true);
    assert.equal(controls.status.textContent, 'Downloading');
    assert.equal(elements.get('#browse-btn').disabled, true);
    assert.equal(elements.get('.btn-reset').disabled, true);
    assert.equal(timers.size, 1);
    active = false;
    finished = true;
    await controls.refresh(controls.epoch);
    assert.equal(controls.busy, false);
    assert.equal(controls.select.value, 'fr');
    assert.equal(controls.status.textContent, 'Verified');
    assert.equal(elements.get('#browse-btn').disabled, false);
});

test('refused work reports the native error without reporting saved success', async () => {
    const { controls, elements } = fixture(async command => command === 'apply-game-language'
        ? { started: false, error: 'Close the game first' } : info());
    await controls.show('t4');
    controls.select.value = 'fr';
    await controls.apply();
    assert.equal(controls.busy, false);
    assert.equal(controls.status.textContent, 'Close the game first');
    assert.equal(controls.status.classes.has('is-error'), true);
    assert.equal(elements.get('.btn-reset').disabled, false);
});

test('old game responses cannot replace the current game choices', async () => {
    const old = deferred();
    const { controls } = fixture(async (command, payload) => payload.game === 't4'
        ? old.promise : info({ options: [{ value: 'fr', label: 'BO1 French' }], selected: 'fr' }));
    const previous = controls.show('t4');
    await controls.show('t5');
    old.resolve(info({ options: [{ value: 'ko', label: 'WaW Korean' }], selected: 'ko' }));
    await previous;
    assert.deepEqual(controls.select.options.map(option => option.value), ['fr']);
    assert.equal(controls.select.value, 'fr');
});

test('closing ignores a late apply response and stops polling', async () => {
    const started = deferred();
    let calls = 0;
    const { controls, timers } = fixture(async command => {
        calls++;
        return command === 'apply-game-language' ? started.promise : info();
    });
    await controls.show('t5');
    const request = controls.apply();
    controls.close();
    started.resolve({ started: true });
    await request;
    assert.equal(calls, 2);
    assert.equal(timers.size, 0);
    assert.equal(controls.ready, false);
});

test('a failed status read keeps active work locked and schedules another check', async () => {
    let failed = false;
    const { controls, timers } = fixture(async () => {
        if (failed) throw new Error('bridge unavailable');
        return info({ active: { running: true } });
    });
    await controls.show('t4');
    failed = true;
    await controls.refresh(controls.epoch);
    assert.equal(controls.busy, true);
    assert.equal(controls.select.disabled, true);
    assert.equal(controls.status.textContent, 'gameLanguageStatusFailed');
    assert.equal(timers.size, 1);
    controls.close();
    assert.equal(timers.size, 0);
});

test('idle status reads preserve an unapplied choice', async () => {
    const { controls } = fixture(async () => info());
    await controls.show('t6');
    controls.select.value = 'fr';
    await controls.refresh(controls.epoch);
    assert.equal(controls.select.value, 'fr');
});

test('offline download refusal is shown and original files can still be selected', async () => {
    const message = 'Language downloads are unavailable in offline mode. Original files can still be restored.';
    const { controls } = fixture(async command => command === 'apply-game-language'
        ? { started: false, error: message } : info());
    await controls.show('t5');
    controls.select.value = 'fr';
    await controls.apply();
    assert.equal(controls.status.textContent, message);
    assert.equal(controls.select.disabled, false);
    controls.select.value = 'source';
    controls.updateButton();
    assert.equal(controls.applyButton.textContent, 'gameLanguageRestore');
});

test('a missing start response is an error, never a success', async () => {
    const { controls } = fixture(async command => command === 'apply-game-language' ? undefined : info());
    await controls.show('t6');
    await controls.apply();
    assert.equal(controls.busy, false);
    assert.equal(controls.status.textContent, 'gameLanguageStartFailed');
    assert.equal(controls.status.classes.has('is-error'), true);
});

test('reopening settings observes an existing native operation without starting another', async () => {
    const commands = [];
    const { controls, timers } = fixture(async command => {
        commands.push(command);
        return info({ active: { running: true, message: 'Downloading files' } });
    });
    await controls.show('t4');
    assert.equal(controls.busy, true);
    controls.close();
    assert.equal(timers.size, 0);
    await controls.show('t4');
    assert.equal(controls.busy, true);
    assert.equal(controls.status.textContent, 'Downloading files');
    assert.equal(timers.size, 1);
    assert.deepEqual(commands, ['get-game-languages', 'get-game-languages']);
});

test('all editable settings lock during work and recover their original disabled state', async () => {
    let running = true;
    const { controls, elements, observers, popup } = fixture(async () => info({ active: { running } }));
    await controls.show('t5');
    for (const selector of ['#browse-btn', '.btn-reset', '#other-setting-input', '#other-setting-toggle', '#initially-disabled']) {
        assert.equal(elements.get(selector).disabled, true);
    }
    assert.equal(elements.get('.popup-close').disabled, false);
    assert.equal(elements.get('.btn-cancel').disabled, false);
    const added = popup.querySelector('#late-toggle');
    added.isControl = true;
    observers[0].callback();
    assert.equal(added.disabled, true);
    running = false;
    await controls.refresh(controls.epoch);
    for (const selector of ['#browse-btn', '.btn-reset', '#other-setting-input', '#other-setting-toggle', '#late-toggle']) {
        assert.equal(elements.get(selector).disabled, false);
    }
    assert.equal(elements.get('#initially-disabled').disabled, true);
    assert.equal(observers[0].active, false);
});

test('interrupted work displays a recovery instruction even without a native status message', async () => {
    const { controls } = fixture(async () => info({ recoveryRequired: true }));
    await controls.show('t6');
    assert.equal(controls.status.textContent, 'gameLanguageRecoveryRequired');
    assert.equal(controls.status.classes.has('is-error'), true);
    assert.equal(controls.applyButton.disabled, false);
});

test('new strings are translated in every existing launcher locale', () => {
    const context = vm.createContext({ window: {}, document: { documentElement: {} } });
    vm.runInContext(fs.readFileSync(path.join(uiRoot, 'core/i18n.js'), 'utf8'), context);
    const titles = { en: 'Game language', fr: 'Langue du jeu', es: 'Idioma del juego', ru: 'Язык игры' };
    for (const [language, title] of Object.entries(titles)) {
        context.window.LauncherI18n.setLanguage(language);
        assert.equal(context.window.LauncherI18n.t('popup.gameSettings.gameLanguageTitle'), title);
        assert.match(context.window.LauncherI18n.t('popup.gameSettings.gameLanguageSourceNotice'), /Eroded Networks/);
        for (const key of ['gameLanguageRecoveryRequired', 'gameLanguageApply', 'gameLanguageStatusFailed']) {
            assert.notEqual(context.window.LauncherI18n.t(`popup.gameSettings.${key}`), `popup.gameSettings.${key}`);
        }
    }
});
