// Early access: an admin-managed allowlist keyed by cbId, echoed to the account on its status poll.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const ADMIN = await mk(), MOD = await mk(), USER = await mk();
const adminId = (await call(ADMIN, '/v1/account/bootstrap', { hwidHash: await sha256Hex('adm'), handle: 'admin' })).b.cbId;
const modId = (await call(MOD, '/v1/account/bootstrap', { hwidHash: await sha256Hex('mod'), handle: 'themod' })).b.cbId;
const userId = (await call(USER, '/v1/account/bootstrap', { hwidHash: await sha256Hex('usr'), handle: 'tester' })).b.cbId;
await env.CB.put(`role:${adminId}`, 'admin');
await env.CB.put(`role:${modId}`, 'mod');

const features = async (who) => (await call(who, '/v1/mod/status')).b.features;

check('an account starts with no early access', JSON.stringify(await features(USER)) === '[]');

check('a normal account cannot grant itself access',
    (await call(USER, '/v1/mod/set-beta', { cbId: userId, feature: 'ww2', enabled: true })).s === 404);
check('neither can a mod',
    (await call(MOD, '/v1/mod/set-beta', { cbId: userId, feature: 'ww2', enabled: true })).s === 404);
check('an unknown feature is refused',
    (await call(ADMIN, '/v1/mod/set-beta', { cbId: userId, feature: 'bo7', enabled: true })).s === 400);
check('an unknown account is refused',
    (await call(ADMIN, '/v1/mod/set-beta', { cbId: 'cb_nobody', feature: 'ww2', enabled: true })).s === 404);

const grant = await call(ADMIN, '/v1/mod/set-beta', { cbId: userId, feature: 'ww2', enabled: true });
check('an admin can grant access', grant.s === 200 && JSON.stringify(grant.b.features) === '["ww2"]');
check('the tester sees it on its status poll', JSON.stringify(await features(USER)) === '["ww2"]');
check('granting twice does not duplicate it',
    JSON.stringify((await call(ADMIN, '/v1/mod/set-beta', { cbId: userId, feature: 'ww2', enabled: true })).b.features) === '["ww2"]');
check('lookup shows it to moderators',
    JSON.stringify((await call(MOD, '/v1/mod/lookup', { handle: 'tester' })).b.features) === '["ww2"]');

check('an admin can grant itself access',
    (await call(ADMIN, '/v1/mod/set-beta', { cbId: adminId, feature: 'ww2', enabled: true })).s === 200
    && JSON.stringify(await features(ADMIN)) === '["ww2"]');

// The grant is keyed by cbId, so a freed handle carries nothing to whoever claims it next.
check('the tester can rename', (await call(USER, '/v1/account/profile', { handle: 'renamed' })).s === 200);
const SQUAT = await mk();
check('someone else claims the freed handle',
    (await call(SQUAT, '/v1/account/bootstrap', { hwidHash: await sha256Hex('sq'), handle: 'tester' })).s === 200);
check('a rename keeps access with the account', JSON.stringify(await features(USER)) === '["ww2"]');
check('and the old handle does not inherit it', JSON.stringify(await features(SQUAT)) === '[]');

// A stale or hand-edited entry never reaches the launcher as an unknown feature.
await env.CB.put(`beta:${modId}`, JSON.stringify(['ww2', 'nope']));
check('unknown stored features are filtered out', JSON.stringify(await features(MOD)) === '["ww2"]');

check('an admin can revoke access',
    (await call(ADMIN, '/v1/mod/set-beta', { cbId: userId, feature: 'ww2', enabled: false })).s === 200
    && JSON.stringify(await features(USER)) === '[]');
check('revoking the last feature removes the record', (await env.CB.get(`beta:${userId}`)) === null);

const log = (await call(MOD, '/v1/mod/log')).b.entries.filter(e => e.action === 'set-beta');
check('grants and revokes are logged', log.some(e => e.detail === 'ww2 on') && log.some(e => e.detail === 'ww2 off'));

check.done();
