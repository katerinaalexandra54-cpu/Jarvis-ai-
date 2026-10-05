// Server-side AI gateway. Authenticates the device, enforces quotas, validates the request, and forwards to the
// provider selected on the server (see ./providers). Only the server holds provider keys.
// No express import so it can be unit-tested.
import { authorize } from './auth.js';
import { PROVIDERS, providerFor } from './providers/index.js';

export { PROVIDERS };

const ALLOWED_FIELDS = ['model', 'messages', 'tools', 'tool_choice', 'max_tokens', 'modalities'];
const MAX_MESSAGES = 100, MAX_TOOLS = 64, UPSTREAM_TIMEOUT_MS = 60000;
const usage = new Map(); // sub -> { day, count }  (in memory; resets on restart, which only loosens the cap)

function overQuota(env, sub, now) {
  const limit = Number(env.DAILY_LIMIT) || 500, day = Math.floor(now / 86400000);
  if (usage.size > 5000) for (const [k, v] of usage) if (v.day < day) usage.delete(k); // bound memory
  const u = usage.get(sub);
  const cur = u && u.day === day ? u : { day, count: 0 };
  if (cur.count >= limit) return true;
  usage.set(sub, { day, count: cur.count + 1 });
  return false;
}
function refund(sub, now) { // a request that failed upstream should not eat the device's daily quota
  const u = usage.get(sub);
  if (u && u.day === Math.floor(now / 86400000) && u.count > 0) usage.set(sub, { ...u, count: u.count - 1 });
}
export const _resetUsage = () => usage.clear();

/** Returns { status, body }. Never throws. */
export async function forwardChat(env, headers, input, fetchImpl = fetch, now = Date.now()) {
  const err = (status, message) => ({ status, body: { error: { message } } });
  const auth = authorize(env, headers, now);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const provider = providerFor(env);
  if (!provider) return err(500, `Unknown AI_PROVIDER "${env.AI_PROVIDER}". Available: ${Object.keys(PROVIDERS).join(', ')}.`);
  const key = provider.keyOf(env);
  if (!key) return err(500, 'The JARVIS server has no AI key configured.');
  const invalid = provider.validate?.(env);
  if (invalid) return err(500, invalid);
  if (!Array.isArray(input?.messages) || !input.messages.length) return err(400, 'messages is required.');
  if (input.messages.length > MAX_MESSAGES) return err(400, 'Too many messages in one request.');
  if (input.tools !== undefined && (!Array.isArray(input.tools) || input.tools.length > MAX_TOOLS)) return err(400, 'Invalid tools.');

  let body = Object.fromEntries(ALLOWED_FIELDS.filter(f => input[f] !== undefined).map(f => [f, input[f]]));
  body.max_tokens = Math.min(Number(body.max_tokens) || 1000, 2000);
  const wantsImage = Array.isArray(body.modalities) && body.modalities.includes('image');
  if (wantsImage && !provider.imagesSupported) return err(400, `Image generation is not supported by the "${provider.id}" provider.`);

  // The server may pin the models (AI_MODEL / AI_IMAGE_MODEL). A pinned model overrides whatever the app sent, which
  // is how the provider can change without an app update. Otherwise the app's model must pass ALLOWED_MODELS.
  const pinned = wantsImage ? env.AI_IMAGE_MODEL : env.AI_MODEL;
  const allowed = (env.ALLOWED_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (pinned) body.model = pinned;
  else if (allowed.length && !allowed.includes(body.model)) return err(400, 'That model is not allowed on this server.');
  if (provider.mapModel && body.model) body.model = provider.mapModel(body.model, env);
  if (provider.prepareBody) body = provider.prepareBody(body, env);
  if (overQuota(env, auth.sub, now)) return err(429, 'Daily limit reached. Try again tomorrow.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  let r;
  try { r = await fetchImpl(provider.endpoint(env), { method: 'POST', headers: provider.headers(key), body: JSON.stringify(body), signal: ctl.signal }); }
  catch (e) { refund(auth.sub, now); return e?.name === 'AbortError' ? err(504, 'The AI provider took too long to answer.') : err(502, `AI provider unreachable: ${e.message}`); }
  finally { clearTimeout(timer); }
  let data = {}; try { data = await r.json(); } catch { /* empty body */ }
  if (!r.ok) { refund(auth.sub, now); return err(r.status === 401 ? 502 : r.status, data?.error?.message || `AI provider error (${r.status}).`); }
  return { status: 200, body: data };
}
