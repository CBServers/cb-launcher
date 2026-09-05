// Moderation authority: who can reach these endpoints, what they can do, and what they cannot.
// Authority is a cbId allowlist, so most of this suite is about the boundary rather than the queue.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const ADMIN = await mk(), MOD = await mk(), USER = await mk(), BAD = await mk();
const adminId = (await call(ADMIN, '/v1/account/bootstrap', { hwidHash: await sha256Hex('adm'), handle: 'admin' })).b.cbId;
const modId = (await call(MOD, '/v1/account/bootstrap', { hwidHash: await sha256Hex('mod'), handle: 'themod' })).b.cbId;
const userId = (await call(USER, '/v1/account/bootstrap', { hwidHash: await sha256Hex('usr'), handle: 'divity' })).b.cbId;
const badId = (await call(BAD, '/v1/account/bootstrap', { hwidHash: await sha256Hex('bad'), handle: 'spammer' })).b.cbId;

// admin is set only by writing KV directly - there is no in-app path to it.
await env.CB.put(`role:${adminId}`, 'admin');

check('a normal account has no role', (await call(USER, '/v1/mod/status')).b.role === '');
check('the admin sees its role', (await call(ADMIN, '/v1/mod/status')).b.role === 'admin');

// Endpoints answer 404 to non-moderators, so their existence is not discoverable.
check('mod endpoints are invisible to a normal account',
    (await call(USER, '/v1/mod/reports')).s === 404);
check('so is the mute endpoint', (await call(USER, '/v1/mod/mute', { cbId: badId, minutes: 60 })).s === 404);
check('and the audit log', (await call(USER, '/v1/mod/log')).s === 404);
check('a normal account cannot grant itself a role',
    (await call(USER, '/v1/mod/set-role', { cbId: userId, role: 'mod' })).s === 404);

// Only an admin moves the moderator list.
check('admin can grant mod', (await call(ADMIN, '/v1/mod/set-role', { cbId: modId, role: 'mod' })).s === 200);
check('the new mod sees its role', (await call(MOD, '/v1/mod/status')).b.role === 'mod');
check('a mod cannot grant mod', (await call(MOD, '/v1/mod/set-role', { cbId: userId, role: 'mod' })).s === 404);
check('a mod cannot promote itself to admin',
    (await call(MOD, '/v1/mod/set-role', { cbId: modId, role: 'admin' })).s === 404);
check('an admin cannot be demoted through the API',
    (await call(ADMIN, '/v1/mod/set-role', { cbId: adminId, role: 'mod' })).s === 400);

// The queue.
await call(USER, '/v1/report', { cbId: badId, reason: 'spamming the boiii room' });
const queue = await call(MOD, '/v1/mod/reports');
check('a mod sees the open report', queue.s === 200 && queue.b.reports.length === 1);
const report = queue.b.reports[0];
check('the report names both sides without a second lookup',
    report.targetProfile.handle === 'spammer' && report.reporterProfile.handle === 'divity');

check('resolving closes it', (await call(MOD, '/v1/mod/resolve', { id: report.id })).s === 200);
check('a closed report leaves the open queue', (await call(MOD, '/v1/mod/reports')).b.reports.length === 0);
check('but is still there when asked for all',
    (await call(MOD, '/v1/mod/reports', { status: 'all' })).b.reports.length === 1);

// Muting.
check('mute succeeds', (await call(MOD, '/v1/mod/mute', { cbId: badId, minutes: 60, reason: 'spam' })).s === 200);
const blocked = await call(BAD, '/v1/chat/send', { room: 'all', text: 'hello' });
check('a muted account cannot send, and is told why',
    blocked.s === 403 && blocked.b.reason === 'spam' && blocked.b.until > Date.now());
check('a mod can see the mute on lookup',
    (await call(MOD, '/v1/mod/lookup', { handle: 'spammer' })).b.mute.reason === 'spam');
const look = await call(MOD, '/v1/mod/lookup', { handle: 'spammer' });
check('lookup returns profile and device count, not identity anchors',
    look.b.person.handle === 'spammer' && typeof look.b.deviceCount === 'number'
    && !('discordId' in look.b) && !('hwidHash' in look.b) && !('recoveryCodeHash' in look.b));

check('unmute lifts it', (await call(MOD, '/v1/mod/mute', { cbId: badId, minutes: 0 })).s === 200);
check('the account can speak again', (await call(BAD, '/v1/chat/send', { room: 'all', text: 'hi' })).s === 200);

// An expired mute lapses on its own rather than needing a moderator to come back.
await env.CB.put(`muted:${badId}`, JSON.stringify({ until: Date.now() - 1000, reason: 'old', by: modId }));
check('an expired mute lapses without intervention',
    (await call(BAD, '/v1/chat/send', { room: 'all', text: 'still here' })).s === 200);

check('moderators cannot be muted',
    (await call(MOD, '/v1/mod/mute', { cbId: adminId, minutes: 60 })).s === 403);

// The audit trail.
const log = await call(MOD, '/v1/mod/log');
const actions = log.b.entries.map(e => e.action);
check('every action is logged',
    actions.includes('mute') && actions.includes('unmute') && actions.includes('resolve') && actions.includes('set-role'));
check('the log names who acted', log.b.entries.every(e => !!e.by));

check('revoking mod takes the endpoints away again',
    (await call(ADMIN, '/v1/mod/set-role', { cbId: modId, role: 'none' })).s === 200
    && (await call(MOD, '/v1/mod/reports')).s === 404);

check.done();
