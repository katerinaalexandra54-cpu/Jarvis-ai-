// Short-term conversation memory (Phase 6). Deliberately simple: a rolling window of the last few
// turns in OpenAI message format (including tool calls and results, so "turn it off" works), plus a
// tiny map of last-known phone state. Nothing here is permanent; "New chat" clears the window.

export const MAX_TURNS = 8;

/** Keep the last N user turns. Cutting only at user messages keeps tool_call/tool pairs intact. */
export function trimHistory(messages, maxTurns = MAX_TURNS) {
  const starts = [];
  messages.forEach((m, i) => { if (m.role === 'user') starts.push(i); });
  if (starts.length <= maxTurns) return messages;
  return messages.slice(starts[starts.length - maxTurns]);
}

const LABELS = { flashlight: 'Flashlight', volume: 'Volume', lastOpenedApp: 'Last app opened', lastMediaCommand: 'Last media command' };
export function formatDeviceState(state = {}) {
  const lines = Object.entries(state).filter(([, v]) => v).map(([k, v]) => `- ${LABELS[k] || k}: ${v}`);
  return lines.length ? lines.join('\n') : '';
}
