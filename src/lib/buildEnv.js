// Build-time switches (Vite). In plain Node (tests) import.meta.env is undefined, so everything is permissive.
const env = () => (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const buildApi = () => String(env().VITE_API || '').replace(/\/+$/, '');
// Release builds must not hold an AI key on the phone. Direct mode is for `npm run dev` or an explicit opt-in build.
export const directAllowed = () => { const e = env(); return !e.MODE || e.DEV === true || e.VITE_ALLOW_DIRECT === 'true'; };
