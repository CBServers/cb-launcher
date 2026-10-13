// Account lifecycle: bootstrap, whoami, the three recovery anchors, handle uniqueness, request auth.
import { makeEnv, makeClient, mk, sha256Hex, sign, checks, worker, nowSec, stubDiscord, restoreFetch, fprOf, ageKey } from './harness.mjs';

const { env } = makeEnv();
const call = makeClient(env);
const check = checks();

const H1 = await sha256Hex('machine-1');
const H2 = await sha256Hex('machine-2');
const H3 = await sha256Hex('machine-3');
const H4 = await sha256Hex('machine-4');

const idA = await mk();
const r1 = await call(idA, '/v1/account/bootstrap', { hwidHash: H1, handle: 'divity', displayName: 'Divity' });
check('bootstrap creates account', r1.s === 200 && r1.b.created === true && !!r1.b.cbId);
check('recovery code returned on create', typeof r1.b.recoveryCode === 'string' && r1.b.recoveryCode.length > 0);
check('handle stored on profile', r1.b.profile && r1.b.profile.handle === 'divity');
const cbId0 = r1.b.cbId;
const recoveryCode = r1.b.recoveryCode;

const r2 = await call(idA, '/v1/account/bootstrap', { hwidHash: H1 });
check('bootstrap idempotent for same device key', r2.s === 200 && r2.b.created === false && r2.b.cbId === cbId0);

check('whoami resolves signing key', (await call(idA, '/v1/account')).b.cbId === cbId0);

// A cloned PC shares the HWID: launchers that do not ask their user get their own account.
const idClone = await mk();
const r3 = await call(idClone, '/v1/account/bootstrap', { hwidHash: H1, handle: 'clone' });
check('bootstrap on known HWID without hwidPrompt mints a separate account',
    r3.s === 200 && r3.b.created === true && r3.b.cbId !== cbId0 && r3.b.profile.handle === 'clone');
check('the separate account authenticates as itself', (await call(idClone, '/v1/account')).b.cbId === r3.b.cbId);

// The owner's key is still in use, so even a prompting launcher is on a clone: no offer, no preview.
const idLive = await mk();
const live = await call(idLive, '/v1/account/bootstrap', { hwidHash: H1, hwidPrompt: true, handle: 'clone2' });
check('hwidPrompt against an owner in use mints a separate account',
    live.s === 200 && live.b.created === true && live.b.cbId !== cbId0 && !('account' in live.b));

await ageKey(env, idA, 30);
const idB = await mk();
const r4 = await call(idB, '/v1/account/bootstrap', { hwidHash: H1, hwidPrompt: true });
check('bootstrap on known HWID with hwidPrompt refuses duplicate when the owner is dormant',
    r4.s === 409 && r4.b.recoverable === true && r4.b.via.length === 1 && r4.b.via[0] === 'hwid');
check('hwidPrompt match names the account it would adopt',
    r4.b.account && r4.b.account.handle === 'divity' && r4.b.account.displayName === 'Divity' && !('cbId' in r4.b.account));

// The anchor stays with the account that claimed it first, not the clone.
const r5 = await call(idB, '/v1/recover/hwid', { hwidHash: H1 });
check('recover/hwid attaches new key to same account', r5.s === 200 && r5.b.cbId === cbId0);
check('recovered key now authenticates', (await call(idB, '/v1/account')).b.cbId === cbId0);

const idC = await mk();
check('recover/code attaches new key to same account',
    (await call(idC, '/v1/recover/code', { recoveryCode })).b.cbId === cbId0);

// A key recovered into another account leaves the one it was on.
const deviceKeysOf = async cbId => JSON.parse(await env.CB.get(`acct:${cbId}`)).deviceKeys;
check('recovery moved idClone off its own account',
    (await call(idClone, '/v1/recover/code', { recoveryCode })).b.cbId === cbId0 &&
    !(await deviceKeysOf(r3.b.cbId)).includes(await fprOf(idClone)) &&
    (await deviceKeysOf(cbId0)).includes(await fprOf(idClone)));

const idD = await mk();
const r8 = await call(idD, '/v1/account/bootstrap', { hwidHash: H2, handle: 'Divity' });
check('handle claim is case-insensitively unique', r8.s === 409 && /handle taken/.test(r8.b.error || ''));

const idE = await mk();
check('free handle claims successfully',
    (await call(idE, '/v1/account/bootstrap', { hwidHash: H3, handle: 'newname' })).b.profile.handle === 'newname');

const idF = await mk();
check('DER-encoded signature accepted (launcher format)',
    (await call(idF, '/v1/account/bootstrap', { hwidHash: H4 }, { der: true })).b.created === true);

const idG = await mk();
check('stale ts rejected',
    (await call(idG, '/v1/account/bootstrap', { hwidHash: await sha256Hex('m5') }, { ts: nowSec() - 1000 })).s === 401);

// Signature covers a different body than the one sent, so the request must not verify.
const idH = await mk();
const goodText = JSON.stringify({ ts: nowSec(), hwidHash: await sha256Hex('m6') });
const tampered = await worker.fetch(new Request('https://x/v1/account/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CB-Key': idH.key, 'X-CB-Sig': await sign(idH, goodText) },
    body: goodText.replace('"ts"', '"ts" '),
}), env);
check('tampered body rejected', tampered.status === 401);

// A raw signature whose r starts with 0x30 looks like a DER tag; it must still verify as raw.
const idI = await mk();
let looksLikeDer = null;
for (let i = 0; i < 4000 && !looksLikeDer; i++) {
    const body = JSON.stringify({ ts: nowSec(), hwidHash: await sha256Hex('collide-' + i) });
    const sig = await sign(idI, body);
    if (Buffer.from(sig, 'base64')[0] === 0x30) looksLikeDer = { body, sig };
}
const collide = looksLikeDer && await worker.fetch(new Request('https://x/v1/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CB-Key': idI.key, 'X-CB-Sig': looksLikeDer.sig },
    body: looksLikeDer.body,
}), env);
check('raw signature starting with 0x30 is not mistaken for DER', !!collide && collide.status !== 401);

// A Discord match still blocks every client, and leads `via` since older launchers recover through via[0].
const DISCORD = { 'good-token': '196185157840011264', 'second-token': '296185157840011264', 'third-token': '396185157840011264' };
stubDiscord(token => DISCORD[token] ? { id: DISCORD[token], avatar: null, username: 'linked' } : null);
const H7 = await sha256Hex('machine-7');
const idLinked = await mk();
const linkedId = (await call(idLinked, '/v1/account/bootstrap', { hwidHash: H7, discordToken: 'good-token', handle: 'linked' })).b.cbId;
const legacy = await call(await mk(), '/v1/account/bootstrap', { hwidHash: H7, discordToken: 'good-token' });
check('Discord match refuses a duplicate without hwidPrompt',
    legacy.s === 409 && legacy.b.via.length === 1 && legacy.b.via[0] === 'discord');
await ageKey(env, idLinked, 30);
const prompted = await call(await mk(), '/v1/account/bootstrap', { hwidHash: H7, discordToken: 'good-token', hwidPrompt: true });
check('Discord leads via when both anchors match', prompted.s === 409 && prompted.b.via.join() === 'discord,hwid');
check('no account preview when Discord identifies the user', !('account' in prompted.b));
check('recover/discord reaches the linked account',
    (await call(await mk(), '/v1/recover/discord', { discordToken: 'good-token' })).b.cbId === linkedId);

// One Discord per account: the one it switched away from loses its way back in.
check('switching Discord succeeds', (await call(idLinked, '/v1/account/sync-discord', { discordToken: 'second-token' })).s === 200);
check('the Discord it switched away from no longer recovers it',
    (await call(await mk(), '/v1/recover/discord', { discordToken: 'good-token' })).s === 404);
check('the new Discord does',
    (await call(await mk(), '/v1/recover/discord', { discordToken: 'second-token' })).b.cbId === linkedId);
check('bootstrap with the old Discord mints a fresh account',
    (await call(await mk(), '/v1/account/bootstrap', { hwidHash: await sha256Hex('machine-9'), discordToken: 'good-token' })).b.created === true);

// Rows left behind by switches before this fix are inert.
await env.CB.put(`discord:${DISCORD['third-token']}`, linkedId);
check('a row left behind by an old switch does not recover',
    (await call(await mk(), '/v1/recover/discord', { discordToken: 'third-token' })).s === 404);
const idOther = await mk();
await call(idOther, '/v1/account/bootstrap', { hwidHash: await sha256Hex('machine-8'), handle: 'other' });
check('nor does it stop that Discord linking elsewhere',
    (await call(idOther, '/v1/account/sync-discord', { discordToken: 'third-token' })).s === 200);
const taken = await call(idOther, '/v1/account/sync-discord', { discordToken: 'second-token' });
check('a Discord on another profile is refused and names that profile',
    taken.s === 409 && taken.b.code === 'linked-elsewhere' && taken.b.account &&
    taken.b.account.handle === 'linked' && !('cbId' in taken.b.account));
restoreFetch();

check.done();
