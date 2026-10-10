const APP_ALIASES = [
  ['tiktok', 'TikTok'], ['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'],
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['youtube', 'YouTube'],
  ['messages', 'Messages'], ['message', 'Messages'],
];

const clean = text => String(text || '').toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();

/** Return only high-confidence, side-effecting local intents. Unknown speech goes to the normal agent. */
export function parseLocalIntent(text) {
  const value = clean(text);
  if (!value) return null;

  const app = APP_ALIASES.find(([alias]) => new RegExp(`\\b${alias}\\b`, 'i').test(value));
  if (app && /\b(open|launch|start|go to|go into|use|enter)\b/i.test(value)
      && !/\b(read|chat|reply|send)\b/i.test(value)) {
    return { tool: 'app_open', args: { name: app[1] }, kind: 'open', app: app[1] };
  }

  if (/\b(go|take me|navigate)\s+(back|backward)\b|\bpress\s+back\b/.test(value))
    return { tool: 'system_button', args: { action: 'back' }, kind: 'system', response: 'Going back.' };
  if (/\b(go|take me)\s+home\b|\bpress\s+home\b/.test(value))
    return { tool: 'system_button', args: { action: 'home' }, kind: 'system', response: 'Going home.' };
  if (/\bscroll\s+(up|upward)\b/.test(value))
    return { tool: 'accessibility_scroll', args: { direction: 'up', count: 1 }, kind: 'system', response: 'Scrolling up.' };
  if (/\bscroll\s+(down|downward)\b/.test(value))
    return { tool: 'accessibility_scroll', args: { direction: 'down', count: 1 }, kind: 'system', response: 'Scrolling down.' };
  if (/\b(read|show|check)\s+(my\s+)?(latest\s+)?notifications?\b/.test(value))
    return { tool: 'message.read_notification', args: {}, kind: 'notification' };

  return null;
}
