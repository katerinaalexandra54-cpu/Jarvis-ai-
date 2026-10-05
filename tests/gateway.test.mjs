import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardChat, _resetUsage, PROVIDERS } from '../server/ai.js';
import { signToken } from '../server/auth.js';

const SECRET = 'x'.repeat(32);
const base = { JARVIS_TOKEN_SECRET: SECRET };
const hdr = () => ({ authorization: `Bearer ${signToken(SECRET, { sub: 'a'.repeat(24), iat: Date.now(), exp: Date.now() + 1e6 })}` });
const capture = (status = 200, body = { choices: [] }) => { const f = async (url, o) => { f.url = url; f.o = o; f.body = JSON.parse(o.body); return { ok: status < 400, status, json: async () => body }; }; return f; };
const msg = [{ role: 'user', content: 'hi' }];
test.beforeEach(() => _resetUsage());

test('registry has the three adapters and the default provider is openrouter', async () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['openai', 'openai-compatible', 'openrouter']);
  const f = capture();
  await forwardChat({ ...base, OPENROUTER_API_KEY: 'k' }, hdr(), { messages: msg, model: 'm' }, f);
  assert.match(f.url, /openrouter\.ai/);
});

test('AI_PROVIDER switches provider on the server only; model and token field are translated', async () => {
  const f = capture();
  const r = await forwardChat({ ...base, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-o' }, hdr(), { messages: msg, model: 'openai/gpt-4o-mini', max_tokens: 300 }, f);
  assert.equal(r.status, 200);
  assert.match(f.url, /api\.openai\.com/);
  assert.equal(f.body.model, 'gpt-4o-mini');
  assert.equal(f.body.max_completion_tokens, 300);
  assert.equal('max_tokens' in f.body, false);
  assert.equal(f.o.headers.Authorization, 'Bearer sk-o');
});

test('pinned AI_MODEL overrides the app-supplied model (provider change needs no app update)', async () => {
  const f = capture();
  await forwardChat({ ...base, OPENROUTER_API_KEY: 'k', AI_MODEL: 'vendor/new-model', ALLOWED_MODELS: 'something-else' }, hdr(), { messages: msg, model: 'old/model' }, f);
  assert.equal(f.body.model, 'vendor/new-model');
  const g = capture();
  await forwardChat({ ...base, OPENROUTER_API_KEY: 'k', AI_IMAGE_MODEL: 'img/model' }, hdr(), { messages: msg, model: 'x', modalities: ['image', 'text'] }, g);
  assert.equal(g.body.model, 'img/model');
});

test('openai-compatible needs an https AI_BASE_URL and a key; images are refused for providers without support', async () => {
  const e = { ...base, AI_PROVIDER: 'openai-compatible', AI_API_KEY: 'k' };
  assert.equal((await forwardChat({ ...e, AI_BASE_URL: 'http://insecure.example' }, hdr(), { messages: msg }, capture())).status, 500);
  const f = capture();
  assert.equal((await forwardChat({ ...e, AI_BASE_URL: 'https://llm.example.com/v1/' }, hdr(), { messages: msg, model: 'm' }, f)).status, 200);
  assert.equal(f.url, 'https://llm.example.com/v1/chat/completions');
  assert.equal((await forwardChat({ ...e, AI_BASE_URL: 'https://llm.example.com/v1' }, hdr(), { messages: msg, modalities: ['image'] }, capture())).status, 400);
});

test('unknown provider and missing key give clear server-side errors, never a key in the body', async () => {
  const a = await forwardChat({ ...base, AI_PROVIDER: 'nope' }, hdr(), { messages: msg }, capture());
  assert.equal(a.status, 500); assert.match(a.body.error.message, /openrouter/);
  assert.equal((await forwardChat({ ...base, AI_PROVIDER: 'openai' }, hdr(), { messages: msg }, capture())).status, 500);
});

test('request size limits and quota refund on upstream failure', async () => {
  const e = { ...base, OPENROUTER_API_KEY: 'k', DAILY_LIMIT: '2' };
  assert.equal((await forwardChat(e, hdr(), { messages: Array(101).fill(msg[0]) }, capture())).status, 400);
  assert.equal((await forwardChat(e, hdr(), { messages: msg, tools: 'x' }, capture())).status, 400);
  for (let i = 0; i < 5; i++) await forwardChat(e, hdr(), { messages: msg }, capture(500, { error: { message: 'down' } })); // failures are refunded
  assert.equal((await forwardChat(e, hdr(), { messages: msg }, capture())).status, 200);
  assert.equal((await forwardChat(e, hdr(), { messages: msg }, capture())).status, 200);
  assert.equal((await forwardChat(e, hdr(), { messages: msg }, capture())).status, 429);
});

test('a hung provider times out with 504 instead of hanging the app', async () => {
  const hang = (_u, o) => new Promise((_res, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realSet(fn, ms === 60000 ? 5 : ms, ...a);
  try { assert.equal((await forwardChat({ ...base, OPENROUTER_API_KEY: 'k' }, hdr(), { messages: msg }, hang)).status, 504); }
  finally { globalThis.setTimeout = realSet; }
});

test('unauthenticated callers never reach the provider', async () => {
  const f = capture();
  assert.equal((await forwardChat({ ...base, OPENROUTER_API_KEY: 'k' }, {}, { messages: msg }, f)).status, 401);
  assert.equal(f.url, undefined);
});
