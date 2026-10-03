import { useState } from 'react';
import { useApp } from '../ctx.js';
import { Header, Icon, Row, Scroll, ToolCard, TOOLS } from '../components.jsx';
import { ago, greeting } from '../lib/store.js';

export default function Home() {
  const { user, go, history, assistant, tab } = useApp();
  const [q, setQ] = useState('');
  const ask = e => { e.preventDefault(); if (!q.trim()) return; assistant.send(q); setQ(''); tab('chat'); };
  const voice = () => { tab('chat'); setTimeout(assistant.startVoice, 250); };
  const quick = TOOLS.filter(t => ['summarizer', 'translator', 'imagegen', 'chat'].includes(t.id)).sort((a, b) => ['summarizer', 'translator', 'imagegen', 'chat'].indexOf(a.id) - ['summarizer', 'translator', 'imagegen', 'chat'].indexOf(b.id));
  const recent = history.slice(0, 3);
  return (
    <>
      <Header />
      <Scroll>
        <section className="greet"><p>{greeting()},</p><h2>{user.name.split(' ')[0]} <span className="wave-hand">👋</span></h2><p className="muted">Ready to make today more productive?</p></section>
        <form className="askbar glass thick" onSubmit={ask}>
          <Icon n="sparkle" size={20} className="dim" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ask JARVIS anything..." aria-label="Ask JARVIS" />
          <button type="button" className="icon-plain" onClick={voice} aria-label="Speak to JARVIS"><Icon n="mic" size={22} /></button>
        </form>
        <div className="quick4">
          {[['mic', 'Voice', voice], ['image', 'Image', () => go('imagegen')], ['file', 'File', () => go('docanalysis')], ['more', 'More', () => tab('tools')]].map(([i, l, f]) => (
            <button key={l} className="glass" onClick={f}><Icon n={i} size={22} /><span>{l}</span></button>
          ))}
        </div>
        <div className="sec"><h3>Quick Tools</h3><button className="link inline" onClick={() => tab('tools')}>View all</button></div>
        <div className="grid2">{quick.map(t => <ToolCard key={t.id} {...t} onClick={() => go(t.screen)} />)}</div>
        <div className="sec"><h3>Recent Activity</h3><button className="link inline" onClick={() => tab('history')}>View all</button></div>
        {recent.length ? recent.map(h => <Row key={h.id} icon={h.icon || 'file'} title={h.title} sub={ago(h.ts)} onClick={() => go(h.payload.screen, h.payload.params)} />)
          : <p className="empty glass">Nothing here yet. Ask JARVIS something or open a tool.</p>}
      </Scroll>
    </>
  );
}
