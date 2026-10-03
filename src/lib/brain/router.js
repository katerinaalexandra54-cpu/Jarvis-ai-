// Command router (Phase 5). The model picks tools (that IS the intent selection); this module
// classifies the outcome into the four categories, and owns the limits for each.
import { toolKind } from './tools.js';

export const ROUTES = ['conversation', 'information', 'action', 'multi_step'];
export const MAX_STEPS = 6; // hard cap on tool rounds per request

const QUESTION = /^(what|what's|whats|who|when|where|why|how|which|is|are|does|do|did|can|could|tell me|explain|define|give me)\b|\?\s*$/i;

/**
 * conversation: chat, no tools          information: a question, or only read-only tools
 * action:       exactly one Android action   multi_step: more than one tool involving an action
 */
export function classifyRoute({ userText = '', toolLog = [] }) {
  if (!toolLog.length) return QUESTION.test(userText.trim()) ? 'information' : 'conversation';
  const actions = toolLog.filter(t => toolKind(t.name) !== 'info');
  if (!actions.length) return 'information';
  return toolLog.length > 1 ? 'multi_step' : 'action';
}
