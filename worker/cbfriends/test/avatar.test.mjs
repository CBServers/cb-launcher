// Discord avatar seeding and refresh, with Discord stubbed so no real token is needed.
import { makeEnv, makeClient, mk, sha256Hex, checks, stubDiscord, restoreFetch } from './harness.mjs';

const DISCORD_ID = '196185157840011264';
let discordAvatar = 'abc123hash';
stubDiscord(token => token === 'good-token'
    ? { id: DISCORD_ID, avatar: discordAvatar, global_name: 'k', username: 'divity' }
    : null);

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const A = await mk();
const boot = await call(A, '/v1/account/bootstrap', { hwidHash: await sha256Hex('A'), handle: 'divity', discordToken: 'good-token' });
check('bootstrap seeds the Discord avatar',
    boot.b.profile.avatarUrl === `https://cdn.discordapp.com/avatars/${DISCORD_ID}/abc123hash.png?size=128`);
check('bootstrap seeds the Discord display name', boot.b.profile.displayName === 'k');

discordAvatar = 'newhash999';
const sync = await call(A, '/v1/account/sync-discord', { discordToken: 'good-token' });
check('sync refreshes the avatar after it changes on Discord', sync.s === 200 && sync.b.profile.avatarUrl.includes('newhash999'));

discordAvatar = 'a_animated1';
check('animated avatar uses .gif',
    (await call(A, '/v1/account/sync-discord', { discordToken: 'good-token' })).b.profile.avatarUrl.includes('.gif'));

const B = await mk();
const bBoot = await call(B, '/v1/account/bootstrap', { hwidHash: await sha256Hex('B'), handle: 'nodiscord' });
check('no-Discord profile starts with no avatar', bBoot.b.profile.avatarUrl === '');
check('cannot sync a Discord account linked elsewhere',
    (await call(B, '/v1/account/sync-discord', { discordToken: 'good-token' })).s === 409);
check('bad token is rejected', (await call(B, '/v1/account/sync-discord', { discordToken: 'nope' })).s === 401);

// An account with no avatar set on Discord falls back to Discord's own default art.
stubDiscord(() => ({ id: '111111111111111111', avatar: null, username: 'plain' }));
const C = await mk();
const cBoot = await call(C, '/v1/account/bootstrap', { hwidHash: await sha256Hex('C'), handle: 'plainuser', discordToken: 'good-token' });
check('falls back to the Discord default avatar', /embed\/avatars\/\d\.png/.test(cBoot.b.profile.avatarUrl));

stubDiscord(() => ({ id: DISCORD_ID, avatar: 'discordhash', global_name: 'k' }));
const custom = await call(A, '/v1/account/profile', { avatarUrl: 'https://i.imgur.com/me.png' });
check('custom avatar URL is stored', custom.b.profile.avatarUrl === 'https://i.imgur.com/me.png');
check('sync does not clobber a custom avatar',
    (await call(A, '/v1/account/sync-discord', { discordToken: 'good-token' })).b.profile.avatarUrl === 'https://i.imgur.com/me.png');
check('non-http avatar is rejected', (await call(A, '/v1/account/profile', { avatarUrl: 'javascript:alert(1)' })).s === 400);
check('avatar on a non-allowlisted host is rejected',
    (await call(A, '/v1/account/profile', { avatarUrl: 'https://tracker.example.com/p.png' })).s === 400);
check('clearing the avatar drops the custom flag',
    (await call(A, '/v1/account/profile', { avatarUrl: '' })).b.profile.avatarUrl === '');
check('sync restores the Discord avatar after clearing',
    (await call(A, '/v1/account/sync-discord', { discordToken: 'good-token' })).b.profile.avatarUrl.includes('discordhash'));

restoreFetch();
check.done();
