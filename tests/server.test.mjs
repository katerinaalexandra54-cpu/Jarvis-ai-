import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardChat, _resetUsage } from '../server/ai.js';
import { registerDevice, signToken, verifyToken, authorize } from '../server/auth.js';

const SECRET = 'x'.repeat(32);
const env = { OPENROUTER_API_KEY: 'sk-server', JARVIS_TOKEN_SECRET: SECRET, JARVIS_INVITE_CODES: 'alpha,beta' };
const ok = body => async () => ({ ok: true, status: 200, json: async () => body });
const tokenFor = (sub = 'a'.repeat(24), e = env, now = Date.now()) => signToken(e.JARVIS_TOKEN_SECRET, { sub, iat: now, exp: now + 1e6 });
const auth = (t = tokenFor()) => ({ authorization: `Bearer ${t}` });
test.beforeEach(() => _resetUsage());

test('register: valid code -> signed token that verifies; wrong/missing code and closed registration are refused', () => {
  const r = registerDevice(env, { inviteCode: 'beta', deviceId: 'ab'.repeat(12) });
  assert.equal(r.status, 200);
  const p = verifyToken(SECRET, r.body.token);
  assert.equal(p.sub, 'ab'.repeat(12));
  assert.equal(registerDevice(env, { inviteCode: 'nope' }).status, 403);
  assert.equal(registerDevice(env, {}).status, 403);
  assert.equal(registerDevice({ ...env, JARVIS_INVITE_CODES: '' }, { inviteCode: '' }).status, 403);
  assert.equal(registerDevice({ ...env, JARVIS_TOKEN_SECRET: 'short' }, { inviteCode: 'alpha' }).status, 500);
  assert.equal(registerDevice({ ...env, JARVIS_REVOKED: 'ab'.repeat(12) }, { inviteCode: 'alpha', deviceId: 'ab'.repeat(12) }).status, 403);
});

test('tokens: tampering, wrong secret and expiry are rejected', () => {
  const t = tokenFor();
  assert.ok(verifyToken(SECRET, t));
  assert.equal(verifyToken('y'.repeat(32), t), null);
  const [body, sig] = t.split('.');
  assert.equal(verifyToken(SECRET, `${Buffer.from('{"sub":"evil","exp":9999999999999}').toString('base64url')}.${sig}`), null);
  assert.equal(verifyToken(SECRET, `${body}.AAAA`), null);
  assert.equal(verifyToken(SECRET, signToken(SECRET, { sub: 'a', exp: 1 })), null);
  assert.equal(verifyToken(SECRET, 'garbage'), null);
});

test('authorize: secure by default; revoked devices blocked; anonymous only when explicitly enabled', () => {
  assert.equal(authorize({}, {}).ok, false);
  assert.equal(authorize({}, {}).status, 500);
  assert.equal(authorize(env, {}).status, 401);
  assert.equal(authorize(env, auth()).ok, true);
  assert.equal(authorize({ ...env, JARVIS_REVOKED: 'a'.repeat(24) }, auth()).status, 403);
  assert.equal(authorize({ JARVIS_ALLOW_ANONYMOUS: 'true' }, {}).ok, true);
});

test('gateway: no token -> 401 and the provider is never called', async () => {
  let called = false;
  const r = await forwardChat(env, {}, { messages: [1] }, async () => { called = true; return ok({})(); });
  assert.equal(r.status, 401); assert.equal(called, false);
});

test('gateway: forwards with the server key, whitelists fields, caps max_tokens', async () => {
  let sent;
  const f = async (u, o) => { sent = { o, body: JSON.parse(o.body) }; return ok({ choices: [] })(); };
  const r = await forwardChat(env, auth(), { messages: [{ role: 'user', content: 'x' }], model: 'm', max_tokens: 99999, evil: 'drop me', tools: [] }, f);
  assert.equal(r.status, 200);
  assert.equal(sent.o.headers.Authorization, 'Bearer sk-server');
  assert.equal(sent.body.max_tokens, 2000);
  assert.ok(!('evil' in sent.body));
});

test('gateway: no AI key, bad body, model allowlist', async () => {
  assert.equal((await forwardChat({ ...env, OPENROUTER_API_KEY: '' }, auth(), { messages: [1] }, ok({}))).status, 500);
  assert.equal((await forwardChat(env, auth(), { messages: [] }, ok({}))).status, 400);
  assert.equal((await forwardChat({ ...env, ALLOWED_MODELS: 'a,b' }, auth(), { messages: [1], model: 'c' }, ok({}))).status, 400);
  assert.equal((await forwardChat({ ...env, ALLOWED_MODELS: 'a,b' }, auth(), { messages: [1], model: 'a' }, ok({}))).status, 200);
});

test('gateway: per-device daily quota, resets next day, devices are independent', async () => {
  const e = { ...env, DAILY_LIMIT: '2' }, day = 86400000, t0 = 10 * day;
  const call = (sub, now) => forwardChat(e, auth(tokenFor(sub, e, now)), { messages: [1] }, ok({}), now);
  assert.equal((await call('a'.repeat(24), t0)).status, 200);
  assert.equal((await call('a'.repeat(24), t0)).status, 200);
  assert.equal((await call('a'.repeat(24), t0)).status, 429);
  assert.equal((await call('b'.repeat(24), t0)).status, 200);
  assert.equal((await call('a'.repeat(24), t0 + day)).status, 200);
});

test('gateway: upstream 401 is reported as 502 (never blames the user), network error -> 502', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid key' } }) });
  assert.equal((await forwardChat(env, auth(), { messages: [1] }, bad)).status, 502);
  assert.equal((await forwardChat(env, auth(), { messages: [1] }, async () => { throw new Error('down'); })).status, 502);
});
