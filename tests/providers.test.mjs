import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, generateImage, NoKeyError } from '../src/lib/ai.js';
import { accessMode, getProvider, hasToken, NetworkError, ProviderError, registerDevice } from '../src/lib/providers/index.js';

const S = { provider: 'openrouter', apiKey: 'sk-test', model: 'openai/gpt-4o-mini', imageModel: 'img' };
const resp = (b, status = 200) => async (u, o) => { resp.last = { u, o }; return { ok: status < 400, status, json: async () => b }; };
const real = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = real; });

test('complete(): text reply, key only in Authorization header', async () => {
  globalThis.fetch = resp({ choices: [{ message: { content: ' Hello ' } }] });
  assert.equal(await complete(S, [{ role: 'user', content: 'hi' }]), 'Hello');
  assert.equal(resp.last.o.headers.Authorization, 'Bearer sk-test');
  assert.ok(!resp.last.o.body.includes('sk-test'));
});
test('tool calls are normalized and tools are forwarded', async () => {
  globalThis.fetch = resp({ choices: [{ message: { content: null, tool_calls: [{ id: '1', function: { name: 'torch_set', arguments: '{"enabled":true}' } }] }, finish_reason: 'tool_calls' }] });
  const r = await getProvider(S).chat(S, { messages: [], tools: [{ type: 'function' }] });
  assert.deepEqual(r.toolCalls, [{ id: '1', name: 'torch_set', arguments: { enabled: true } }]);
  assert.ok(JSON.parse(resp.last.o.body).tools);
});
test('malformed tool arguments become {} (validator then rejects)', async () => {
  globalThis.fetch = resp({ choices: [{ message: { tool_calls: [{ id: '1', function: { name: 'x', arguments: '{oops' } }] } }] });
  assert.deepEqual((await getProvider(S).chat(S, { messages: [] })).toolCalls[0].arguments, {});
});
test('missing key and 401 -> NoKeyError', async () => {
  await assert.rejects(complete({ ...S, apiKey: '' }, []), NoKeyError);
  globalThis.fetch = resp({ error: { message: 'bad' } }, 401);
  await assert.rejects(complete(S, []), NoKeyError);
});
test('429 -> ProviderError with the provider message', async () => {
  globalThis.fetch = resp({ error: { message: 'rate limited' } }, 429);
  await assert.rejects(complete(S, []), e => e instanceof ProviderError && /rate limited/.test(e.message));
});
test('offline -> NetworkError', async () => {
  globalThis.fetch = async () => { throw new TypeError('fail'); };
  await assert.rejects(complete(S, []), NetworkError);
});
test('image generation', async () => {
  globalThis.fetch = resp({ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AA' } }] } }] });
  assert.equal(await generateImage(S, 'cat'), 'data:image/png;base64,AA');
});
const store = {}; globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
test('backend mode: sends a bearer token (never an AI key); 401 clears it and asks for the access code', async () => {
  const s = { ...S, backendUrl: 'https://jarvis.example.com/' };
  assert.equal(getProvider(s).id, 'backend');
  await assert.rejects(complete(s, [{ role: 'user', content: 'x' }]), NoKeyError); // no token yet
  globalThis.fetch = resp({ token: 'tok123', expiresAt: 1 });
  await registerDevice(s, ' code1 ');
  assert.equal(resp.last.u, 'https://jarvis.example.com/api/auth/register');
  assert.equal(JSON.parse(resp.last.o.body).inviteCode, 'code1');
  assert.ok(hasToken());
  globalThis.fetch = resp({ choices: [{ message: { content: 'hi' } }] });
  assert.equal(await complete(s, [{ role: 'user', content: 'x' }]), 'hi');
  assert.equal(resp.last.u, 'https://jarvis.example.com/api/ai/chat');
  assert.equal(resp.last.o.headers.Authorization, 'Bearer tok123');
  assert.ok(!resp.last.o.body.includes('sk-test'));
  globalThis.fetch = resp({ error: { message: 'Not authorized.' } }, 401);
  await assert.rejects(complete(s, []), NoKeyError);
  assert.ok(!hasToken(), 'expired token is cleared');
});
test('registerDevice surfaces the server message for a wrong code', async () => {
  globalThis.fetch = resp({ error: { message: 'That access code is not valid.' } }, 403);
  await assert.rejects(registerDevice({ backendUrl: 'https://x.test' }, 'bad'), /not valid/);
});
test('accessMode: backend when a URL is set, direct in dev/tests', () => {
  assert.equal(accessMode({ backendUrl: 'https://x.test' }), 'backend');
  assert.equal(accessMode({}), 'direct');
});
test('no backend URL -> direct OpenRouter; unknown provider falls back', () => {
  assert.equal(getProvider(S).id, 'openrouter');
  assert.equal(getProvider({ provider: 'zzz' }).id, 'openrouter');
});
