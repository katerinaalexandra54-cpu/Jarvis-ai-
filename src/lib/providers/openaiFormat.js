// Shared parsing for OpenAI-style chat completions (OpenRouter, OpenAI, and our own backend proxy).
const asText = c => typeof c === 'string' ? c : (c || []).map(p => p.text || '').join('');

export function normalizeChoice(choice = {}) {
  const m = choice.message || {};
  const toolCalls = (m.tool_calls || []).map(tc => {
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* model sent bad JSON: validator will reject */ }
    return { id: tc.id, name: tc.function?.name, arguments: args };
  });
  return { text: asText(m.content).trim(), toolCalls, finishReason: choice.finish_reason || null };
}
export const imageFrom = choice => choice?.message?.images?.[0]?.image_url?.url;
