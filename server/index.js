import { authorize } from './auth.js';
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { forwardChat } from './ai.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind a host's proxy (Railway, Render, ...): use the real client IP for rate limits
const port = process.env.PORT || 8787;

app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next(); });

// CORS allowlist so the Capacitor APK (served from capacitor://localhost) can call a remote server.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'capacitor://localhost,http://localhost,http://localhost:5173,https://localhost').split(',').map(s => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'jarvis-api', version: '1.0.0' }));

// Simple in-memory sliding-window limiter. Old entries are pruned so the maps cannot grow without bound.
const hits = new Map(), regHits = new Map(), ttsHits = new Map();
const limited = (map, ip, max, windowMs) => {
  const now = Date.now(), recent = (map.get(ip) || []).filter(t => now - t < windowMs);
  map.set(ip, [...recent, now]);
  return recent.length >= max;
};
const prune = (map, windowMs) => { const now = Date.now(); for (const [k, v] of map) if (!v.some(t => now - t < windowMs)) map.delete(k); };
setInterval(() => { prune(hits, 60000); prune(regHits, 3600000); }, 60000).unref();

app.post('/api/auth/register', (req, res, next) => {
  if (limited(regHits, req.ip, 10, 3600000)) return res.status(429).json({ error: { message: 'Too many attempts. Try again later.' } });
  next();
}, express.json({ limit: '4kb' }), (req, res) => {
  const out = registerDevice(process.env, req.body);
  res.status(out.status).json(out.body);
});

// Order matters: rate limit, then device auth, and only then parse the (up to 15 MB) body, so unauthenticated
// callers cannot make the server buffer large uploads.
app.post('/api/ai/chat', (req, res, next) => {
  if (limited(hits, req.ip, 60, 60000)) return res.status(429).json({ error: { message: 'Too many requests. Slow down.' } });
  const a = authorize(process.env, req.headers);
  return a.ok ? next() : res.status(a.status).json(a.body);
}, express.json({ limit: '15mb' }), async (req, res) => { // 15 MB leaves room for PDF/image analysis requests
  const out = await forwardChat(process.env, req.headers, req.body);
  res.status(out.status).json(out.body);
});


// Protected OmegaTech speech generation. The phone never needs a provider secret.
app.post('/api/ai/tts', (req, res, next) => {
  if (limited(ttsHits, req.ip, 20, 60000)) {
    return res.status(429).json({ error: { message: 'Speech limit reached. Try again shortly.' } });
  }
  const a = authorize(process.env, req.headers);
  return a.ok ? next() : res.status(a.status).json(a.body);
}, express.json({ limit: '16kb' }), async (req, res) => {
  const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!text) return res.status(400).json({ error: { message: 'Speech text is required.' } });

  try {
    const endpoint = new URL('https://api.omegatech.app/api/ai/text2speech-v3');
    endpoint.searchParams.set('text', text);
    endpoint.searchParams.set('voice', 'woman1');
    endpoint.searchParams.set('language', 'English');

    const upstream = await fetch(endpoint, { signal: AbortSignal.timeout(20000) });
    const data = await upstream.json();
    if (!upstream.ok || data?.success !== true || typeof data.audio !== 'string') {
      return res.status(502).json({ error: { message: 'Natural speech is temporarily unavailable.' } });
    }

    const audioUrl = new URL(data.audio);
    if (audioUrl.protocol !== 'https:' || audioUrl.hostname !== 'replicate.delivery') {
      return res.status(502).json({ error: { message: 'Speech provider returned an invalid audio link.' } });
    }
    return res.json({ audio: audioUrl.href });
  } catch {
    return res.status(502).json({ error: { message: 'Natural speech is temporarily unavailable.' } });
  }
});


// Authenticated image generation. Return image bytes, never a provider URL.
app.post('/api/ai/image', express.json({ limit: '20kb' }), async (req, res) => {
  const auth = authorize(process.env, req.headers);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const prompt = String(req.body?.prompt || '').trim();
  const ratio = String(req.body?.ratio || '1:1');
  if (!prompt || prompt.length > 4000) {
    return res.status(400).json({ error: { message: 'Enter an image prompt (maximum 4000 characters).' } });
  }
  if (!['1:1', '16:9', '9:16', '4:3', '3:4'].includes(ratio)) {
    return res.status(400).json({ error: { message: 'Unsupported image ratio.' } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await fetch('https://api.omegatech.app/api/ai/Freegen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'image/png, application/json' },
      body: JSON.stringify({ action: 'generate', prompt, ratio }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: { message: `Image provider failed (${upstream.status}).` } });
    }

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    if (type.startsWith('image/')) {
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) {
        return res.status(502).json({ error: { message: 'The generated image was empty or too large.' } });
      }
      res.set('Content-Type', type.includes('png') ? 'image/png' : type);
      res.set('Cache-Control', 'no-store');
      return res.status(200).send(bytes);
    }

    // Some provider responses wrap the image in base64 or a result URL.
    const data = await upstream.json();
    const encoded = data?.imageBase64 || data?.base64 || data?.image;
    if (typeof encoded === 'string' && !/^https?:\/\//i.test(encoded)) {
      const clean = encoded.replace(/^data:image\/[^;]+;base64,/i, '');
      const bytes = Buffer.from(clean, 'base64');
      if (bytes.length && bytes.length <= 15 * 1024 * 1024) {
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        return res.status(200).send(bytes);
      }
    }

    return res.status(502).json({
      error: { message: 'The image provider did not return raw image data. Check its current response format.' }
    });
  } catch (e) {
    return res.status(e?.name === 'AbortError' ? 504 : 502).json({
      error: { message: e?.name === 'AbortError' ? 'Image generation timed out.' : 'Could not reach the image provider.' }
    });
  } finally {
    clearTimeout(timer);
  }
});

// Old, unused routes (/api/chat with a hardcoded Anthropic call, /api/voice/transcribe, /api/phone/*) were removed:
// nothing in the app called them, and a hardcoded provider conflicts with the adapter design in server/providers.

const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }
else app.get('/', (_req, res) => res.json({ ok: true, service: 'jarvis-api' }));

// JSON error handler: bad JSON or oversized bodies return a JSON error the app can show, not an HTML page.
app.use((e, _req, res, _next) => {
  const status = e?.status || e?.statusCode || 500;
  res.status(status).json({ error: { message: status === 413 ? 'That request is too large.' : status === 400 ? 'Invalid request.' : 'Server error.' } });
});
app.listen(port, '0.0.0.0', () => console.log(`Jarvis server listening on ${port}`));
