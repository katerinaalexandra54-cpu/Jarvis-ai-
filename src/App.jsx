import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Ctx } from './ctx.js';
import { Icon, KeySheet, Logo } from './components.jsx';
import { Splash, Onboarding, Auth } from './screens/Intro.jsx';
import Home from './screens/Home.jsx';
import Chat from './screens/Chat.jsx';
import { Tools, Summarizer, Summary, ImageGen, ImageResult, Translator, Calculator, DocAnalysis } from './screens/Tools.jsx';
import { History, Settings, SettingsPage } from './screens/Account.jsx';
import { useAssistant } from './assistant.js';
import { DEFAULTS, currentUser, load, loadSettings, save, signOut, uid } from './lib/store.js';

const SCREENS = {
  home: Home, chat: Chat, tools: Tools, history: History, settings: Settings, summarizer: Summarizer, summary: Summary, imagegen: ImageGen,
  imageresult: ImageResult, translator: Translator, calculator: Calculator, docanalysis: DocAnalysis, page: SettingsPage,
};
const TAB_OF = { home: 'home', chat: 'chat', history: 'history', settings: 'settings', page: 'settings' };
const TABS = [['home', 'Home', 'home'], ['chat', 'Chat', 'chat'], ['tools', 'Tools', 'tools'], ['history', 'History', 'history'], ['settings', 'Settings', 'settings']];

export default function App() {
  const [user, setUser] = useState(currentUser);
  const [phase, setPhase] = useState('splash');
  const [authMode, setAuthMode] = useState('signup');
  useEffect(() => { const t = setTimeout(() => setPhase(user ? 'app' : load('seenIntro', false) ? 'auth' : 'onb'), 1700); return () => clearTimeout(t); }, []); // eslint-disable-line

  const login = u => { setUser(u); setPhase('app'); save('seenIntro', true); };
  if (phase === 'splash') return <Shell><Splash /></Shell>;
  if (phase === 'onb') return <Shell><Onboarding onDone={m => { save('seenIntro', true); setAuthMode(m); setPhase('auth'); }} /></Shell>;
  if (phase === 'auth' || !user) return <Shell><Auth mode={authMode} onUser={login} /></Shell>;
  return <Shell><Main user={user} setUser={setUser} onSignOut={() => { signOut(); setUser(null); setAuthMode('signin'); setPhase('auth'); }} /></Shell>;
}

const Shell = ({ children }) => <div className="app"><div className="bg" aria-hidden="true"><i /><i /><i /></div>{children}</div>;

function Main({ user, setUser, onSignOut }) {
  const [stack, setStack] = useState([{ name: 'home' }]);
  const [settings, setSettingsState] = useState(loadSettings);
  const [history, setHistory] = useState(() => load('history', []));
  const [keyOpen, setKeyOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const setSettings = f => setSettingsState(prev => { const next = typeof f === 'function' ? f(prev) : f; save('settings', next); return next; });
  const notify = useCallback(m => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 2600); }, []);
  const upsertHistory = useCallback(item => setHistory(h => { const n = [{ ts: Date.now(), ...item }, ...h.filter(x => x.id !== item.id)].slice(0, 40); save('history', n); return n; }), []);
  const addHistory = useCallback(item => upsertHistory({ id: uid(), ...item }), [upsertHistory]);
  const clearHistory = () => { setHistory([]); save('history', []); };
  const askKey = useCallback(() => setKeyOpen(true), []);

  const assistant = useAssistant({ settings, setSettings, user, askKey, upsertHistory, notify });

  const go = (name, params) => { setDrawer(false); setStack(s => [...s, { name, params }]); };
  const back = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s));
  const tab = name => { setDrawer(false); setStack([{ name }]); };

  const stackRef = useRef(stack); stackRef.current = stack;
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      const s = stackRef.current;
      if (s.length > 1) setStack(s.slice(0, -1)); else if (s[0].name !== 'home') setStack([{ name: 'home' }]); else CapApp.exitApp();
    });
    return () => { sub.then(h => h.remove()).catch(() => {}); };
  }, []);

  const top = stack[stack.length - 1];
  const Screen = SCREENS[top.name] || Home;
  const active = TAB_OF[top.name] || 'tools';

  const ctx = useMemo(() => ({
    user, setUser, settings, setSettings, history, addHistory, clearHistory, assistant, go, back, tab, stack, notify, askKey, keyOpen, setKeyOpen,
    openDrawer: () => setDrawer(true), signOut: onSignOut,
  }), [user, settings, history, assistant, stack, keyOpen]); // eslint-disable-line

  return (
    <Ctx.Provider value={ctx}>
      <div className="screen" key={stack.length + top.name}><Screen {...(top.params || {})} /></div>
      <nav className="nav glass thick" aria-label="Main">
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={active === id ? 'on' : ''} onClick={() => tab(id)} aria-current={active === id}><Icon n={icon} size={22} /><span>{label}</span></button>
        ))}
      </nav>
      {drawer && (
        <div className="scrim left" onClick={() => setDrawer(false)}>
          <aside className="drawer glass thick" onClick={e => e.stopPropagation()}>
            <Logo size={34} />
            <p className="muted">{user.name}<br />{user.email}</p>
            {TABS.map(([id, label, icon]) => <button key={id} onClick={() => tab(id)}><Icon n={icon} size={20} />{label}</button>)}
            <button onClick={() => { assistant.reset(); tab('chat'); }}><Icon n="plus" size={20} />New chat</button>
            <button onClick={onSignOut}><Icon n="lock" size={20} />Sign out</button>
          </aside>
        </div>
      )}
      <KeySheet />
      {toast && <div className="toast glass" role="status">{toast}</div>}
    </Ctx.Provider>
  );
}
