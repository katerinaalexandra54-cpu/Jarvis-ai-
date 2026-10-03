// Talks to the JARVIS backend (server/), which holds the real AI key. The phone only holds a revocable,
// expiring access token that the server issued after an access code was entered.
import { NetworkError, NoKeyError, ProviderError } from './errors.js';
import { normalizeChoice, imageFrom } from './openaiFormat.js';
import { buildApi } from '../buildEnv.js';
import { load, save } from '../store.js';

export const backendUrl = settings => String(settings?.backendUrl || buildApi() || '').replace(/\/+$/, '');
export const getToken = () => load('authToken', '');
export const clearToken = () => save('authToken', '');
export const hasToken = () => !!getToken();

const deviceId = () => {
  let id = load('deviceId', '');
  if (!/^[a-f0-9]{24}$/.test(id)) { id = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join(''); save('deviceId', id); }
  return id;
};

async function request(base, path, { body, token } = {}) {
  let r;
  try {
    r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  } catch { throw new NetworkError(); }
  let d = {}; try { d = await r.json(); } catch { /* empty body */ }
  return { r, d };
}
const msg = (d, r) => d?.error?.message || (typeof d?.error === 'string' ? d.error : '') || `The JARVIS server returned an error (${r.status}).`;

/** Exchanges an access code for a signed device token. */
export async function registerDevice(settings, inviteCode) {
  const base = backendUrl(settings);
  if (!base) throw new ProviderError('This build is not connected to a JARVIS server.');
  const { r, d } = await request(base, '/api/auth/register', { body: { inviteCode: String(inviteCode || '').trim(), deviceId: deviceId() } });
  if (!r.ok || !d.token) throw new ProviderError(msg(d, r), { status: r.status });
  save('authToken', d.token);
  return true;
}

async function post(settings, body) {
  const base = backendUrl(settings);
  if (!base) throw new ProviderError('This build is not connected to a JARVIS server.');
  const token = settings?.backendToken || getToken();
  if (!token) throw new NoKeyError('Enter your access code to continue.');
  const { r, d } = await request(base, '/api/ai/chat', { body, token });
  if (r.status === 401 || r.status === 403) { clearToken(); throw new NoKeyError('Your access has ended. Enter your access code again.'); }
  if (!r.ok) throw new ProviderError(msg(d, r), { status: r.status });
  return d.choices?.[0] || {};
}

export default {
  id: 'backend',
  name: 'JARVIS server (the AI key stays on the server)',
  async chat(settings, { messages, tools, model, maxTokens = 1000 }) {
    const body = { model: model || settings.model, messages, max_tokens: maxTokens };
    if (tools?.length) body.tools = tools;
    return normalizeChoice(await post(settings, body));
  },
  async generateImage(settings, prompt) {
    const url = imageFrom(await post(settings, { model: settings.imageModel, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }));
    if (!url) throw new ProviderError('That model did not return an image.');
    return url;
  },
};
