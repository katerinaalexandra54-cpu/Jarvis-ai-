import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { forwardChat } from './ai.js';
import { authorize, registerDevice } from './auth.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // behind a host's proxy: use the real client IP for rate limits
const port = process.env.PORT || 8787;
app.use(express.json({ limit: '15mb' })); // room for PDF/image analysis requests

// CORS allowlist so the Capacitor APK (served from capacitor://localhost) can call a remote server.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'capacitor://localhost,http://localhost,https://localhost').split(',').map(s => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Legacy routes are not used by the app; they now require the same device token so they can never be abused.
app.use(['/api/chat', '/api/voice', '/api/phone'], (req, res, next) => {
  const a = authorize(process.env, req.headers);
  return a.ok ? next() : res.status(a.status).json(a.body);
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'jarvis-api', version: '1.0.0' }));
app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (message.length > 12000) return res.status(413).json({ error: 'message is too long' });
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ reply: "I'm ready to help. Add ANTHROPIC_API_KEY to the server environment to enable live answers.", received: message, provider: 'fallback' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6', max_tokens: 700, system: 'You are Jarvis, a concise, helpful phone assistant. Never claim you performed a phone action unless the native bridge confirms it.', messages: [{ role: 'user', content: message }] })
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: data?.error?.message || 'AI provider request failed' });
    const reply = data?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || 'I received your request.';
    return res.json({ reply, provider: 'anthropic' });
  } catch (error) { return res.status(502).json({ error: `AI provider unavailable: ${error.message}` }); }
});
// JARVIS AI gateway: the phone sends chat/tool requests here; only the server holds the provider key.
const hits = new Map(), regHits = new Map();
const limited = (map, ip, max, windowMs) => { const now = Date.now(), recent = (map.get(ip) || []).filter(t => now - t < windowMs); map.set(ip, [...recent, now]); return recent.length >= max; };
app.post('/api/auth/register', (req, res) => {
  if (limited(regHits, req.ip, 10, 3600000)) return res.status(429).json({ error: { message: 'Too many attempts. Try again later.' } });
  const out = registerDevice(process.env, req.body);
  res.status(out.status).json(out.body);
});
app.post('/api/ai/chat', async (req, res) => {
  if (limited(hits, req.ip, 60, 60000)) return res.status(429).json({ error: { message: 'Too many requests. Slow down.' } });
  const out = await forwardChat(process.env, req.headers, req.body);
  res.status(out.status).json(out.body);
});
app.post('/api/voice/transcribe', (_req, res) => res.status(501).json({ error: 'Speech transcription is not configured yet.' }));
app.post('/api/phone/permissions', (_req, res) => res.json({ permissions: ['notifications', 'microphone', 'contacts', 'phone'], nativeBridge: 'JarvisPhone' }));
app.post('/api/phone/action', (req, res) => {
  const allowed = ['readSms', 'sendSms', 'call', 'openApp', 'requestPermissions'];
  const action = String(req.body?.action || '');
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Unsupported phone action' });
  if (['call', 'sendSms'].includes(action) && req.body?.confirmed !== true) return res.status(400).json({ error: 'Explicit confirmation is required for this action' });
  // Native execution must happen through the Capacitor JarvisPhone plugin after explicit user permission.
  res.json({ queued: false, action, status: 'native_bridge_required' });
});

const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'))); }
else app.get('/', (_req, res) => res.json({ ok: true, service: 'jarvis-api' }));
app.listen(port, '0.0.0.0', () => console.log(`Jarvis server listening on ${port}`));
