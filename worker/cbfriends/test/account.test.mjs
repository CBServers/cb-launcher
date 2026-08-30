// Account lifecycle: bootstrap, whoami, the three recovery anchors, handle uniqueness, request auth.
import { makeEnv, makeClient, mk, sha256Hex, sign, checks, worker, nowSec } from './harness.mjs';

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

const idB = await mk();
const r4 = await call(idB, '/v1/account/bootstrap', { hwidHash: H1 });
check('bootstrap on known HWID refuses duplicate', r4.s === 409 && r4.b.recoverable === true && r4.b.via.includes('hwid'));

const r5 = await call(idB, '/v1/recover/hwid', { hwidHash: H1 });
check('recover/hwid attaches new key to same account', r5.s === 200 && r5.b.cbId === cbId0);
check('recovered key now authenticates', (await call(idB, '/v1/account')).b.cbId === cbId0);

const idC = await mk();
check('recover/code attaches new key to same account',
    (await call(idC, '/v1/recover/code', { recoveryCode })).b.cbId === cbId0);

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

check.done();
