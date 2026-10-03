import { useRef, useState } from 'react';
import { useApp } from '../ctx.js';
import { Header, Icon, Scroll, ToolCard, TOOLS } from '../components.jsx';
import { NoKeyError, complete, fileToParts, generateImage, parseJSON } from '../lib/ai.js';
import { copyText, saveImage, shareText, speak } from '../lib/phone.js';
import { evaluate, fmt } from '../lib/calc.js';

function useSafe() {
  const { askKey, notify } = useApp();
  return async fn => { try { return await fn(); } catch (e) { if (e instanceof NoKeyError) askKey(); else notify(e.message); return undefined; } };
}
const size = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ext = n => (n.split('.').pop() || 'FILE').toUpperCase();

export const Tools = () => {
  const { go } = useApp();
  return (<><Header title="AI Tools" root /><Scroll><p className="muted lead-s">Everything JARVIS can do for you.</p>
    <div className="grid2">{TOOLS.map(t => <ToolCard key={t.id} {...t} onClick={() => go(t.screen)} />)}</div></Scroll></>);
};

/* ---------- Summarizer ---------- */
async function summarize(settings, { text, parts, length }) {
  const n = { Short: '3 key points and a 2 sentence summary', Medium: '4 to 5 key points and a short paragraph summary', Long: '6 to 8 key points and a detailed 2 to 3 paragraph summary' }[length];
  const content = [{ type: 'text', text: `Summarize the following. Return ONLY JSON: {"keyPoints":["..."],"summary":"..."} with ${n}. Plain text, no markdown.` }, ...(parts || [{ type: 'text', text }])];
  const out = await complete(settings, [{ role: 'user', content }], { max_tokens: 1200 });
  const j = parseJSON(out);
  return j ? { keyPoints: j.keyPoints || [], summary: j.summary || '' } : { keyPoints: [], summary: out };
}

export function Summarizer({ prefill = '' }) {
  const { settings, go, addHistory, notify } = useApp(); const safe = useSafe();
  const [text, setText] = useState(prefill); const [len, setLen] = useState('Medium'); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false);
  const pick = useRef();
  const run = () => safe(async () => {
    if (!file && text.trim().length < 20) return notify('Paste some text or choose a file first.');
    setBusy(true);
    try {
      const parts = file ? await fileToParts(file) : null;
      const r = await summarize(settings, { text, parts, length: len });
      const params = { fileName: file?.name, size: file ? size(file.size) : '', ...r, input: !file && text.length < 8000 ? text : null, length: len };
      addHistory({ type: 'tool', icon: 'summarizer', title: file ? `${file.name} summary` : `${text.trim().slice(0, 36)} summary`, payload: { screen: 'summary', params } });
      go('summary', params);
    } finally { setBusy(false); }
  });
  return (
    <>
      <Header title="Summarizer" />
      <Scroll>
        <p className="muted lead-s">Turn long text into key points.<br />Save time, get the essentials.</p>
        <div className="glass thick pad">
          {file ? <div className="filechip inline"><span className="ico tone-orange"><Icon n="file" size={20} /></span><span><strong>{file.name}</strong><small>{size(file.size)} · {ext(file.name)}</small></span><button className="icon-plain" onClick={() => setFile(null)} aria-label="Remove file"><Icon n="x" size={18} /></button></div>
            : <textarea rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Paste your text here..." />}
          <div className="ta-actions">
            <button onClick={async () => { try { setFile(null); setText(await navigator.clipboard.readText()); } catch { notify('Long-press the box to paste.'); } }}><Icon n="paste" size={20} />Paste</button>
            <button onClick={() => pick.current.click()}><Icon n="file" size={20} />File</button>
            <button onClick={() => { setText(''); setFile(null); }}><Icon n="trash" size={20} />Clear</button>
          </div>
          <input ref={pick} type="file" hidden accept=".pdf,.txt,.md,.csv,.json,image/*" onChange={e => { setFile(e.target.files[0] || null); e.target.value = ''; }} />
        </div>
        <h3 className="label">Summary Length</h3>
        <div className="seg">{['Short', 'Medium', 'Long'].map(l => <button key={l} className={`glass ${len === l ? 'on' : ''}`} onClick={() => setLen(l)}>{l}</button>)}</div>
        <button className="btn" disabled={busy} onClick={run}><Icon n="sparkle" size={18} />{busy ? 'Summarizing...' : 'Summarize'}</button>
      </Scroll>
    </>
  );
}

export function Summary(p) {
  const { settings, notify, back } = useApp(); const safe = useSafe();
  const [r, setR] = useState({ keyPoints: p.keyPoints, summary: p.summary }); const [busy, setBusy] = useState(false);
  const all = `Key points:\n${r.keyPoints.map(k => `- ${k}`).join('\n')}\n\n${r.summary}`;
  const regen = () => { if (!p.input) { notify('Choose the file again to regenerate.'); return back(); } setBusy(true); safe(async () => setR(await summarize(settings, { text: p.input, length: p.length }))).finally(() => setBusy(false)); };
  return (
    <>
      <Header title="Summary" />
      <Scroll className={busy ? 'dim-busy' : ''}>
        {p.fileName && <div className="filechip glass"><span className="ico tone-orange"><Icon n="file" size={20} /></span><span><strong>{p.fileName}</strong><small>{p.size} · {ext(p.fileName)}</small></span></div>}
        {r.keyPoints.length > 0 && <><h3 className="label">Key Points</h3><ul className="points">{r.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul></>}
        <h3 className="label">Full Summary</h3>
        <div className="glass thick pad prose">{r.summary}</div>
        <div className="actions4">
          {[['copy', 'Copy', async () => notify(await copyText(all))], ['share', 'Share', async () => { const m = await shareText(all); if (m) notify(m); }], ['refresh', busy ? 'Working' : 'Regenerate', regen], ['volume', 'Listen', () => speak(r.summary)]].map(([i, l, f]) =>
            <button key={l} className="glass" onClick={f}><Icon n={i} size={21} /><span>{l}</span></button>)}
        </div>
      </Scroll>
    </>
  );
}

/* ---------- Image generator ---------- */
const STYLES = ['Realistic', 'Cinematic', 'Anime', 'Cyberpunk', 'Watercolor', '3D render', 'Minimal'];
const RATIOS = ['1:1', '16:9', '9:16', '4:3'];
const EXAMPLES = [['Nature', 'Misty mountain valley at sunrise, golden light', 'Realistic', 'ex-nature'], ['Cyberpunk', 'A futuristic city at night with flying cars, neon lights and skyscrapers', 'Cyberpunk', 'ex-cyber'], ['Anime', 'A girl with a glowing lantern in a cherry blossom forest', 'Anime', 'ex-anime'], ['Minimal', 'A single paper boat on a calm pastel lake', 'Minimal', 'ex-min']];
const imgPrompt = (prompt, style, ratio) => `Generate an image: ${prompt}. Style: ${style}. Aspect ratio ${ratio}.`;

export function ImageGen({ prompt: p0 = '', style: s0 = 'Realistic', ratio: r0 = '1:1' }) {
  const { settings, go, addHistory, notify } = useApp(); const safe = useSafe();
  const [prompt, setPrompt] = useState(p0); const [style, setStyle] = useState(s0); const [ratio, setRatio] = useState(r0); const [busy, setBusy] = useState(false);
  const run = () => safe(async () => {
    if (prompt.trim().length < 3) return notify('Describe the image you want first.');
    setBusy(true);
    try {
      const url = await generateImage(settings, imgPrompt(prompt, style, ratio));
      addHistory({ type: 'tool', icon: 'image', title: `Image: ${prompt.trim().slice(0, 36)}`, payload: { screen: 'imagegen', params: { prompt, style, ratio } } });
      go('imageresult', { url, prompt, style, ratio });
    } finally { setBusy(false); }
  });
  return (
    <>
      <Header title="Image Generator" />
      <Scroll>
        <p className="muted lead-s">Turn your imagination into reality.<br />Create stunning images with JARVIS.</p>
        <div className="glass thick pad rel"><textarea rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="A futuristic city at night with flying cars..." />
          {prompt && <button className="icon-plain corner" onClick={() => setPrompt('')} aria-label="Clear prompt"><Icon n="x" size={18} /></button>}</div>
        <h3 className="label">Style</h3>
        <label className="select glass"><select value={style} onChange={e => setStyle(e.target.value)}>{STYLES.map(s => <option key={s}>{s}</option>)}</select><Icon n="chevdown" size={18} /></label>
        <h3 className="label">Aspect Ratio</h3>
        <div className="seg four">{RATIOS.map(r => <button key={r} className={`glass ${ratio === r ? 'on' : ''}`} onClick={() => setRatio(r)}>{r}</button>)}</div>
        <button className="btn" disabled={busy} onClick={run}><Icon n="sparkle" size={18} />{busy ? 'Generating...' : 'Generate'}</button>
        {busy && <div className="shimmer glass" aria-label="Generating image" />}
        <h3 className="label">Examples</h3>
        <div className="examples">{EXAMPLES.map(([l, pr, st, c]) => <button key={l} onClick={() => { setPrompt(pr); setStyle(st); }}><i className={c} /><span>{l}</span></button>)}</div>
      </Scroll>
    </>
  );
}

export function ImageResult(p) {
  const { settings, notify } = useApp(); const safe = useSafe();
  const [url, setUrl] = useState(p.url); const [busy, setBusy] = useState(false);
  const regen = () => { setBusy(true); safe(async () => setUrl(await generateImage(settings, imgPrompt(p.prompt, p.style, p.ratio)))).finally(() => setBusy(false)); };
  const share = async () => {
    try { const b = await (await fetch(url)).blob(); const f = new File([b], 'jarvis.png', { type: b.type }); if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], text: p.prompt }); return; } } catch { /* fall through */ }
    notify(await shareText(`Made with JARVIS: ${p.prompt}`));
  };
  return (
    <>
      <Header title="Image Generator" />
      <Scroll>
        <div className={`result-img glass thick ${busy ? 'busy' : ''}`}><img src={url} alt={p.prompt} /></div>
        <div className="actions4 three">
          {[['download', 'Download', async () => notify(await saveImage(url).catch(e => e.message))], ['share', 'Share', share], ['refresh', busy ? 'Working' : 'Regenerate', regen]].map(([i, l, f]) => <button key={l} className="glass" onClick={f}><Icon n={i} size={21} /><span>{l}</span></button>)}
        </div>
        <h3 className="label">Prompt</h3><div className="glass pad prose">{p.prompt}</div>
        <div className="meta2"><div><small>Style</small><strong>{p.style}</strong></div><div><small>Aspect Ratio</small><strong>{p.ratio}</strong></div></div>
      </Scroll>
    </>
  );
}

/* ---------- Translator ---------- */
const LANGS = [['English', '🇬🇧'], ['Spanish', '🇪🇸'], ['French', '🇫🇷'], ['German', '🇩🇪'], ['Italian', '🇮🇹'], ['Portuguese', '🇵🇹'], ['Arabic', '🇸🇦'], ['Hindi', '🇮🇳'], ['Chinese', '🇨🇳'], ['Japanese', '🇯🇵'], ['Korean', '🇰🇷'], ['Russian', '🇷🇺'], ['Turkish', '🇹🇷'], ['Swahili', '🇰🇪'], ['Yoruba', '🇳🇬'], ['Igbo', '🇳🇬'], ['Hausa', '🇳🇬']];
const flag = n => LANGS.find(l => l[0] === n)?.[1];
const Pick = ({ v, set }) => <label className="lang glass"><span>{flag(v)}</span><select value={v} onChange={e => set(e.target.value)} aria-label="Language">{LANGS.map(l => <option key={l[0]}>{l[0]}</option>)}</select><Icon n="chevdown" size={16} /></label>;

export function Translator() {
  const { settings, addHistory, notify } = useApp(); const safe = useSafe();
  const [from, setFrom] = useState('English'); const [to, setTo] = useState('Spanish'); const [text, setText] = useState(''); const [out, setOut] = useState(''); const [busy, setBusy] = useState(false);
  const run = () => safe(async () => {
    if (!text.trim()) return notify('Type something to translate.');
    setBusy(true);
    try {
      const r = await complete(settings, [{ role: 'system', content: `Translate the user's text from ${from} to ${to}. Output only the translation.` }, { role: 'user', content: text }], { max_tokens: 800 });
      setOut(r); addHistory({ type: 'tool', icon: 'translator', title: `${to} translation`, payload: { screen: 'translator' } });
    } finally { setBusy(false); }
  });
  return (
    <>
      <Header title="Translator" />
      <Scroll>
        <div className="langs"><Pick v={from} set={setFrom} /><button className="circle-btn" onClick={() => { setFrom(to); setTo(from); if (out) { setText(out); setOut(''); } }} aria-label="Swap languages"><Icon n="swap" size={20} /></button><Pick v={to} set={setTo} /></div>
        <div className="glass thick pad"><textarea rows={5} maxLength={1000} value={text} onChange={e => setText(e.target.value)} placeholder="Type or paste text..." />
          <div className="count"><small>{text.length}/1000</small><button className="icon-plain" onClick={() => speak(text)} aria-label="Read aloud"><Icon n="volume" size={19} /></button></div></div>
        <button className="btn" disabled={busy} onClick={run}><Icon n="swap" size={18} />{busy ? 'Translating...' : 'Translate'}</button>
        {out && <div className="glass thick pad result"><div className="rh"><small>{to}</small><button className="icon-plain" onClick={() => setOut('')} aria-label="Close"><Icon n="x" size={17} /></button></div><p className="prose">{out}</p>
          <div className="ra"><button className="icon-plain" onClick={async () => notify(await copyText(out))} aria-label="Copy"><Icon n="copy" size={20} /></button><button className="icon-plain" onClick={async () => { const m = await shareText(out); if (m) notify(m); }} aria-label="Share"><Icon n="share" size={20} /></button><button className="icon-plain" onClick={() => speak(out)} aria-label="Listen"><Icon n="volume" size={20} /></button></div></div>}
      </Scroll>
    </>
  );
}

/* ---------- Calculator ---------- */
const KEYS = ['C', '()', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
const OPS = '+−×÷';
export function Calculator() {
  const { addHistory, notify } = useApp();
  const [expr, setExpr] = useState(''); const [fresh, setFresh] = useState(false); const [last, setLast] = useState('');
  let live = ''; try { if (expr && /[+−×÷%()]/.test(expr.slice(1))) live = fmt(evaluate(expr)); } catch { /* incomplete expression */ }
  const press = k => {
    if (k === 'C') { setExpr(''); setLast(''); setFresh(false); return; }
    if (k === '=') {
      try { const r = evaluate(expr); const shown = fmt(r); setLast(expr); setExpr(String(+r.toPrecision(12))); setFresh(true); addHistory({ type: 'tool', icon: 'calculator', title: `${expr} = ${shown}`, payload: { screen: 'calculator' } }); } catch { notify('Check the expression.'); }
      return;
    }
    let e = fresh && !OPS.includes(k) && k !== '%' ? '' : expr; setFresh(false);
    if (OPS.includes(k)) { if (!e && k !== '−') return; e = OPS.includes(e.slice(-1)) ? e.slice(0, -1) + k : e + k; }
    else if (k === '()') { const o = (e.match(/\(/g) || []).length - (e.match(/\)/g) || []).length; e += o > 0 && /[\d)%]/.test(e.slice(-1)) ? ')' : '('; }
    else if (k === '.') { if (/\.\d*$/.test(e)) return; e += /\d$/.test(e) ? '.' : '0.'; }
    else e += k;
    setExpr(e);
  };
  const pretty = s => s.replace(/([+−×÷])/g, ' $1 ');
  return (
    <>
      <Header title="Calculator" />
      <Scroll>
        <div className="calc-display glass thick"><small>{fresh ? pretty(last) : live ? pretty(expr) : '\u00a0'}</small><output>{fresh ? fmt(Number(expr)) : live || pretty(expr) || '0'}</output></div>
        <div className="keys">{KEYS.map(k => <button key={k} className={`glass k ${OPS.includes(k) || k === '%' ? 'op' : ''} ${k === '=' ? 'eq' : ''} ${k === '0' ? 'zero' : ''} ${k === 'C' ? 'clr' : ''}`} onClick={() => press(k)} aria-label={k}>{k === '()' ? '( )' : k}</button>)}</div>
      </Scroll>
    </>
  );
}

/* ---------- Document analysis ---------- */
export function DocAnalysis() {
  const { settings, addHistory, notify } = useApp(); const safe = useSafe();
  const [file, setFile] = useState(null); const [res, setRes] = useState(null); const [open, setOpen] = useState({}); const [busy, setBusy] = useState(false);
  const pick = useRef();
  const run = () => safe(async () => {
    if (!file) return notify('Choose a document first.');
    setBusy(true);
    try {
      const parts = await fileToParts(file);
      const out = await complete(settings, [{ role: 'user', content: [{ type: 'text', text: 'Analyze this document. Return ONLY JSON: {"insights":["3 to 6 key insights"],"actions":["action items, can be empty"],"summary":"a brief overview paragraph"}. Plain text, no markdown.' }, ...parts] }], { max_tokens: 1400 });
      const j = parseJSON(out) || { insights: [], actions: [], summary: out };
      setRes({ insights: j.insights || [], actions: j.actions || [], summary: j.summary || '' }); setOpen({});
      addHistory({ type: 'file', icon: 'file', title: file.name, payload: { screen: 'docanalysis' } });
    } finally { setBusy(false); }
  });
  const rows = res && [['insights', 'bulb', 'Key Insights', `${res.insights.length} main points`, res.insights], ['actions', 'checklist', 'Action Items', `${res.actions.length} tasks identified`, res.actions], ['summary', 'summarizer', 'Summary', 'Brief overview', [res.summary]]];
  return (
    <>
      <Header title="Document Analysis" />
      <Scroll>
        {file ? <div className="filechip glass"><span className="ico tone-orange"><Icon n="file" size={20} /></span><span><strong>{file.name}</strong><small>{size(file.size)} · {ext(file.name)}</small></span><button className="icon-plain" onClick={() => { setFile(null); setRes(null); }} aria-label="Remove file"><Icon n="x" size={18} /></button></div>
          : <button className="drop glass thick" onClick={() => pick.current.click()}><Icon n="file" size={30} /><strong>Choose a document</strong><small>PDF, image or text file</small></button>}
        <input ref={pick} type="file" hidden accept=".pdf,.txt,.md,.csv,.json,image/*" onChange={e => { setFile(e.target.files[0] || null); setRes(null); e.target.value = ''; }} />
        {!res && <button className="btn" disabled={busy || !file} onClick={run}><Icon n="sparkle" size={18} />{busy ? 'Analyzing...' : 'Analyze'}</button>}
        {rows && <>
          <h3 className="label">Analysis Results</h3>
          <div className="glass thick results">{rows.map(([id, ic, t, sub, items]) => (
            <div key={id} className="res-row"><button onClick={() => setOpen({ ...open, [id]: !open[id] })}><span className="ico tone-blue"><Icon n={ic} size={19} /></span><span className="row-t"><strong>{t}</strong><small>{sub}</small></span><Icon n="chevdown" size={18} className={`dim ${open[id] ? 'flip' : ''}`} /></button>
              {open[id] && <ul className="points">{items.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}{!items.filter(Boolean).length && <li>Nothing found.</li>}</ul>}</div>))}</div>
          <button className="btn" onClick={() => setOpen({ insights: true, actions: true, summary: true })}>View Full Analysis</button>
        </>}
      </Scroll>
    </>
  );
}
