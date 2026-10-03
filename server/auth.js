// Stateless device auth. No database: the server signs a token (HMAC-SHA256) after a valid access code is
// presented; every AI request must carry it. Tokens expire (90 days) and individual devices can be blocked.
import crypto from 'node:crypto';

const DAY = 86400000;
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
const safeEq = (x, y) => { const a = Buffer.from(String(x)), b = Buffer.from(String(y)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const err = (status, message) => ({ status, body: { error: { message } } });
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const secretOf = env => (env.JARVIS_TOKEN_SECRET && env.JARVIS_TOKEN_SECRET.length >= 16 ? env.JARVIS_TOKEN_SECRET : '');

export function signToken(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}
export function verifyToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.split('.').length !== 2) return null;
  const [body, sig] = token.split('.');
  if (!safeEq(sig, sign(secret, body))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  return p?.sub && p.exp > now ? p : null;
}

/** POST /api/auth/register  { inviteCode, deviceId } -> { token, expiresAt } */
export function registerDevice(env, body, now = Date.now()) {
  const secret = secretOf(env);
  if (!secret) return err(500, 'Server auth is not configured (set JARVIS_TOKEN_SECRET, 16+ characters).');
  if (env.JARVIS_OPEN_REGISTRATION !== 'true') {
    const codes = list(env.JARVIS_INVITE_CODES);
    if (!codes.length) return err(403, 'Registration is closed.');
    if (!codes.some(c => safeEq(c, body?.inviteCode ?? ''))) return err(403, 'That access code is not valid.');
  }
  const sub = /^[a-f0-9]{16,64}$/.test(body?.deviceId || '') ? body.deviceId : crypto.randomBytes(12).toString('hex');
  if (list(env.JARVIS_REVOKED).includes(sub)) return err(403, 'This device has been blocked.');
  const exp = now + 90 * DAY;
  return { status: 200, body: { token: signToken(secret, { sub, iat: now, exp }), expiresAt: exp } };
}

/** Checks the Authorization header. Secure by default: with no secret configured, everything is refused. */
export function authorize(env, headers = {}, now = Date.now()) {
  if (env.JARVIS_ALLOW_ANONYMOUS === 'true') return { ok: true, sub: 'anonymous' }; // local development only
  const secret = secretOf(env);
  if (!secret) return { ok: false, ...err(500, 'Server auth is not configured (set JARVIS_TOKEN_SECRET).') };
  const m = /^Bearer (.+)$/.exec(headers.authorization || '');
  const p = m && verifyToken(secret, m[1], now);
  if (!p) return { ok: false, ...err(401, 'Not authorized.') };
  if (list(env.JARVIS_REVOKED).includes(p.sub)) return { ok: false, ...err(403, 'This device has been blocked.') };
  return { ok: true, sub: p.sub };
}
