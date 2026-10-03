// The JARVIS brain loop: AI -> tool calls -> Android results -> AI -> spoken answer.
// Provider-agnostic: it only needs an object with chat(settings, {messages, tools, maxTokens}).
import { classifyRoute, MAX_STEPS } from './router.js';
import { toolKind } from './tools.js';

let n = 0;
const callId = () => `call_${Date.now().toString(36)}_${++n}`;

/** Honest fallback wording built from real results, used only if the AI cannot write its own reply. */
export function fallbackText(log, interrupted = false) {
  const failed = log.filter(t => !t.result?.success);
  let t;
  if (!log.length) t = "I didn't get a reply. Please try again.";
  else if (!failed.length) t = 'Done.';
  else if (failed.length === log.length) t = `I couldn't do that. ${failed[0].result?.error || ''}`.trim();
  else t = `Some of that worked, but not everything. ${failed[0].result?.error || ''}`.trim();
  return interrupted && log.length ? `${t} I lost my connection before I could finish my reply.` : t;
}

export async function runAgent({ provider, settings, system, history = [], userText, tools, execute, onToolResult, maxSteps = MAX_STEPS }) {
  const base = [{ role: 'system', content: system }, ...history];
  const added = [{ role: 'user', content: userText }];
  const log = [];
  let text = '';

  for (let step = 0; step < maxSteps && !text; step++) {
    let res;
    try { res = await provider.chat(settings, { messages: [...base, ...added], tools, maxTokens: 600 }); }
    catch (e) {
      if (!log.length) throw e; // nothing happened yet: let the UI show the real error
      text = fallbackText(log, true); added.push({ role: 'assistant', content: text }); break; // actions already ran: report honestly
    }
    if (!res.toolCalls?.length) { text = res.text || fallbackText(log); added.push({ role: 'assistant', content: text }); break; }

    const calls = res.toolCalls.map(tc => ({ ...tc, id: tc.id || callId() }));
    added.push({ role: 'assistant', content: res.text || null, tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } })) });
    for (const c of calls) { // sequential: multi-step tasks depend on order
      let result;
      try { result = await execute(c.name, c.arguments || {}); } catch (e) { result = { success: false, error: e?.message || 'The action failed.' }; }
      log.push({ name: c.name, args: c.arguments || {}, kind: toolKind(c.name), result });
      try { onToolResult?.(c.name, c.arguments || {}, result); } catch { /* UI callback must never break the loop */ }
      added.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }

  if (!text) { // step cap hit: ask once more, without tools, for an honest wrap-up
    try {
      const res = await provider.chat(settings, { messages: [...base, ...added, { role: 'system', content: 'Stop calling tools. Tell the user truthfully what was done and what was not.' }], maxTokens: 300 });
      text = res.text;
    } catch { /* fall through */ }
    text = text || fallbackText(log, false);
    added.push({ role: 'assistant', content: text });
  }
  return { text, newMessages: added, toolLog: log, route: classifyRoute({ userText, toolLog: log }) };
}
