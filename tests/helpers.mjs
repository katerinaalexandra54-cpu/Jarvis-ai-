// Test doubles: a scripted "AI" and a fake Android layer.
import { executeTool, TOOL_SCHEMAS } from '../src/lib/brain/tools.js';
import { runAgent } from '../src/lib/brain/agent.js';
import { buildSystemPrompt } from '../src/lib/brain/systemPrompt.js';

export const say = text => ({ text, toolCalls: [], finishReason: 'stop' });
export const call = (name, args = {}, id) => ({ id: id || `c_${name}`, name, arguments: args });
export const tools = (...calls) => ({ text: '', toolCalls: calls, finishReason: 'tool_calls' });

/** Provider that returns scripted replies in order; a function entry can throw or inspect messages. */
export function fakeProvider(script) {
  const seen = [];
  return {
    seen,
    async chat(_s, req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const next = script.shift();
      if (!next) throw new Error('script exhausted');
      return typeof next === 'function' ? next(req) : next;
    },
  };
}

export function fakeDeps(over = {}) {
  const log = [];
  const phone = {
    setTorch: async on => { log.push(['setTorch', on]); },
    getVolume: async () => ({ level: 40 }),
    setVolume: async level => { log.push(['setVolume', level]); return { level }; },
    openApp: async name => { log.push(['openApp', name]); return { app: name }; },
    getBattery: async () => ({ percent: 62, charging: true }),
    getDeviceInfo: async () => ({ manufacturer: 'Google', model: 'Pixel', androidVersion: '14', language: 'en-US', timezone: 'UTC' }),
    mediaControl: async action => { log.push(['media', action]); return { musicActive: action === 'play' }; },
    ...over.phone,
  };
  return {
    log, settleMs: 0, sleep: async () => {}, onSms: () => {},
    run: async a => { log.push(['run', a.type]); return {}; },
    resolveTarget: async to => ({ name: to, number: '555' }),
    confirm: async () => true,
    ...over, phone,
  };
}

export async function turn({ script, userText, history = [], deps = fakeDeps(), deviceState = {}, maxSteps }) {
  const provider = fakeProvider(script);
  const states = [];
  const out = await runAgent({
    provider, settings: {}, history, userText, tools: TOOL_SCHEMAS, maxSteps,
    system: buildSystemPrompt({ name: 'Tony Stark', now: 'now', deviceState }),
    execute: (n, a) => executeTool(n, a, deps),
    onToolResult: (n, a, r) => states.push([n, r]),
  });
  return { out, provider, deps };
}
