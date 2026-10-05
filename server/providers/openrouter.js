// OpenRouter adapter. Speaks the OpenAI chat-completions format natively, so it passes the body through.
export default {
  id: 'openrouter',
  imagesSupported: true,
  keyOf: env => env.OPENROUTER_API_KEY,
  endpoint: () => 'https://openrouter.ai/api/v1/chat/completions',
  headers: key => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://jarvis.app', 'X-Title': 'Jarvis' }),
};
