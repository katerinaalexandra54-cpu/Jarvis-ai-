import { useCallback, useEffect, useRef, useState } from 'react';
import { accessMode, getProvider, NoKeyError } from './lib/providers/index.js';
import { listen, speak, stopSpeaking, stopListening, wake, isNative } from './lib/phone.js';
import { runAgent } from './lib/brain/agent.js';
import { buildSystemPrompt } from './lib/brain/systemPrompt.js';
import { TOOL_SCHEMAS, executeTool, stateFromResult } from './lib/brain/tools.js';
import { trimHistory } from './lib/brain/memory.js';
import { androidDeps } from './lib/brain/androidDeps.js';
import { parseLocalIntent } from './lib/brain/localIntent.js';
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
  const commandSeq = useRef(0);
  const queued = useRef(null);
  const sendRef = useRef(null);
  const voiceRef = useRef(null);

  const setPending = p => { pendingRef.current = p; setPendingState(p); };
  useEffect(() => { save('chat', messages.slice(-60)); save('chatId', chatId.current); }, [messages]);

  const push = useCallback(m => setMessages(ms => [...ms, { id: uid(), ts: Date.now(), ...m }]), []);
  const reply = useCallback((text, speakIt) => { push({ from: 'jarvis', text }); if (speakIt) speak(text, settings.lang); }, [push, settings.lang]);

  // Called by the call/text tools. Resolves true/false when the user answers yes/no (or taps a button).
  const confirmAction = useCallback(({ kind, label, body }) => new Promise(resolve => {
    const ask = kind === 'call' ? `Call ${label}?` : kind === 'message' ? `Prepare this message for ${label}: "${body}"? You will still tap Send in the app.` : kind === 'generic' ? `Allow JARVIS to ${label}?` : `Send to ${label}: "${body}". Should I send it?`;
    const item = { action: { type: kind === 'call' ? 'call' : kind === 'message' ? 'message' : kind === 'generic' ? 'generic' : 'sendSms' }, label, resolve };
    setPending(item);
    push({ from: 'jarvis', text: ask, confirm: true });
    if (turn.current.speakIt) speak(ask, settings.lang);
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
    const seq = ++commandSeq.current;
    const respond = (text, aloud) => { if (seq === commandSeq.current) reply(text, aloud); };
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
      const local = parseLocalIntent(text);
      if (local) {
        const result = await executeTool(local.tool, local.args, deps);
        if (!result.success) respond(result.error || 'That local action failed.', speakIt);
        else if (local.kind === 'open') respond(`Opening ${result.app || local.app}.`, speakIt);
        else if (local.kind === 'system') respond(local.response, speakIt);
        else if (local.kind === 'notification') {
          const message = result.preview ? `Latest notification from ${result.sender || result.appLabel || 'an app'}: ${result.preview}` : 'I could not find a readable notification preview.';
          respond(message, speakIt);
        }
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        respond('I’m offline right now, but I can still help with local phone commands.', speakIt);
        return;
      }
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
      respond(out.text, speakIt);
    } catch (e) {
      if (e instanceof NoKeyError) { askKey(); respond(accessMode(settings) === 'backend' ? 'I need your access code before I can think. Enter it in the box that just opened.' : 'I need your OpenRouter key before I can think. Paste it in the box that just opened.', false); }
      else respond(e.message, false);
    } finally {
      busyRef.current = false; setBusy(false);
      const q = queued.current; queued.current = null;
      if (q) setTimeout(() => sendRef.current?.(q.text, { viaVoice: q.viaVoice }), 0);
    }
  }, [settings, user, push, reply, confirmAction, askKey, upsertHistory]);
  sendRef.current = send;

  const wakeOn = isNative() && !!settings.wakeWord;
  const wakeOnRef = useRef(wakeOn); wakeOnRef.current = wakeOn;

  // Give the microphone back to the wake word once JARVIS is completely idle (not thinking, not waiting for a
  // yes/no, not listening, not speaking). Otherwise the wake engine would hear JARVIS's own voice.
  const conversationUntilRef = useRef(0);

  const resumeWhenIdle = useCallback(async () => {
    if (!wakeOnRef.current) return;

    // Wait for the current command, confirmation, recording, and speech
    // playback to finish before starting another listening session.
    for (let i = 0; i < 240; i++) {
      if (!wakeOnRef.current) return;

      const speaking = await wake.isSpeaking();
      if (
        !busyRef.current &&
        !pendingRef.current &&
        !listeningRef.current &&
        !speaking
      ) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (!wakeOnRef.current) return;
    if (busyRef.current || pendingRef.current || listeningRef.current) return;

    // During an active conversation, listen again without requiring
    // the user to repeat the wake phrase.
    if (Date.now() < conversationUntilRef.current) {
      await new Promise(resolve => setTimeout(resolve, 200));

      if (
        wakeOnRef.current &&
        !busyRef.current &&
        !pendingRef.current &&
        !listeningRef.current &&
        Date.now() < conversationUntilRef.current
      ) {
        await voiceRef.current?.(false);
      }
      return;
    }

    // The conversation window has ended. Return to wake-word mode.
    await new Promise(resolve => setTimeout(resolve, 400));
    if (wakeOnRef.current) wake.resume();
  }, []);

  const startVoice = useCallback(async (wakeTriggered = false) => {
    const fromWake = wakeTriggered === true;
    if (listeningRef.current) { stopListening(); return; }
    if (wakeOnRef.current) await wake.pause(); // only one thing may use the mic at a time
    if (fromWake) {
      // The native wake service already speaks "Yes?" and only emits
      // the wake event after its acknowledgment finishes.
      await new Promise(resolve => setTimeout(resolve, 150));
    } else stopSpeaking();
    listeningRef.current = true; setListening(true); setPartial('');
    try {
      const heard = await listen(setPartial, settings.lang, () => { if (fromWake) wake.ack(); }, { offline: settings.offlineRecognition });
      listeningRef.current = false; setListening(false); setPartial('');
      if (heard.trim()) {
        const endConversation = /^(goodbye(?:\\s+jarvis)?|bye\\s+jarvis|that's all jarvis|that is all jarvis|stop listening)\\b/i.test(heard.trim());

        await send(heard, { viaVoice: true });

        // Keep the microphone conversation open for 30 seconds after
        // each completed voice turn, unless the user says goodbye.
        conversationUntilRef.current = endConversation ? 0 : Date.now() + 30000;
      }
    } catch (e) { listeningRef.current = false; setListening(false); setPartial(''); if (e?.code !== 'NO_SPEECH') notify(e.message); }
    finally { resumeWhenIdle(); }
  }, [settings.lang, settings.offlineRecognition, send, notify, resumeWhenIdle]);
  voiceRef.current = startVoice;

  // Start/stop the always-listening service with the setting (and again each time the app opens, because Android
  // does not restart a microphone service by itself after a reboot).
  useEffect(() => {
    if (!isNative()) return;
    if (wakeOn) wake.start().catch(e => { notify(e.message); setSettings?.(s => ({ ...s, wakeWord: false })); });
    else wake.stop();
  }, [wakeOn]); // eslint-disable-line react-hooks/exhaustive-deps

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
