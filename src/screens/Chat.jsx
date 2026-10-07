import { useState } from 'react';
import { useApp } from '../ctx.js';
import { Header, Icon, Scroll, Wave, useAutoScroll } from '../components.jsx';
import { clock } from '../lib/store.js';

const CHIPS = [
  ['file', 'Summarize this document', 'summarizer'], ['image', 'Generate an image', 'imagegen'], ['translator', 'Translate this text', 'translator'],
  ['calculator', 'Calculate something', 'calculator'], ['mail', 'Help me write an email', null],
];

export default function Chat() {
  const { assistant: a, go, user } = useApp();
  const [text, setText] = useState('');
  const end = useAutoScroll(a.messages.length + (a.busy ? 1 : 0) + a.partial);
  const submit = e => { e.preventDefault(); a.send(text); setText(''); };
  return (
    <>
      <Header />
      <Scroll className="chat">
        {a.messages.map(m => (
          <div key={m.id} className={`msg ${m.from}`}>
            <div className={`bubble ${m.small ? 'small' : ''}`}>{m.text}</div>
            {!m.small && <time>{clock(m.ts)}</time>}
            {m.confirm && a.pending && m === a.messages[a.messages.length - 1] && (
              <div className="confirm"><button className="btn sm" onClick={() => a.confirm(true)}>{a.pending.action.type === 'call' ? 'Call' : a.pending.action.type === 'message' ? 'Prepare' : 'Send'}</button><button className="btn sm glass-btn" onClick={() => a.confirm(false)}>Cancel</button></div>
            )}
          </div>
        ))}
        {a.messages.length <= 1 && (
          <div className="chips">{CHIPS.map(([i, l, s]) => (
            <button key={l} className="chip glass" onClick={() => (s ? go(s) : a.send(`Help me write an email. Ask me who it is for and what it should say.`))}><Icon n={i} size={18} />{l}</button>
          ))}</div>
        )}
        {a.busy && <div className="msg jarvis"><div className="bubble typing"><i /><i /><i /></div></div>}
        {a.listening && a.partial && <div className="msg user"><div className="bubble ghost">{a.partial}</div></div>}
        <div ref={end} className="end" />
      </Scroll>
      <div className="dock">
        <form className="composer glass thick" onSubmit={submit}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Type a message..." aria-label="Message" enterKeyHint="send" />
          <button className="send" aria-label="Send" disabled={!text.trim() || a.busy}><Icon n="send" size={18} /></button>
        </form>
        <div className="voicebar">
          <Wave active={a.listening} /><button className={`mic-orb ${a.listening ? 'live' : ''}`} onClick={a.startVoice} aria-label={a.listening ? 'Stop listening' : 'Talk to JARVIS'}>
            <img src="/assets/jarvis-mark.jpg" alt="" draggable="false" /><Icon n="mic" size={24} /></button><Wave active={a.listening} />
        </div>
        <p className="hint">{a.listening ? `Listening, ${user.name.split(' ')[0]}...` : 'Tap the orb and say what you need'}</p>
      </div>
    </>
  );
}
