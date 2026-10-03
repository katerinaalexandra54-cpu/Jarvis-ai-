import { getProvider } from './providers/index.js';
export { NoKeyError } from './providers/errors.js';

// Thin wrappers: the rest of the app calls these and never talks to a vendor directly.
export async function complete(settings, messages, opts = {}) {
  const r = await getProvider(settings).chat(settings, { messages, model: opts.model, maxTokens: opts.max_tokens || 1000 });
  return r.text;
}

export const generateImage = (settings, prompt) => getProvider(settings).generateImage(settings, prompt);

export function parseJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

// Turns a picked file into message content parts for the model.
export function fileToParts(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    if (/^text\//.test(file.type) || /\.(txt|md|csv|json|log)$/i.test(file.name)) {
      r.onload = () => resolve([{ type: 'text', text: `File "${file.name}":\n${String(r.result).slice(0, 60000)}` }]);
      r.readAsText(file);
    } else if (/^image\//.test(file.type)) {
      r.onload = () => resolve([{ type: 'image_url', image_url: { url: r.result } }]);
      r.readAsDataURL(file);
    } else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      r.onload = () => resolve([{ type: 'file', file: { filename: file.name, file_data: r.result } }]);
      r.readAsDataURL(file);
    } else reject(new Error('Use a PDF, image or text file.'));
  });
}

export function assistantPrompt({ now, lastSms, name }) {
  return `You are JARVIS, a voice assistant living inside the user's Android phone, like Siri. The user's name is ${name || 'there'}. Current local time: ${now}.
Reply with ONLY a JSON object, no markdown fences: {"say": "<what you speak and show, short and natural>", "action": null or one action}
Keep "say" to one or two short sentences unless the user asks for an explanation. Never use markdown in "say".
When the user asks you to do something on the phone, fill "action" and write "say" as the confirmation (e.g. "Alarm set for 7:30 AM."). For texts and calls, "say" must ask nothing: the app asks for confirmation itself.
Actions:
{"type":"setAlarm","hour":0-23,"minute":0-59,"label":""}
{"type":"setTimer","seconds":number,"label":""}
{"type":"openApp","name":"app name"}
{"type":"call","to":"contact name or phone number"}
{"type":"sendSms","to":"contact name or phone number","body":"message text"}
{"type":"readSms","count":1-5,"from":"optional contact name"}
{"type":"globalAction","action":"screenshot|home|back|recents|notifications|quickSettings|lock"}
{"type":"flashlight","on":true|false}
{"type":"openSettings","page":"wifi|bluetooth|display|sound|battery|location|apps|accessibility"}
{"type":"openUrl","url":"https://..."} (web searches, maps: https://www.google.com/maps/search/?api=1&query=...)
For "reply to this message", use sendSms with "to" = the last sender${lastSms ? `: ${lastSms}` : ' (unknown, ask who to reply to)'}.
If you are unsure which contact or app is meant, set action to null and ask. Otherwise just answer the question in "say".`;
}
