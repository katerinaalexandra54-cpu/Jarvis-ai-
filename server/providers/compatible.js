// Generic adapter for any OpenAI-compatible chat-completions API (Azure-style gateways, Groq, Together, local
// servers, LiteLLM, ...). Configure on the server only: AI_BASE_URL (https, e.g. https://api.example.com/v1) and AI_API_KEY.
export default {
  id: 'openai-compatible',
  imagesSupported: false,
  keyOf: env => env.AI_API_KEY,
  endpoint: env => `${String(env.AI_BASE_URL || '').replace(/\/+$/, '')}/chat/completions`,
  validate: env => (/^https:\/\/[^\s/]+/i.test(env.AI_BASE_URL || '') ? '' : 'AI_BASE_URL must be an https URL.'),
  headers: key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
};
