// OpenAI adapter. UNVERIFIED against the live API (no network in the review environment): Manus must test it.
// - The app/OpenRouter style model "openai/gpt-4o-mini" is mapped to OpenAI's "gpt-4o-mini".
// - Current OpenAI chat models accept max_completion_tokens; older max_tokens is rejected by newer models.
// - Image generation through chat "modalities" is an OpenRouter feature and is refused here (see imagesSupported).
export default {
  id: 'openai',
  imagesSupported: false,
  keyOf: env => env.OPENAI_API_KEY,
  endpoint: () => 'https://api.openai.com/v1/chat/completions',
  headers: key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
  mapModel: model => String(model || '').replace(/^openai\//, ''),
  prepareBody(body) {
    const { max_tokens, ...rest } = body;
    return max_tokens === undefined ? rest : { ...rest, max_completion_tokens: max_tokens };
  },
};
