// Richer profile fields and the public lookup behind the right-click card.
import { makeEnv, makeClient, mk, sha256Hex, checks } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk(), B = await mk();
const aId = (await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity', displayName: 'Divity' })).b.cbId;
const bId = (await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nova', displayName: 'Nova' })).b.cbId;

const upd = await call(A, '/v1/account/profile', { bio: 'zombies main, EE runs nightly', accent: '#6C63FF', favoriteGame: 'boiii' });
check('profile accepts bio, accent and favourite game',
    upd.s === 200 && upd.b.profile.bio === 'zombies main, EE runs nightly'
    && upd.b.profile.accent === '#6C63FF' && upd.b.profile.favoriteGame === 'boiii');

check('bad accent is rejected, not stored',
    (await call(A, '/v1/account/profile', { accent: 'red; drop table' })).b.profile.accent === '');
await call(A, '/v1/account/profile', { accent: '#6C63FF' });

check('bio is capped', (await call(A, '/v1/account/profile', { bio: 'x'.repeat(400) })).b.profile.bio.length === 200);
await call(A, '/v1/account/profile', { bio: 'zombies main' });

const view = await call(B, '/v1/profile/get', { cbId: aId });
check('anyone can look up a public profile', view.s === 200 && view.b.handle === 'divity' && view.b.bio === 'zombies main');
check('lookup carries accent + favourite game + member since',
    view.b.accent === '#6C63FF' && view.b.favoriteGame === 'boiii' && view.b.createdAt > 0);
check('lookup never leaks private fields',
    !('discordId' in view.b) && !('hwidHash' in view.b) && !('recoveryCodeHash' in view.b) && !('deviceKeys' in view.b));
check('relation to a stranger is none', view.b.relation === 'none');
check('own profile reports relation self', (await call(A, '/v1/profile/get', { cbId: aId })).b.relation === 'self');

await call(B, '/v1/friends/add', { handle: 'divity' });
check('after request, sender sees requested', (await call(B, '/v1/profile/get', { cbId: aId })).b.relation === 'requested');
check('recipient sees incoming', (await call(A, '/v1/profile/get', { cbId: bId })).b.relation === 'incoming');
await call(A, '/v1/friends/accept', { cbId: bId });
check('after accept, both see friend', (await call(B, '/v1/profile/get', { cbId: aId })).b.relation === 'friend');

check('unknown profile is 404', (await call(A, '/v1/profile/get', { cbId: 'cb_nope' })).s === 404);

await call(A, '/v1/chat/send', { room: 'all', text: 'hi' });
const chat = await call(B, '/v1/chat/poll', { room: 'all', after: 0 });
check('chat message carries author accent + cbId', chat.b.messages[0].accent === '#6C63FF' && chat.b.messages[0].cbId === aId);

check.done();
