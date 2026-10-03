// Provider registry. To add OpenAI later: create ./openai.js with the same shape as ./openrouter.js,
// import it here, add it to PROVIDERS, then set settings.provider = 'openai'. Nothing else changes.
import openrouter from './openrouter.js';
import backend, { backendUrl } from './backend.js';
import { ProviderError } from './errors.js';
import { directAllowed } from '../buildEnv.js';

export const PROVIDERS = { [openrouter.id]: openrouter, [backend.id]: backend };
export const DEFAULT_PROVIDER = openrouter.id;

/** 'backend' = production (key on the server). 'direct' = dev only (key on the phone). 'none' = release build with no server. */
export const accessMode = settings => backendUrl(settings) ? 'backend' : directAllowed() ? 'direct' : 'none';

const unconfigured = {
  id: 'none', name: 'Not configured',
  async chat() { throw new ProviderError('This app build is not connected to a JARVIS server. Rebuild it with VITE_API set.'); },
  async generateImage() { throw new ProviderError('This app build is not connected to a JARVIS server.'); },
};

export function getProvider(settings) {
  const mode = accessMode(settings);
  if (mode === 'backend') return backend;
  if (mode === 'none') return unconfigured;
  return PROVIDERS[settings?.provider] || PROVIDERS[DEFAULT_PROVIDER];
}
export { NoKeyError, ProviderError, NetworkError } from './errors.js';
export { registerDevice, clearToken, hasToken } from './backend.js';
