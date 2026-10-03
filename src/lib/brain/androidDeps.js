// Wires the provider-neutral tool handlers to the real Android bridge. Only the app imports this file.
import { device, runAction, resolveTarget } from '../phone.js';
import { http } from './http.js';

export const androidDeps = ({ confirm, onSms, lang = 'en-US' }) => ({
  phone: device,
  run: runAction,
  resolveTarget,
  confirm,
  onSms,
  http,
  lang,
  units: lang === 'en-US' ? 'fahrenheit' : 'celsius',
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  settleMs: 1200, // lets a launched app come to the foreground before the next step (e.g. media.play)
});
