import { NetworkError, NoKeyError, ProviderError } from './errors.js';
import { normalizeChoice, imageFrom } from './openaiFormat.js';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

async function post(settings, body) {
  if (!settings.apiKey) throw new NoKeyError('Add your OpenRouter key to continue.');
  let r;
  try {
    r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://jarvis.app', 'X-Title': 'Jarvis' },
      body: JSON.stringify(body),
    });
  } catch { throw new NetworkError(); }
  let d = {}; try { d = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    if (r.status === 401) throw new NoKeyError('Add your OpenRouter key to continue.');
    throw new ProviderError(d?.error?.message || `OpenRouter returned an error (${r.status}).`, { status: r.status });
  }
  return d.choices?.[0] || {};
}

/**
 * Provider contract (every provider exports the same shape):
 *   chat(settings, { messages, tools?, model?, maxTokens? }) -> { text, toolCalls: [{id, name, arguments}], finishReason }
 *   generateImage(settings, prompt) -> data/URL string
 */
export default {
  id: 'openrouter',
  name: 'OpenRouter (direct, key stored on this phone)',
  async chat(settings, { messages, tools, model, maxTokens = 1000 }) {
    const body = { model: model || settings.model, messages, max_tokens: maxTokens };
    if (tools?.length) body.tools = tools;
    return normalizeChoice(await post(settings, body));
  },
  async generateImage(settings, prompt) {
    const url = imageFrom(await post(settings, { model: settings.imageModel, modalities: ['image', 'text'], messages: [{ role: 'user', content: prompt }] }));
    if (!url) throw new ProviderError('That model did not return an image. Try another image model in Settings > AI Preferences.');
    return url;
  },
};
