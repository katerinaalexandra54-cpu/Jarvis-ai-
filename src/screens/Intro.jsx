import { useRef, useState } from 'react';
import { Icon, Mark, Wordmark, TOOLS } from '../components.jsx';
import { signIn, signUp } from '../lib/store.js';

export function Splash() {
  return (
    <div className="intro splash">
      <div className="splash-mid">
        <Mark size={156} spin />
        <h1 className="brand">J<b>A</b>RVIS</h1>
        <p className="muted">Your AI Assistant, Always With You</p>
      </div>
      <div className="splash-foot"><span className="spinner" /><small>Initializing JARVIS...</small></div>
    </div>
  );
}

export function Onboarding({ onDone }) {
  const [i, setI] = useState(0);
  const ref = useRef(null);
  const onScroll = e => setI(Math.round(e.target.scrollLeft / e.target.clientWidth));
  const next = () => { if (i === 0) ref.current.scrollTo({ left: ref.current.clientWidth, behavior: 'smooth' }); else onDone('signup'); };
  return (
    <div className="intro onb">
      <div className="slides" ref={ref} onScroll={onScroll}>
        <section className="slide">
          <div className="hero"><img src="/assets/jarvis-mark.jpg" alt="" draggable="false" /></div>
          <h1 className="big-h">More than an AI.<br /><span className="blue">Your personal assistant.</span></h1>
          <p className="muted lead">JARVIS helps you think, create, learn and get things done, and it can run your phone when you ask. Faster, smarter, easier.</p>
        </section>
        <section className="slide">
          <h1 className="big-h top">Powerful <span className="blue">AI</span> Tools<br />at Your <span className="blue">Fingertips</span></h1>
          <p className="muted lead">Writing, translation, images, documents and more. Everything you need in one place.</p>
          <div className="grid2">
            {TOOLS.map(t => <div key={t.id} className="tool-card glass static"><span className={`ico tone-${t.tone}`}><Icon n={t.icon} size={20} /></span><strong>{t.title}</strong><small>{t.sub}</small></div>)}
          </div>
        </section>
      </div>
      <div className="onb-foot">
        <div className="dots">{[0, 1].map(d => <i key={d} className={d === i ? 'on' : ''} />)}</div>
        <button className="btn" onClick={next}>Get Started</button>
        {i === 0 && <button className="link" onClick={() => onDone('signin')}>I already have an account</button>}
      </div>
    </div>
  );
}

export function Auth({ mode: initial, onUser }) {
  const [mode, setMode] = useState(initial);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = mode === 'signup';
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { onUser(up ? await signUp(f) : await signIn(f)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="intro auth" onSubmit={submit}>
      <div className="auth-top"><Mark size={64} /><Wordmark size={22} /></div>
      <h1 className="auth-h">{up ? 'Create your account' : 'Welcome back'}</h1>
      <p className="muted center">{up ? 'Join JARVIS and start your AI journey' : 'Sign in to pick up where you left off'}</p>
      <div className="fields">
        {up && <label className="field glass"><Icon n="user" size={19} /><input placeholder="Full Name" autoComplete="name" value={f.name} onChange={set('name')} /></label>}
        <label className="field glass"><Icon n="mail" size={19} /><input type="email" placeholder="Email Address" autoComplete="email" value={f.email} onChange={set('email')} /></label>
        <label className="field glass"><Icon n="lock" size={19} /><input type={show ? 'text' : 'password'} placeholder="Password" autoComplete={up ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} />
          <button type="button" className="icon-plain" onClick={() => setShow(!show)} aria-label="Show password"><Icon n={show ? 'eye' : 'eyeoff'} size={19} /></button></label>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Please wait...' : up ? 'Create Account' : 'Sign In'}</button>
      <div className="or"><span>or</span></div>
      <button type="button" className="btn glass-btn" onClick={() => setErr('Google sign-in is not connected yet. Use email for now.')}><b className="g">G</b>Continue with Google</button>
      <button type="button" className="btn glass-btn" onClick={() => setErr('Apple sign-in is not connected yet. Use email for now.')}><Icon n="apple" size={20} />Continue with Apple</button>
      <p className="muted center swap">{up ? 'Already have an account?' : 'New to JARVIS?'} <button type="button" className="link inline" onClick={() => { setMode(up ? 'signin' : 'signup'); setErr(''); }}>{up ? 'Sign In' : 'Create account'}</button></p>
    </form>
  );
}
