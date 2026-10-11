import { useEffect, useState } from 'react';
import { useApp } from '../ctx.js';
import { Header, Icon, Row, Scroll } from '../components.jsx';
import { ago, updateAccount } from '../lib/store.js';
import { isNative, openAccessibility, overlay, phoneStatus, requestPermissions, speak } from '../lib/phone.js';
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
  ['settings', 'Appearance', 'appearance', 'Dark Mode'], ['bell', 'Notifications', 'notifications'], ['shield', 'Privacy & Security', 'privacy'], ['info', 'About Developer', 'about'],
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
const DEVELOPER_CONTACTS = {
  whatsapp: '+2347059937096',
  phone: '+2347059937096',
  sms: '+2347059937096',
  email: 'okikioladoye150@gmail.com',
};
const contactDeveloper = method => {
  const value = DEVELOPER_CONTACTS[method];
  const target = method === 'whatsapp' ? `https://wa.me/${value.replace(/\D/g, '')}`
    : method === 'email' ? `mailto:${value}`
      : method === 'sms' ? `sms:${value}` : `tel:${value}`;
  import("../lib/phone.js").then(m => m.runAction({ type: "openUrl", url: target })).catch(() => window.open(target, "_blank"));
};

export function SettingsPage({ page }) {
  const { user, setUser, settings, setSettings, notify } = useApp();
  const [name, setName] = useState(user.name);
  const [key, setKey] = useState(settings.apiKey); const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(settings.model); const [imageModel, setImageModel] = useState(settings.imageModel);
  const [st, setSt] = useState(null);
  const refresh = () => phoneStatus().then(setSt).catch(() => {});
  useEffect(() => { if (page !== 'phone') return; refresh(); const t = setInterval(refresh, 1500); return () => clearInterval(t); }, [page]); // eslint-disable-line
  const title = ITEMS.find(i => i[2] === page)?.[1] || 'Settings';

  const info = {
    appearance: ['JARVIS uses its dark glass look everywhere. A light theme is not available yet.'],
    notifications: ['Notification controls are not available yet. JARVIS only speaks or shows messages when you talk to it.'],
    privacy: ['Your account, chats and history are stored on this phone only. No AI key is stored on this phone.', 'What you type or say to JARVIS is sent to the JARVIS server and on to the AI model so it can answer. Weather, news and Wikipedia lookups contact those public services directly. Phone actions such as calls and texts always ask you to confirm first. The wake word listens on this phone and sends nothing until it hears its name.'],
    about: null,
  }[page];

  const perms = [['mic', 'Microphone', 'Hear your voice'], ['contacts', 'Contacts', 'Find who to call or text'], ['phone', 'Calls', 'Place calls for you'], ['sms', 'Messages', 'Read and send texts'], ['location', 'Location', 'Weather where you are'], ['notifications', 'Notifications', 'Wake word status and tap-to-talk'], ['accessibility', 'Accessibility', 'Screenshots, Home, Back, Recents']];
  return (
    <>
      <Header title={title} />
      <Scroll>
        {info && <div className="glass thick pad prose">{info.map((t, i) => <p key={i}>{t}</p>)}</div>}

        {page === 'about' && <div className="about-profile">
          <div className="glass thick pad profile-hero">
            <p className="eyebrow">ABOUT DEVELOPER</p>
            <h1>Okiki Oladoye</h1>
            <p className="lead-s">Founder &amp; Developer of JARVIS</p>
            <p>JARVIS is an evolving intelligent assistant shaped by curiosity, disciplined engineering, and a commitment to useful technology.</p>
          </div>
          <div className="glass pad prose">
            <h3>Developer introduction</h3>
            <p>Okiki Oladoye is the person behind JARVIS, an evolving Android AI assistant created from an interest in technology, software development, artificial intelligence, and useful digital tools. JARVIS is a practical project through which he explores how thoughtful software can make everyday interactions with technology easier.</p>
            <h3>Personal background</h3>
            <p><strong>Born in 2008</strong> in Ijebu Ode, Nigeria. State of origin: Osun State, Nigeria. These details describe two different parts of Okiki’s background and are intentionally kept distinct.</p>
            <h3>Education</h3>
            <p>Okiki studies <strong>Criminology and Security Studies</strong> at the <strong>National Open University of Nigeria (NOUN)</strong>, Victoria Island Study Centre. His academic course is not presented as a computer-science qualification. Instead, it contributes to his interest in responsible technology, privacy, safety, security, and the effects that digital systems can have on people.</p>
            <h3>About NOUN</h3>
            <p>The National Open University of Nigeria is an open and distance-learning institution. Its model supports students who study through flexible learning arrangements, including the study-centre structure used by Okiki.</p>
            <h3>Interest in technology</h3>
            <p>Through the JARVIS project, Okiki is learning about AI assistants, Android applications, voice recognition, automation, phone integration, and practical software development. The project is an active learning effort: features are developed, tested, corrected, and documented rather than presented as complete before they have been verified.</p>
            <h3>Developing intelligence and skills</h3>
            <p>Okiki describes himself as having developing intelligence. In professional terms, this means a commitment to continuous learning, problem-solving, curiosity, creativity, and improving his technical abilities. It is a personal development goal, not a scientifically verified intelligence claim or a formal qualification. He aims to learn from feedback, handle uncertainty honestly, and build better understanding through practice.</p>
            <h3>Why I am building JARVIS</h3>
            <p>JARVIS is intended to be a helpful Android AI assistant that can respond to voice commands, assist with supported phone tasks, provide conversational assistance, and make everyday interactions with technology more convenient. Some capabilities remain subject to device permissions, app compatibility, backend availability, and real-device testing.</p>
            <h3>My vision</h3>
            <p>Okiki’s vision is to keep learning, improve JARVIS, explore new ideas, and develop useful technology that solves practical problems. These are forward-looking goals and aspirations, not claims that every planned capability or outcome has already been achieved.</p>
            <h3>A message to users</h3>
            <p>Thank you for taking an interest in JARVIS. This project represents a continuing interest in learning, innovation, and responsible experimentation. Okiki is committed to improving the project step by step and to making its behavior more useful, clear, and dependable over time.</p>
          </div>
          <div className="contact-actions">
            <button className="btn glass-btn" onClick={() => contactDeveloper('whatsapp')}>WhatsApp</button>
            <button className="btn glass-btn" onClick={() => contactDeveloper('phone')}>Call Developer</button>
            <button className="btn glass-btn" onClick={() => contactDeveloper('sms')}>Send SMS</button>
            <button className="btn glass-btn" onClick={() => contactDeveloper('email')}>Email Developer</button>
          </div>
          <p className="muted small-note">Contact options use the details provided by the developer. Your phone may ask which app should handle the selected action.</p>
        </div>}

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
          <Toggle on={!!settings.offlineRecognition} set={v => setSettings({ ...settings, offlineRecognition: v })} label="Use offline speech recognition" sub="Vosk processes commands on this phone; AI replies still use the protected backend" />
          <p className="muted small-note">The bundled Vosk model is compact US English (about 68 MB installed). Offline recognition is opt-in and still needs physical-device testing.</p>
          <h3 className="label">Wake word</h3>
          {!isNative() && <p className="notice glass">The wake word works in the Android app.</p>}
          <Toggle on={!!settings.wakeWord} set={v => setSettings({ ...settings, wakeWord: v })} label={'Say "Hey JARVIS" to wake'} sub="Uses sherpa-onnx on-device with a visible foreground-service notification." />
          <p className="muted small-note">Sherpa-onnx uses the bundled English KWS model and a conservative Hey JARVIS threshold. It is fully offline; accuracy, false triggers, battery use, and screen-off behavior require physical-device testing. Turn on Notifications and Microphone in Phone Control first.</p></>}

        {page === 'phone' && <>
          {!isNative() && <p className="notice glass">Phone control works in the Android app. In a browser you can still chat and use the tools.</p>}
          <p className="muted lead-s">Allow only the phone capabilities you want JARVIS to use. Accessibility is optional and must be enabled by you in Android Settings.</p>
          <div className="glass thick results">{perms.map(([k, t, s]) => (
            <div key={k} className="perm"><span className="row-t"><strong>{t}</strong><small>{s}</small></span><b className={st?.[k] ? 'ok' : 'off'}>{st?.[k] ? 'On' : 'Off'}</b></div>))}</div>
          <button className="btn" disabled={!isNative()} onClick={() => requestPermissions().then(setSt).catch(e => notify(e.message))}>Allow permissions</button>
          <button className="btn glass-btn" disabled={!isNative()} onClick={() => overlay.requestPermission().then(() => notify('If Android Settings opened, allow Display over other apps for JARVIS, then return to the app.')).catch(e => notify(e.message))}>Allow floating JARVIS animation</button>
          <button className="btn glass-btn" disabled={!isNative()} onClick={() => openAccessibility().catch(e => notify(e.message))}>Turn on Accessibility</button>
          <p className="muted small-note">JARVIS Phone Control is used only for an explicit command such as Home, Back, reading a visible conversation, replying, scrolling, or pressing a named visible control. It does not read passwords, PINs, OTPs, or secure fields, cannot unlock the phone, and never silently monitors your screen. Messaging support is generic: it works only where the active app exposes compatible accessibility controls, not every app. Replies always require confirmation, and JARVIS reports failure unless Android verifies the visible Send action. In Accessibility, open Installed apps, choose Jarvis and switch it on.</p></>}
      </Scroll>
    </>
  );
}
