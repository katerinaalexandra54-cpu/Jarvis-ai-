import { useEffect, useRef, useState } from 'react';
import { useApp } from './ctx.js';
import { accessMode, registerDevice } from './lib/providers/index.js';

const P = {
  menu: 'M4 7h16M4 12h16M4 17h16', back: 'M15 5l-7 7 7 7', mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z', chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  tools: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01', file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  more: 'M6 12h.01M12 12h.01M18 12h.01', summarizer: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  translator: 'M4 5h9M8.5 3v2M6 5c.6 3.5 3 6 6 7M12 5c-.7 3.3-3.4 6.2-7 8M12 21l4.5-10L21 21M13.5 17.5h6',
  calculator: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  copy: 'M9 9h11v11H9zM5 15V4h11', share: 'M12 3v12M8 7l4-4 4 4M5 13v7h14v-7', refresh: 'M20 5v5h-5M4 19v-5h5M5.6 9A8 8 0 0 1 19 7M18.4 15A8 8 0 0 1 5 17',
  volume: 'M4 10v4h4l5 4V6l-5 4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12', download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6', paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', eyeoff: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM4 4l16 16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', mail: 'M3 6h18v12H3zM3 7l9 7 9-7', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  chev: 'M9 6l6 6-6 6', chevdown: 'M6 9l6 6 6-6', x: 'M6 6l12 12M18 6L6 18', sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7', bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  check: 'M5 12l5 5 9-10', checklist: 'M4 6l2 2 3-3M4 14l2 2 3-3M12 7h8M12 15h8', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  key: 'M7.5 20a4.5 4.5 0 1 1 3.2-7.7L20 3M16 7l3 3', plus: 'M12 5v14M5 12h14', crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5z',
  apple: 'M16.4 12.7c0-2.4 2-3.5 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8s1.9.8 3.1.7c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.6-3.9zM14.1 5.5c.7-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.1 1.9-1 3 1.1.1 2.1-.5 2.8-1.4z',
};
export const Icon = ({ n, size = 22, sw = 1.8, className = '' }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={n === 'apple' ? 'currentColor' : 'none'} stroke={n === 'apple' ? 'none' : 'currentColor'}
    strokeWidth={n === 'more' ? 3 : sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>
);

export const Mark = ({ size = 120, glow = true, spin = false }) => (
  <div className={`mark ${glow ? 'glow' : ''} ${spin ? 'spin' : ''}`} style={{ width: size, height: size }}>
    <img src="/assets/jarvis-mark.jpg" alt="JARVIS" draggable="false" />
  </div>
);
export const Wordmark = ({ size = 15 }) => <span className="wordmark" style={{ fontSize: size }}>J<b>A</b>RVIS</span>;
export const Logo = ({ size = 30 }) => <span className="logo"><Mark size={size} glow={false} /><Wordmark /></span>;

export function Header({ title, right, root }) {
  const { back, openDrawer, stack, go } = useApp();
  const canBack = stack.length > 1 && !root;
  return (
    <header className="hdr">
      <button className="circle-btn" onClick={canBack ? back : openDrawer} aria-label={canBack ? 'Back' : 'Menu'}><Icon n={canBack ? 'back' : 'menu'} /></button>
      <div className="hdr-title">{title ? <h1>{title}</h1> : <Logo />}</div>
      {right || (title ? <span className="hdr-space" /> : <button className="pro" onClick={() => go('settings')}>Pro <Icon n="chev" size={13} /></button>)}
    </header>
  );
}

export const Scroll = ({ children, className = '' }) => <main className={`scroll ${className}`}>{children}</main>;

export function Row({ icon, tone = 'blue', title, sub, onClick, trailing, chev = true }) {
  return (
    <button className="row glass" onClick={onClick}>
      <span className={`ico tone-${tone}`}><Icon n={icon} size={20} /></span>
      <span className="row-t"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      {trailing}{chev && <Icon n="chev" size={18} className="dim" />}
    </button>
  );
}

export function ToolCard({ icon, tone, title, sub, onClick }) {
  return (
    <button className="tool-card glass" onClick={onClick}>
      <span className={`ico tone-${tone}`}><Icon n={icon} size={20} /></span>
      <strong>{title}</strong><small>{sub}</small>
    </button>
  );
}

export const TOOLS = [
  { id: 'chat', icon: 'chat', tone: 'blue', title: 'Chat', sub: 'Ask anything', screen: 'chat' },
  { id: 'summarizer', icon: 'summarizer', tone: 'indigo', title: 'Summarizer', sub: 'Turn long text to key points', screen: 'summarizer' },
  { id: 'imagegen', icon: 'image', tone: 'green', title: 'Image Generator', sub: 'Create stunning images', screen: 'imagegen' },
  { id: 'translator', icon: 'translator', tone: 'violet', title: 'Translator', sub: 'Break language barriers', screen: 'translator' },
  { id: 'docanalysis', icon: 'file', tone: 'blue', title: 'Document Analysis', sub: 'Extract insights', screen: 'docanalysis' },
  { id: 'calculator', icon: 'calculator', tone: 'cyan', title: 'Calculator', sub: 'Quick math', screen: 'calculator' },
];

export function Sheet({ open, onClose, children }) {
  if (!open) return null;
  return <div className="scrim" onClick={onClose}><div className="sheet glass thick" onClick={e => e.stopPropagation()}>{children}</div></div>;
}

export function KeySheet() {
  const { keyOpen, setKeyOpen, settings, setSettings, notify } = useApp();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const mode = accessMode(settings);
  const close = () => { setV(''); setKeyOpen(false); };
  return (
    <Sheet open={keyOpen} onClose={() => setKeyOpen(false)}>
      <span className="ico tone-blue big"><Icon n="key" size={24} /></span>
      {mode === 'backend' && <>
        <h2>Enter your access code</h2>
        <p className="muted">This connects the app to your JARVIS server. It is only needed once. Your AI key never leaves the server.</p>
        <label className="field"><Icon n="lock" size={18} /><input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Access code" autoCapitalize="off" autoCorrect="off" spellCheck="false" /></label>
        <button className="btn" disabled={busy || v.trim().length < 4}
          onClick={async () => { setBusy(true); try { await registerDevice(settings, v); close(); notify('Connected. Try again.'); } catch (e) { notify(e.message); } finally { setBusy(false); } }}>{busy ? 'Connecting...' : 'Connect'}</button></>}
      {mode === 'direct' && <>
        <h2>Paste your OpenRouter key</h2>
        <p className="muted">Developer build only: the key is stored on this phone. Get one at openrouter.ai/keys.</p>
        <label className="field"><Icon n="lock" size={18} /><input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="sk-or-v1-..." autoCapitalize="off" autoCorrect="off" spellCheck="false" /></label>
        <button className="btn" disabled={v.trim().length < 10}
          onClick={() => { setSettings({ ...settings, apiKey: v.trim() }); close(); notify('Key saved. Try again.'); }}>Save key</button></>}
      {mode === 'none' && <>
        <h2>Not connected</h2>
        <p className="muted">This app build has no JARVIS server configured. Rebuild it with VITE_API pointing at your server.</p></>}
    </Sheet>
  );
}

export function Wave({ active, n = 14 }) {
  return <span className={`wave ${active ? 'on' : ''}`} aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 7) * 0.09}s`, height: `${6 + ((i * 7) % 5) * 4}px` }} />)}</span>;
}

export function useAutoScroll(dep) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [dep]);
  return ref;
}
