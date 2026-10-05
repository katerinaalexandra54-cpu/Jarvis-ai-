import { directAllowed } from './buildEnv.js';
export const load = (k, d) => { try { const v = localStorage.getItem('jarvis.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const save = (k, v) => { try { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
export const uid = () => Math.random().toString(36).slice(2, 10);

export const DEFAULTS = {
  provider: 'openrouter',
  apiKey: '',
  wakeWord: false,
  offlineRecognition: false,
  model: 'openai/gpt-4o-mini',
  imageModel: 'google/gemini-3.1-flash-image-preview',
  speakReplies: true,
  lang: 'en-US',
};

export function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}
export const clock = (ts = Date.now()) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// ---- local accounts (stored on this phone) ----
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function signUp({ name, email, password }) {
  email = email.trim().toLowerCase();
  if (!name.trim()) throw new Error('Enter your full name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 6) throw new Error('Use a password with at least 6 characters.');
  const accounts = load('accounts', []);
  if (accounts.some(a => a.email === email)) throw new Error('An account with this email already exists. Sign in instead.');
  const salt = uid();
  const user = { name: name.trim(), email, salt, hash: await sha(salt + password) };
  save('accounts', [...accounts, user]); save('session', email);
  return { name: user.name, email };
}
export async function signIn({ email, password }) {
  email = email.trim().toLowerCase();
  const user = load('accounts', []).find(a => a.email === email);
  if (!user || user.hash !== await sha(user.salt + password)) throw new Error('Email or password is incorrect.');
  save('session', email);
  return { name: user.name, email };
}
export const currentUser = () => { const e = load('session', null); const u = load('accounts', []).find(a => a.email === e); return u ? { name: u.name, email: u.email } : null; };
export const signOut = () => save('session', null);
export const updateAccount = (email, name) => { save('accounts', load('accounts', []).map(a => a.email === email ? { ...a, name } : a)); };

// Settings loader. Release builds never keep an AI key on the phone: any key saved by an older build is erased.
export function loadSettings() {
  const s = { ...DEFAULTS, ...load('settings', {}) };
  if (!directAllowed() && s.apiKey) { s.apiKey = ''; save('settings', s); }
  return s;
}
