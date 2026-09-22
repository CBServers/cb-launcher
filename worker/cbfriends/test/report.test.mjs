// Reports carry a category and, for chat, a message the worker reads from the room itself; moderators
// can take messages out of a room, purge an account's lines, and mute for good.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const MOD = await mk(), USER = await mk(), BAD = await mk(), OTHER = await mk(), NOISY = await mk();
const boot = async (who, seed, handle) =>
    (await call(who, '/v1/account/bootstrap', { hwidHash: await sha256Hex(seed), handle })).b.cbId;
const modId = await boot(MOD, 'mod', 'themod');
const userId = await boot(USER, 'usr', 'divity');
const badId = await boot(BAD, 'bad', 'spammer');
const otherId = await boot(OTHER, 'oth', 'nova');
await boot(NOISY, 'noisy', 'noisy');
await env.CB.put(`role:${modId}`, 'mod');

// A little history in the boiii room, so the report has lines before it.
for (const [who, text] of [[OTHER, 'anyone for EE?'], [USER, 'me'], [BAD, 'buy cheats at example.com'], [OTHER, 'no thanks']]) {
    await call(who, '/v1/chat/send', { room: 'boiii', text });
}
const history = (await call(USER, '/v1/chat/poll', { room: 'boiii', after: 0 })).b.messages;
const spam = history.find(m => m.cbId === badId);
const innocent = history.find(m => m.cbId === otherId);

// ---- filing ----

const filed = await call(USER, '/v1/report', { cbId: badId, category: 'spam', note: 'selling cheats', room: 'boiii', messageId: spam.id });
check('a message report is accepted', filed.s === 200 && !!filed.b.id);

const queue = (await call(MOD, '/v1/mod/reports')).b.reports;
const rep = queue.find(r => r.id === filed.b.id);
check('the category and note are kept', rep.category === 'spam' && rep.reason === 'selling cheats');
check('the message text comes from the room, not the client',
    rep.room === 'boiii' && rep.message.id === spam.id && rep.message.text === 'buy cheats at example.com');
check('the lines before it come along for context',
    rep.lines.map(l => l.text).join('|') === 'anyone for EE?|me');

const forged = await call(USER, '/v1/report', { cbId: badId, category: 'spam', room: 'boiii', messageId: innocent.id });
check('a message by someone else cannot be pinned on the target', forged.s === 404);

const again = await call(USER, '/v1/report', { cbId: badId, category: 'harassment', room: 'boiii', messageId: spam.id });
check('reporting the same message twice does not queue it twice',
    again.s === 200 && again.b.id === filed.b.id && (await call(MOD, '/v1/mod/reports')).b.reports.length === 1);

check('a DM room cannot be named in a report',
    (await call(USER, '/v1/report', { cbId: badId, category: 'spam', room: 'dm-0123456789abcdef0123456789ab', messageId: 1 })).s === 400);
check('a bad message id is refused',
    (await call(USER, '/v1/report', { cbId: badId, category: 'spam', room: 'boiii', messageId: 'x' })).s === 400);

await call(USER, '/v1/report', { cbId: otherId, category: 'nonsense' });
check('an unknown category files as other',
    (await call(MOD, '/v1/mod/reports')).b.reports.some(r => r.target === otherId && r.category === 'other'));

await call(BAD, '/v1/account/profile', { bio: 'visit example.com' });
await call(USER, '/v1/report', { cbId: badId, category: 'profile', note: 'ad in bio' });
await call(BAD, '/v1/account/profile', { bio: 'nothing to see' });
const profileRep = (await call(MOD, '/v1/mod/reports')).b.reports.find(r => r.category === 'profile');
check('a profile report keeps the profile as it was reported', profileRep && profileRep.profile.bio === 'visit example.com');

let limited = false;
for (let i = 0; i < 15 && !limited; i++) {
    limited = (await call(NOISY, '/v1/report', { cbId: otherId, category: 'other' })).s === 429;
}
check('one account cannot flood the queue', limited);

// ---- removing messages ----

check('removing a message is moderator-only',
    (await call(USER, '/v1/mod/remove-message', { room: 'boiii', id: spam.id })).s === 404);
check('a moderator cannot reach a DM room either',
    (await call(MOD, '/v1/mod/remove-message', { room: 'dm-0123456789abcdef0123456789ab', id: 1 })).s === 400);

const removed = await call(MOD, '/v1/mod/remove-message', { room: 'boiii', id: spam.id, reportId: filed.b.id });
check('a moderator removes the message', removed.s === 200);
const after = await call(OTHER, '/v1/chat/poll', { room: 'boiii', after: 0 });
check('it is gone from the room', !after.b.messages.some(m => m.id === spam.id));
check('and polls name it so clients drop their copy', after.b.removed.includes(spam.id));
const scroll = await call(OTHER, '/v1/chat/poll', { room: 'boiii', before: history[history.length - 1].id + 1 });
check('scrollback does not bring it back', !scroll.b.messages.some(m => m.id === spam.id));
check('the report is marked', (await call(MOD, '/v1/mod/reports')).b.reports.find(r => r.id === filed.b.id).messageRemoved === true);
check('removing it again is a 404', (await call(MOD, '/v1/mod/remove-message', { room: 'boiii', id: spam.id })).s === 404);

// A held poll sees the removal at once rather than at the end of its hold.
await call(BAD, '/v1/chat/send', { room: 'boiii', text: 'still selling' });
const tail = (await call(OTHER, '/v1/chat/poll', { room: 'boiii', after: 0 })).b;
const newest = tail.messages[tail.messages.length - 1];
const held = call(OTHER, '/v1/chat/poll', { room: 'boiii', after: newest.id, hold: true });
const started = Date.now();
await call(MOD, '/v1/mod/remove-message', { room: 'boiii', id: newest.id });
const woke = await held;
check('a held poll wakes on removal', Date.now() - started < 5000 && woke.b.removed.includes(newest.id));

let log = (await call(MOD, '/v1/mod/log')).b.entries;
check('the audit log keeps the removed text',
    log.some(e => e.action === 'remove-message' && e.detail.includes('buy cheats')));

// ---- purge ----

await call(BAD, '/v1/chat/send', { room: 'boiii', text: 'one' });
await call(BAD, '/v1/chat/send', { room: 'boiii', text: 'two' });
check('purge is moderator-only', (await call(USER, '/v1/mod/purge', { room: 'boiii', cbId: badId })).s === 404);
const purge = await call(MOD, '/v1/mod/purge', { room: 'boiii', cbId: badId });
check('purge reports how many it took', purge.s === 200 && purge.b.removed === 2);
const left = (await call(OTHER, '/v1/chat/poll', { room: 'boiii', after: 0 })).b.messages;
check('only that account\'s lines are gone', !left.some(m => m.cbId === badId) && left.some(m => m.cbId === otherId));
check('a moderator cannot be purged', (await call(MOD, '/v1/mod/purge', { room: 'boiii', cbId: modId })).s === 403);
log = (await call(MOD, '/v1/mod/log')).b.entries;
check('the purge is logged', log.some(e => e.action === 'purge' && e.detail === 'boiii: 2 message(s)'));

// ---- mute ----

await call(BAD, '/v1/lfg/post', { game: 'boiii', note: 'join my discord' });
check('the board shows the post before the mute',
    (await call(USER, '/v1/lfg/list', { game: 'boiii' })).b.posts.some(p => p.cbId === badId));

check('permanent mute succeeds', (await call(MOD, '/v1/mod/mute', { cbId: badId, permanent: true, reason: 'spam' })).s === 200);
check('the mute takes the board post down',
    !(await call(USER, '/v1/lfg/list', { game: 'boiii' })).b.posts.some(p => p.cbId === badId));
const post = await call(BAD, '/v1/lfg/post', { game: 'boiii', note: 'again' });
check('a muted account cannot post to the board', post.s === 403 && post.b.muted === true);
const chat = await call(BAD, '/v1/chat/send', { room: 'boiii', text: 'hello?' });
check('a permanent mute blocks chat and says it has no end', chat.s === 403 && chat.b.muted === true && chat.b.until === 0);

// Long after any timed mute would have lapsed, it still holds.
const rec = JSON.parse(await env.CB.get(`muted:${badId}`));
check('a permanent mute has no expiry', rec.until === 0);
const status = await call(BAD, '/v1/mod/status');
check('the muted account learns about it from its status', status.b.role === '' && status.b.mute.until === 0 && status.b.mute.reason === 'spam');
check('an unmuted account sees no mute', (await call(USER, '/v1/mod/status')).b.mute === null);

log = (await call(MOD, '/v1/mod/log')).b.entries;
check('the permanent mute is logged as such', log.some(e => e.action === 'mute' && e.detail.startsWith('permanent')));

check('unmute still lifts it', (await call(MOD, '/v1/mod/mute', { cbId: badId, minutes: 0 })).s === 200);
check('and the account can post again', (await call(BAD, '/v1/lfg/post', { game: 'boiii', note: 'sorry' })).s === 200);

check.done();
