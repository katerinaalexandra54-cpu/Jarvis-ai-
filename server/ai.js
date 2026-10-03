// Server-side AI gateway. Authenticates the device, enforces quotas, validates the request, and forwards to the
// provider with the server-held key. No express import so it can be unit-tested. Add providers to PROVIDERS.
import { authorize } from './auth.js';

export const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    key: env => env.OPENROUTER_API_KEY,
    headers: key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://jarvis.app', 'X-Title': 'Jarvis' }),
  },
  // openai: { url: 'https://api.openai.com/v1/chat/completions', key: env => env.OPENAI_API_KEY, headers: key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }) },
};

const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'max_tokens', 'modalities'];
const usage = new Map(); // sub -> { day, count }  (in memory; resets on restart, which only loosens the cap)

function overQuota(env, sub, now) {
  const limit = Number(env.DAILY_LIMIT) || 500, day = Math.floor(now / 86400000);
  const u = usage.get(sub);
  const cur = u && u.day === day ? u : { day, count: 0 };
  if (cur.count >= limit) return true;
  usage.set(sub, { day, count: cur.count + 1 });
  return false;
}
export const _resetUsage = () => usage.clear();

/** Returns { status, body }. Never throws. */
export async function forwardChat(env, headers, input, fetchImpl = fetch, now = Date.now()) {
  const err = (status, message) => ({ status, body: { error: { message } } });
  const auth = authorize(env, headers, now);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const provider = PROVIDERS[env.AI_PROVIDER || 'openrouter'];
  if (!provider) return err(500, `Unknown AI_PROVIDER "${env.AI_PROVIDER}".`);
  const key = provider.key(env);
  if (!key) return err(500, 'The JARVIS server has no AI key configured.');
  if (!Array.isArray(input?.messages) || !input.messages.length) return err(400, 'messages is required.');

  const body = Object.fromEntries(ALLOWED_FIELDS.filter(f => input[f] !== undefined).map(f => [f, input[f]]));
  body.max_tokens = Math.min(Number(body.max_tokens) || 1000, 2000);
  const allowed = (env.ALLOWED_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(body.model)) return err(400, 'That model is not allowed on this server.');
  if (overQuota(env, auth.sub, now)) return err(429, 'Daily limit reached. Try again tomorrow.');

  let r;
  try { r = await fetchImpl(provider.url, { method: 'POST', headers: provider.headers(key), body: JSON.stringify(body) }); }
  catch (e) { return err(502, `AI provider unreachable: ${e.message}`); }
  let data = {}; try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) return err(r.status === 401 ? 502 : r.status, data?.error?.message || `AI provider error (${r.status}).`);
  return { status: 200, body: data };
}
