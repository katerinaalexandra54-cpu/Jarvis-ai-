import { useEffect, useState } from 'react';
import { useApp } from '../ctx.js';
import { Header, Icon, Row, Scroll } from '../components.jsx';
import { ago, updateAccount } from '../lib/store.js';
import { isNative, openAccessibility, phoneStatus, requestPermissions, speak } from '../lib/phone.js';
import { accessMode, clearToken, hasToken } from '../lib/providers/index.js';

/* ---------- History ---------- */
const TABS = ['All', 'Chat', 'Tools', 'Files'];
const TYPE = { All: null, Chat: 'chat', Tools: 'tool', Files: 'file' };
export function History() {
  const { history, go, clearHistory } = useApp();
  const [tab, setTab] = useState('All'); const [q, setQ] = useState(''); const [search, setSearch] = useState(false);
  const list = history.filter(h => (!TYPE[tab] || h.type === TYPE[tab]) && h.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Header title="History" root right={<button className="circle-btn" onClick={() => { setSearch(!search); setQ(''); }} aria-label="Search history"><Icon n="search" size={20} /></button>} />
      <Scroll>
        {search && <label className="field glass"><Icon n="search" size={18} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search history" /></label>}
        <div className="tabs">{TABS.map(t => <button key={t} className={`glass ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>
        {list.length ? list.map(h => <Row key={h.id} icon={h.icon || 'file'} title={h.title} sub={ago(h.ts)} onClick={() => go(h.payload.screen, h.payload.params)} />)
          : <p className="empty glass">{history.length ? 'No matches.' : 'Your chats, tools and files will show up here.'}</p>}
        {history.length > 0 && <button className="link center-link" onClick={clearHistory}>Clear history</button>}
      </Scroll>
    </>
  );
}

/* ---------- Settings ---------- */
const ITEMS = [
  ['user', 'Account', 'acct'], ['sparkle', 'AI Preferences', 'ai'], ['volume', 'Voice & Speech', 'voice'], ['phone', 'Phone Control', 'phone'],
  ['settings', 'Appearance', 'appearance', 'Dark Mode'], ['bell', 'Notifications', 'notifications'], ['shield', 'Privacy & Security', 'privacy'], ['info', 'About JARVIS', 'about'],
];
export function Settings() {
  const { user, go, signOut } = useApp();
  return (
    <>
      <Header title="Settings" root />
      <Scroll>
        <div className="profile glass thick"><span className="avatar">{user.name[0].toUpperCase()}</span><span className="row-t"><strong>{user.name}</strong><small>{user.email}</small></span><span className="plan">Pro Plan</span></div>
        <div className="list">{ITEMS.map(([i, t, p, trail]) => <Row key={p} icon={i} tone="plain" title={t} onClick={() => go('page', { page: p })} trailing={trail && <small className="dim">{trail}</small>} />)}</div>
        <button className="btn glass-btn danger" onClick={signOut}>Sign out</button>
      </Scroll>
    </>
  );
}

const Toggle = ({ on, set, label, sub }) => (
  <button className="toggle glass" role="switch" aria-checked={on} onClick={() => set(!on)}><span className="row-t"><strong>{label}</strong>{sub && <small>{sub}</small>}</span><i className={on ? 'on' : ''} /></button>
);
const VOICES = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-NG', 'English (Nigeria)'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['pt-BR', 'Portuguese'], ['ar-SA', 'Arabic'], ['hi-IN', 'Hindi']];

export function SettingsPage({ page }) {
  const { user, setUser, settings, setSettings, notify } = useApp();
  const [name, setName] = useState(user.name);
  const [key, setKey] = useState(settings.apiKey); const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(settings.model); const [imageModel, setImageModel] = useState(settings.imageModel);
  const [st, setSt] = useState(null);
  const [pvKey, setPvKey] = useState(settings.picovoiceKey || '');
  const refresh = () => phoneStatus().then(setSt).catch(() => {});
  useEffect(() => { if (page !== 'phone') return; refresh(); const t = setInterval(refresh, 1500); return () => clearInterval(t); }, [page]); // eslint-disable-line
  const title = ITEMS.find(i => i[2] === page)?.[1] || 'Settings';

  const info = {
    appearance: ['JARVIS uses its dark glass look everywhere. A light theme is not available yet.'],
    notifications: ['Notification controls are not available yet. JARVIS only speaks or shows messages when you talk to it.'],
    privacy: ['Your account, chats and history are stored on this phone only. No AI key is stored on this phone.', 'What you type or say to JARVIS is sent to the JARVIS server and on to the AI model so it can answer. Weather, news and Wikipedia lookups contact those public services directly. Phone actions such as calls and texts always ask you to confirm first. The wake word listens on this phone and sends nothing until it hears its name.'],
    about: ['JARVIS 1.0', 'Your AI. Always with you.'],
  }[page];

  const perms = [['mic', 'Microphone', 'Hear your voice'], ['contacts', 'Contacts', 'Find who to call or text'], ['phone', 'Calls', 'Place calls for you'], ['sms', 'Messages', 'Read and send texts'], ['location', 'Location', 'Weather where you are'], ['notifications', 'Notifications', 'Wake word status and tap-to-talk'], ['accessibility', 'Accessibility', 'Screenshots, Home, Back, Recents']];
  return (
    <>
      <Header title={title} />
      <Scroll>
        {info && <div className="glass thick pad prose">{info.map((t, i) => <p key={i}>{t}</p>)}</div>}

        {page === 'acct' && <>
          <label className="field glass"><Icon n="user" size={19} /><input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></label>
          <label className="field glass"><Icon n="mail" size={19} /><input value={user.email} readOnly /></label>
          <button className="btn" disabled={!name.trim()} onClick={() => { updateAccount(user.email, name.trim()); setUser({ ...user, name: name.trim() }); notify('Saved.'); }}>Save changes</button></>}

        {page === 'ai' && <>
          {accessMode(settings) === 'direct' && <>
            <p className="notice glass">Developer build: the AI key is stored on this phone. Release builds connect to the JARVIS server instead.</p>
            <label className="field glass"><Icon n="key" size={19} /><input type={showKey ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)} placeholder="OpenRouter key (sk-or-...)" autoCapitalize="off" spellCheck="false" />
              <button className="icon-plain" onClick={() => setShowKey(!showKey)} aria-label="Show key"><Icon n={showKey ? 'eye' : 'eyeoff'} size={19} /></button></label></>}
          {accessMode(settings) === 'backend' && <>
            <p className="muted lead-s">{hasToken() ? 'Connected to the JARVIS server. No AI key is stored on this phone.' : 'Not connected yet. Ask JARVIS anything and you will be asked for your access code.'}</p>
            {hasToken() && <button className="btn glass-btn" onClick={() => { clearToken(); notify('Access removed from this phone.'); setSettings({ ...settings }); }}>Remove access from this phone</button>}</>}
          {accessMode(settings) === 'none' && <p className="notice glass">This app build is not connected to a JARVIS server. Rebuild it with VITE_API set.</p>}
          <h3 className="label">Chat model</h3><label className="field glass"><input value={model} onChange={e => setModel(e.target.value)} autoCapitalize="off" spellCheck="false" /></label>
          <h3 className="label">Image model</h3><label className="field glass"><input value={imageModel} onChange={e => setImageModel(e.target.value)} autoCapitalize="off" spellCheck="false" /></label>
          <button className="btn" onClick={() => { setSettings({ ...settings, ...(accessMode(settings) === 'direct' ? { apiKey: key.trim() } : {}), model: model.trim(), imageModel: imageModel.trim() }); notify('Saved.'); }}>Save</button></>}

        {page === 'voice' && <>
          <Toggle on={settings.speakReplies} set={v => setSettings({ ...settings, speakReplies: v })} label="Speak replies aloud" sub="Voice requests are always answered out loud" />
          <h3 className="label">Language</h3>
          <label className="select glass"><select value={settings.lang} onChange={e => setSettings({ ...settings, lang: e.target.value })}>{VOICES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select><Icon n="chevdown" size={18} /></label>
          <button className="btn glass-btn" onClick={() => speak(`Hi ${user.name.split(' ')[0]}, this is how I sound.`)}><Icon n="volume" size={18} />Test voice</button>
          <h3 className="label">Wake word</h3>
          {!isNative() && <p className="notice glass">The wake word works in the Android app.</p>}
          <Toggle on={!!settings.wakeWord} set={v => setSettings({ ...settings, wakeWord: v })} label={'Say "Hey JARVIS" to wake'} sub="Listens in the background with a small notification. Uses some battery." />
          <label className="field glass"><Icon n="key" size={19} /><input type="password" value={pvKey} onChange={e => setPvKey(e.target.value)} placeholder="Picovoice AccessKey" autoCapitalize="off" spellCheck="false" /></label>
          <button className="btn glass-btn" onClick={() => { setSettings({ ...settings, picovoiceKey: pvKey.trim() }); notify('Saved.'); }}>Save AccessKey</button>
          <p className="muted small-note">The wake word engine is Picovoice Porcupine. Get a free AccessKey at console.picovoice.ai. It listens for "Jarvis" (saying "Hey Jarvis" works). Turn on Notifications and Microphone in Phone Control first.</p></>}

        {page === 'phone' && <>
          {!isNative() && <p className="notice glass">Phone control works in the Android app. In a browser you can still chat and use the tools.</p>}
          <p className="muted lead-s">Allow what JARVIS needs to act like the owner of your phone.</p>
          <div className="glass thick results">{perms.map(([k, t, s]) => (
            <div key={k} className="perm"><span className="row-t"><strong>{t}</strong><small>{s}</small></span><b className={st?.[k] ? 'ok' : 'off'}>{st?.[k] ? 'On' : 'Off'}</b></div>))}</div>
          <button className="btn" disabled={!isNative()} onClick={() => requestPermissions().then(setSt).catch(e => notify(e.message))}>Allow permissions</button>
          <button className="btn glass-btn" disabled={!isNative()} onClick={() => openAccessibility().catch(e => notify(e.message))}>Turn on Accessibility</button>
          <p className="muted small-note">In Accessibility, open Installed apps, choose Jarvis and switch it on. Try saying: "Set an alarm for 7 AM", "Take a screenshot", "Open YouTube", "Read my messages", "Text Mom I'm on my way".</p></>}
      </Scroll>
    </>
  );
}
