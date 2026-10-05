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
