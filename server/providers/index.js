// Provider registry. The active provider is chosen by the AI_PROVIDER environment variable on the server, so
// changing provider never needs an APK rebuild.
//
// Adapter contract (every file in this folder default-exports an object with this shape):
//   id               string, the value of AI_PROVIDER
//   imagesSupported  boolean, can this provider return images through chat "modalities"?
//   keyOf(env)       the secret for this provider, read from the server environment only
//   endpoint(env)    full URL of the chat-completions endpoint
//   headers(key)     request headers including authorization
//   validate(env)?   returns an error string if the provider's non-secret configuration is invalid
//   mapModel(m,env)? translate the app/server model name to this provider's naming
//   prepareBody(b)?  adjust the OpenAI-format request body for this provider
// To add Anthropic (or any non-OpenAI-format API) later: add adapter.js that ALSO implements
//   toRequest(body) -> { url, headers, body }  and  fromResponse(json) -> OpenAI-format { choices: [...] }
// and teach forwardChat in ../ai.js to call them when present. Not implemented yet.
import openrouter from './openrouter.js';
import openai from './openai.js';
import compatible from './compatible.js';

export const PROVIDERS = Object.fromEntries([openrouter, openai, compatible].map(p => [p.id, p]));
export const DEFAULT_PROVIDER = 'openrouter';
export const providerFor = env => PROVIDERS[String(env.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase()];
