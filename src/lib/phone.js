import { Capacitor, registerPlugin } from '@capacitor/core';

const Native = registerPlugin('JarvisPhone');
export const isNative = () => Capacitor.isNativePlatform();

export const phoneStatus = async () => (isNative() ? Native.status() : null);
export const requestPermissions = () => Native.requestAllPermissions();
export const openAccessibility = () => Native.openAccessibilitySettings();

const plain = t => String(t).replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();

export async function speak(text, lang = 'en-US') {
  const t = plain(text).slice(0, 700);
  if (!t) return;
  if (isNative()) { try { await Native.speak({ text: t, lang }); } catch { /* speech engine missing */ } return; }
  if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = lang; speechSynthesis.speak(u); }
}
export function stopSpeaking() {
  if (isNative()) Native.stopSpeaking().catch(() => {});
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
}

let webRec = null;
export function stopListening() {
  if (isNative()) Native.stopListening().catch(() => {});
  else webRec?.stop();
}

export async function listen(onPartial = () => {}, lang = 'en-US', onStarted = () => {}, options = {}) {
  if (isNative()) {
    let s = await Native.status();
    if (!s.mic) { s = await Native.requestAllPermissions(); if (!s.mic) throw new Error('Microphone permission is needed. Allow it in Settings > Phone Control.'); }
    const h = await Native.addListener('partial', e => onPartial(e.text));
    const started = await Native.addListener('listeningStarted', () => onStarted());
    try {
      const result = options.offline && /^en-US$/i.test(lang) && Native.listenOffline
        ? await Native.listenOffline({ lang })
        : await Native.listen({ lang });
      return result.text || '';
    } finally { h.remove(); started.remove(); }
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error('Voice input works in the Android app or Chrome.');
  return new Promise((resolve, reject) => {
    const r = webRec = new SR();
    let last = '';
    r.lang = lang; r.interimResults = true;
    r.onresult = e => { last = [...e.results].map(x => x[0].transcript).join(' '); onPartial(last); };
    r.onerror = e => reject(new Error(e.error === 'not-allowed' ? 'Microphone permission is needed.' : "I didn't catch that."));
    r.onend = () => resolve(last);
    r.start(); onStarted();
  });
}

export async function probeVoskWake(onPartial = () => {}) {
  if (!isNative() || !Native.probeVoskWake) return { detected: false, supported: false };
  let s = await Native.status();
  if (!s.mic) { s = await Native.requestAllPermissions(); if (!s.mic) throw new Error('Microphone permission is needed.'); }
  const h = await Native.addListener('offlinePartial', e => onPartial(e.text || ''));
  try { return await Native.probeVoskWake(); } finally { h.remove(); }
}

const looksLikeNumber = s => /^[+\d][\d\s\-().]{4,}$/.test(s.trim());
export async function resolveTarget(to) {
  if (looksLikeNumber(to)) return { name: to.trim(), number: to.replace(/[^\d+]/g, '') };
  if (!isNative()) throw new Error('I can only look up contacts inside the Android app.');
  let s = await Native.status();
  if (!s.contacts) s = await Native.requestAllPermissions();
  return Native.findContact({ name: to });
}

export async function runAction(a) {
  if (a.type === 'openUrl') {
    if (isNative()) await Native.openUrl({ url: a.url }); else window.open(a.url, '_blank');
    return {};
  }
  if (!isNative()) throw new Error('I can only do that inside the Android app.');
  const s = await Native.status();
  const need = { call: 'phone', sendSms: 'sms', readSms: 'sms' }[a.type];
  if (need && !s[need]) { const n = await Native.requestAllPermissions(); if (!n[need]) throw new Error('I need that permission first. Allow it in Settings > Phone Control.'); }
  switch (a.type) {
    case 'setAlarm': await Native.setAlarm({ hour: Number(a.hour), minute: Number(a.minute) || 0, label: a.label || 'Jarvis alarm' }); return {};
    case 'setTimer': await Native.setTimer({ seconds: Math.round(Number(a.seconds)), label: a.label || 'Jarvis timer' }); return {};
    case 'openApp': { const r = await Native.openApp({ name: a.name }); return { note: `Opening ${r.app}.` }; }
    case 'openSettings': await Native.openSettings({ page: a.page }); return {};
    case 'flashlight': await Native.flashlight({ on: a.on !== false }); return {};
    case 'globalAction': await Native.globalAction({ action: a.action }); return {};
    case 'call': await Native.placeCall({ number: a.number }); return {};
    case 'sendSms': await Native.sendSms({ number: a.number, body: a.body }); return {};
    case 'readSms': { const r = await Native.readSms({ count: a.count || 3, from: a.from || '' }); return { sms: r.messages }; }
    default: throw new Error("I don't know how to do that yet.");
  }
}

// ---- JARVIS tool adapters: thin wrappers over the native plugin. They throw plain-English errors. ----
const nat = () => { if (!isNative()) throw new Error('That only works inside the Android app.'); return Native; };
export const device = {
  setTorch: async enabled => { await nat().setTorch({ enabled }); },
  getVolume: stream => nat().getVolume({ stream }),
  setVolume: (level, stream) => nat().setVolume({ level, stream }),
  openApp: name => nat().openApp({ name }),
  getBattery: () => nat().getBattery(),
  getDeviceInfo: () => nat().getDeviceInfo(),
  mediaControl: action => nat().mediaControl({ action }),
  getLocation: async () => {
    let st = await nat().status();
    if (!st.location) st = await nat().requestAllPermissions();
    if (!st.location) throw new Error('Location permission is needed. Allow it in Settings > Phone Control.');
    return nat().getLocation();
  },
};

// ---- Wake word ("Hey JARVIS"). Native only; every call is a safe no-op in a browser. ----
export const wake = {
  supported: () => isNative(),
  start: (sensitivity = 0.7) => Native.startWake({ sensitivity }),
  stop: () => (isNative() ? Native.stopWake().catch(() => {}) : Promise.resolve()),
  pause: () => (isNative() ? Native.pauseWake().catch(() => {}) : Promise.resolve()),
  resume: () => (isNative() ? Native.resumeWake().catch(() => {}) : Promise.resolve()),
  ack: () => (isNative() ? Native.wakeAck().catch(() => {}) : Promise.resolve()),
  isSpeaking: async () => { try { return isNative() ? !!(await Native.isSpeaking()).speaking : false; } catch { return false; } },
  consumePending: async () => { try { return isNative() ? !!(await Native.consumePendingWake()).pending : false; } catch { return false; } },
  /** Subscribe to native bridge events such as 'wake', 'wakeError', 'wakeStopped', and 'speechError'. */
  on: async (event, cb) => {
    if (!isNative()) return () => {};
    const h = await Native.addListener(event, cb);
    return () => h.remove();
  },
};

export async function saveImage(dataUrl, name = 'jarvis-image') {
  const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] || 'image/png';
  const ext = mime.split('/')[1] || 'png';
  if (isNative()) { await Native.saveImage({ dataUrl, mime, name: `${name}-${Date.now()}.${ext}` }); return 'Saved to Pictures/Jarvis.'; }
  const a = document.createElement('a'); a.href = dataUrl; a.download = `${name}.${ext}`; a.click();
  return 'Downloaded.';
}

export async function shareText(text) {
  try { if (navigator.share) { await navigator.share({ text }); return ''; } } catch { return ''; }
  try { await navigator.clipboard.writeText(text); return 'Copied to clipboard.'; } catch { return 'Sharing is not available here.'; }
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return 'Copied.'; } catch { return 'Copy is not available here.'; }
}
