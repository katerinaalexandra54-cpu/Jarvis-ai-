import { useCallback, useEffect, useRef, useState } from 'react';
import { accessMode, getProvider, NoKeyError } from './lib/providers/index.js';
import { listen, speak, stopSpeaking, stopListening, wake, isNative } from './lib/phone.js';
import { runAgent } from './lib/brain/agent.js';
import { buildSystemPrompt } from './lib/brain/systemPrompt.js';
import { TOOL_SCHEMAS, executeTool, stateFromResult } from './lib/brain/tools.js';
import { trimHistory } from './lib/brain/memory.js';
import { androidDeps } from './lib/brain/androidDeps.js';
import { load, save, uid } from './lib/store.js';

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|send( it)?|do it|confirm|go ahead|call( them)?|please do)\b/i;
const NO = /^(no|nope|cancel|stop|don'?t|never mind|nevermind)\b/i;

const hello = name => ({ id: 'hello', from: 'jarvis', ts: Date.now(), text: `Hello ${name || 'there'}! I'm JARVIS. How can I help you today?` });

export function useAssistant({ settings, setSettings, user, askKey, upsertHistory, notify }) {
  const [messages, setMessages] = useState(() => { const m = load('chat', []); return m.length ? m : [hello(user?.name)]; });
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const listeningRef = useRef(false);
  const [partial, setPartial] = useState('');
  const [pending, setPendingState] = useState(null);
  const pendingRef = useRef(null);
  const lastSms = useRef(load('lastSms', ''));
  const chatId = useRef(load('chatId', null) || uid());
  const busyRef = useRef(false);
  const convo = useRef(load('convo', []));          // short-term memory: recent turns incl. tool calls/results
  const deviceState = useRef(load('deviceState', {})); // last-known phone state
  const turn = useRef({ speakIt: false, viaVoice: false });
  const queued = useRef(null);
  const sendRef = useRef(null);
  const voiceRef = useRef(null);

  const setPending = p => { pendingRef.current = p; setPendingState(p); };
  useEffect(() => { save('chat', messages.slice(-60)); save('chatId', chatId.current); }, [messages]);

  const push = useCallback(m => setMessages(ms => [...ms, { id: uid(), ts: Date.now(), ...m }]), []);
  const reply = useCallback((text, speakIt) => { push({ from: 'jarvis', text }); if (speakIt) speak(text); }, [push]);

  // Called by the call/text tools. Resolves true/false when the user answers yes/no (or taps a button).
  const confirmAction = useCallback(({ kind, label, body }) => new Promise(resolve => {
    const ask = kind === 'call' ? `Call ${label}?` : `Send to ${label}: "${body}". Should I send it?`;
    const item = { action: { type: kind === 'call' ? 'call' : 'sendSms' }, label, resolve };
    setPending(item);
    push({ from: 'jarvis', text: ask, confirm: true });
    if (turn.current.speakIt) speak(ask);
    if (turn.current.viaVoice) setTimeout(() => { if (pendingRef.current === item) voiceRef.current?.(); }, 2800);
    setTimeout(() => { if (pendingRef.current === item) { setPending(null); resolve(false); } }, 60000); // never hang forever
  }), [push]);

  const send = useCallback(async (raw, { viaVoice = false } = {}) => {
    const text = raw.trim();
    if (!text) return;

    // 1) The user is answering a pending call/text confirmation (works even while the brain is waiting).
    const p = pendingRef.current;
    if (p) {
      stopSpeaking();
      const yes = YES.test(text), no = NO.test(text);
      if (yes || no) { push({ from: 'user', text }); setPending(null); p.resolve(yes); return; }
      setPending(null); p.resolve(false); queued.current = { text, viaVoice }; // something else: cancel, then handle it next
      return;
    }
    if (busyRef.current) return;

    const speakIt = viaVoice || settings.speakReplies;
    turn.current = { speakIt, viaVoice };
    stopSpeaking();
    push({ from: 'user', text });
    upsertHistory({ id: chatId.current, type: 'chat', icon: 'chat', title: text.slice(0, 48), payload: { screen: 'chat' } });

    busyRef.current = true; setBusy(true);
    try {
      const deps = androidDeps({
        confirm: confirmAction, lang: settings.lang,
        onSms: msgs => { if (msgs?.length) { lastSms.current = msgs[0].name || msgs[0].address; save('lastSms', lastSms.current); } },
      });
      const out = await runAgent({
        provider: getProvider(settings), settings,
        system: buildSystemPrompt({ name: user?.name, now: new Date().toString(), lastSms: lastSms.current, deviceState: deviceState.current }),
        history: convo.current, userText: text, tools: TOOL_SCHEMAS,
        execute: (name, args) => executeTool(name, args, deps),
        onToolResult: (name, args, result) => {
          const st = stateFromResult(name, args, result);
          if (st) { deviceState.current = { ...deviceState.current, ...st }; save('deviceState', deviceState.current); }
        },
      });
      convo.current = trimHistory([...convo.current, ...out.newMessages]); save('convo', convo.current);
      reply(out.text, speakIt);
    } catch (e) {
      if (e instanceof NoKeyError) { askKey(); reply(accessMode(settings) === 'backend' ? 'I need your access code before I can think. Enter it in the box that just opened.' : 'I need your OpenRouter key before I can think. Paste it in the box that just opened.', false); }
      else reply(e.message, false);
    } finally {
      busyRef.current = false; setBusy(false);
      const q = queued.current; queued.current = null;
      if (q) setTimeout(() => sendRef.current?.(q.text, { viaVoice: q.viaVoice }), 0);
    }
  }, [settings, user, push, reply, confirmAction, askKey, upsertHistory]);
  sendRef.current = send;

  const wakeOn = isNative() && !!settings.wakeWord && !!settings.picovoiceKey;
  const wakeOnRef = useRef(wakeOn); wakeOnRef.current = wakeOn;

  // Give the microphone back to the wake word once JARVIS is completely idle (not thinking, not waiting for a
  // yes/no, not listening, not speaking). Otherwise the wake engine would hear JARVIS's own voice.
  const resumeWhenIdle = useCallback(async () => {
    if (!wakeOnRef.current) return;
    for (let i = 0; i < 180; i++) { // up to ~90 s
      await new Promise(r => setTimeout(r, 500));
      if (!wakeOnRef.current) return;
      if (busyRef.current || pendingRef.current || listeningRef.current) continue;
      if (await wake.isSpeaking()) continue;
      break;
    }
    await new Promise(r => setTimeout(r, 400));
    if (wakeOnRef.current) wake.resume();
  }, []);

  const startVoice = useCallback(async (wakeTriggered = false) => {
    const fromWake = wakeTriggered === true;
    if (listeningRef.current) { stopListening(); return; }
    if (wakeOnRef.current) await wake.pause(); // only one thing may use the mic at a time
    stopSpeaking(); listeningRef.current = true; setListening(true); setPartial('');
    try {
      const heard = await listen(setPartial, settings.lang, () => { if (fromWake) wake.ack(); });
      listeningRef.current = false; setListening(false); setPartial('');
      if (heard.trim()) await send(heard, { viaVoice: true });
    } catch (e) { listeningRef.current = false; setListening(false); setPartial(''); notify(e.message); }
    finally { resumeWhenIdle(); }
  }, [settings.lang, send, notify, resumeWhenIdle]);
  voiceRef.current = startVoice;

  // Start/stop the always-listening service with the setting (and again each time the app opens, because Android
  // does not restart a microphone service by itself after a reboot).
  useEffect(() => {
    if (!isNative()) return;
    if (wakeOn) wake.start(settings.picovoiceKey).catch(e => { notify(e.message); setSettings?.(s => ({ ...s, wakeWord: false })); });
    else wake.stop();
  }, [wakeOn, settings.picovoiceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isNative()) return undefined;
    const offs = []; let dead = false;
    const keep = p => p.then(off => { if (dead) off(); else offs.push(off); });
    const onWake = async () => {
      if (busyRef.current || listeningRef.current) { wake.ack(); return; }
      await voiceRef.current?.(true);
    };
    keep(wake.on('wake', onWake));
    keep(wake.on('wakeError', e => { notify(e?.message || 'The wake word stopped.'); setSettings?.(s => ({ ...s, wakeWord: false })); }));
    keep(wake.on('wakeStopped', () => { if (wakeOnRef.current) setSettings?.(s => ({ ...s, wakeWord: false })); }));
    keep(wake.on('speechError', e => notify(e?.message || 'Android text-to-speech is unavailable.')));
    wake.consumePending().then(p => { if (p) onWake(); });
    return () => { dead = true; offs.forEach(off => off()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = ok => send(ok ? 'yes' : 'no');
  const reset = () => {
    if (pendingRef.current) { const p = pendingRef.current; setPending(null); p.resolve(false); }
    chatId.current = uid(); convo.current = []; save('convo', []);
    setMessages([hello(user?.name)]);
  };

  return { messages, busy, listening, partial, pending, send, startVoice, confirm, reset };
}
