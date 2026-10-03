import test from 'node:test';
import assert from 'node:assert/strict';
import { say, call, tools, turn, fakeDeps } from './helpers.mjs';
import { TOOLS, TOOL_SCHEMAS, executeTool, stateFromResult } from '../src/lib/brain/tools.js';
import { classifyRoute } from '../src/lib/brain/router.js';
import { trimHistory } from '../src/lib/brain/memory.js';
import { buildSystemPrompt } from '../src/lib/brain/systemPrompt.js';
import { ProviderError, NetworkError } from '../src/lib/providers/errors.js';

const toolMsgs = p => p.seen.at(-1).messages.filter(m => m.role === 'tool').map(m => JSON.parse(m.content));

// ---- Test plan #1: normal conversation ----
test('conversation: replies with no tools, route=conversation', async () => {
  const { out, deps } = await turn({ userText: 'Thanks, you are great', script: [say('Always a pleasure.')] });
  assert.equal(out.text, 'Always a pleasure.');
  assert.equal(out.route, 'conversation');
  assert.equal(deps.log.length, 0);
});

test('information: a question with no tool is routed as information', async () => {
  const { out } = await turn({ userText: "What's the weather?", script: [say("I can't see live weather. Shall I open a search?")] });
  assert.equal(out.route, 'information');
});

// ---- #2: flashlight ----
test('flashlight: tool executed, result fed back, reply after success', async () => {
  const { out, provider, deps } = await turn({ userText: 'Turn on my flashlight', script: [tools(call('torch_set', { enabled: true })), say('Flashlight is on.')] });
  assert.deepEqual(deps.log, [['setTorch', true]]);
  assert.equal(toolMsgs(provider)[0].success, true);
  assert.equal(out.text, 'Flashlight is on.');
  assert.equal(out.route, 'action');
});

// ---- #3: app opening ----
test('app open: app.open called with the app name', async () => {
  const { out, deps } = await turn({ userText: 'Open YouTube', script: [tools(call('app_open', { name: 'YouTube' })), say('Opening YouTube.')] });
  assert.deepEqual(deps.log, [['openApp', 'YouTube']]);
  assert.equal(out.route, 'action');
});

// ---- #4: battery query ----
test('battery: read-only tool, data reaches the model, route=information', async () => {
  const { out, provider } = await turn({ userText: 'How much battery do I have?', script: [tools(call('device_get_battery')), say('Battery is at 62 percent and charging.')] });
  assert.deepEqual(toolMsgs(provider)[0], { success: true, percent: 62, charging: true });
  assert.equal(out.route, 'information');
});

// ---- #5: failed tool execution ----
test('failed tool: failure goes to the model verbatim, never reported as success', async () => {
  const deps = fakeDeps({ phone: { setTorch: async () => { throw new Error('Permission denied'); } } });
  const { out, provider } = await turn({ deps, userText: 'Flashlight on', script: [tools(call('torch_set', { enabled: true })), say("I couldn't switch it on: permission denied.")] });
  assert.deepEqual(toolMsgs(provider)[0], { success: false, error: 'Permission denied' });
  assert.match(out.text, /permission denied/i);
});

test('failed tool: if the AI returns nothing, the fallback reports the error, not "Done"', async () => {
  const deps = fakeDeps({ phone: { setTorch: async () => { throw new Error('Permission denied'); } } });
  const { out } = await turn({ deps, userText: 'Flashlight on', script: [tools(call('torch_set', { enabled: true })), say('')] });
  assert.match(out.text, /Permission denied/);
  assert.doesNotMatch(out.text, /^Done/);
});

test('media.play fails honestly when no player starts', async () => {
  const deps = fakeDeps({ phone: { mediaControl: async () => ({ musicActive: false }) } });
  const r = await executeTool('media_play', {}, deps);
  assert.equal(r.success, false);
  assert.match(r.error, /No media app/);
});

// ---- #6: unknown command ----
test('unknown command: invented tool name is rejected safely and reported', async () => {
  const { out, provider } = await turn({ userText: 'Hack my neighbour wifi', script: [tools(call('hack_wifi', {})), say("I can't do that.")] });
  const r = toolMsgs(provider)[0];
  assert.equal(r.success, false);
  assert.match(r.error, /no tool called/);
  assert.equal(out.text, "I can't do that.");
});

test('unknown command: the AI can simply decline without any tool', async () => {
  const { out } = await turn({ userText: 'Teleport me to Mars', script: [say("I can't do that yet.")] });
  assert.equal(out.route, 'conversation');
});

// ---- #7: follow-up command ----
test('follow-up: "turn it off" sees the previous tool call, result and known state', async () => {
  const deps = fakeDeps();
  const first = await turn({ deps, userText: 'Turn on the flashlight', script: [tools(call('torch_set', { enabled: true })), say('Flashlight is on.')] });
  const history = trimHistory(first.out.newMessages);
  const state = stateFromResult('torch_set', { enabled: true }, { success: true, enabled: true });
  assert.deepEqual(state, { flashlight: 'on' });
  const second = await turn({ deps, history, deviceState: state, userText: 'Turn it off', script: [tools(call('torch_set', { enabled: false })), say('Flashlight is off.')] });
  const firstCall = second.provider.seen[0].messages;
  assert.match(firstCall[0].content, /Flashlight: on/);
  assert.ok(firstCall.some(m => m.tool_calls?.[0]?.function?.name === 'torch_set'), 'previous tool call present');
  assert.ok(firstCall.some(m => m.role === 'tool'), 'previous tool result present');
  assert.deepEqual(deps.log, [['setTorch', true], ['setTorch', false]]);
});

test('memory: trimHistory keeps whole turns so tool pairs are never split', () => {
  const msgs = [];
  for (let i = 0; i < 12; i++) msgs.push({ role: 'user', content: `u${i}` }, { role: 'assistant', content: null, tool_calls: [{ id: `${i}` }] }, { role: 'tool', tool_call_id: `${i}`, content: '{}' }, { role: 'assistant', content: 'ok' });
  const t = trimHistory(msgs, 3);
  assert.equal(t[0].role, 'user');
  assert.equal(t.filter(m => m.role === 'user').length, 3);
  assert.equal(t.filter(m => m.role === 'tool').length, 3);
});

// ---- #8/#9: API failure and network failure ----
test('API failure before any action: error propagates to the UI', async () => {
  await assert.rejects(turn({ userText: 'hi', script: [() => { throw new ProviderError('rate limited', { status: 429 }); }] }), /rate limited/);
});

test('network failure before any action: NetworkError propagates', async () => {
  await assert.rejects(turn({ userText: 'hi', script: [() => { throw new NetworkError(); }] }), NetworkError);
});

test('network failure AFTER an action ran: reply states what happened and the interruption', async () => {
  const { out, deps } = await turn({ userText: 'flashlight on', script: [tools(call('torch_set', { enabled: true })), () => { throw new NetworkError(); }] });
  assert.deepEqual(deps.log, [['setTorch', true]]);
  assert.match(out.text, /lost my connection/);
});

// ---- multi-step, confirmation, validation, caps ----
test('multi-step: open YouTube then play music, in order, route=multi_step', async () => {
  const { out, deps } = await turn({ userText: 'Open YouTube and play music', script: [tools(call('app_open', { name: 'YouTube' }, 'a'), call('media_play', {}, 'b')), say('YouTube is open and music is playing.')] });
  assert.deepEqual(deps.log, [['openApp', 'YouTube'], ['media', 'play']]);
  assert.equal(out.route, 'multi_step');
});

test('call: declined confirmation places no call and reports cancelled', async () => {
  const deps = fakeDeps({ confirm: async () => false });
  const { provider, deps: d } = await turn({ deps, userText: 'Call Mom', script: [tools(call('phone_call', { to: 'Mom' })), say('Okay, cancelled.')] });
  assert.equal(toolMsgs(provider)[0].cancelled, true);
  assert.ok(!d.log.some(l => l[0] === 'run'));
});

test('call: confirmed call dials the resolved number', async () => {
  const deps = fakeDeps();
  const r = await executeTool('phone_call', { to: 'Mom' }, deps);
  assert.equal(r.success, true);
  assert.deepEqual(deps.log, [['run', 'call']]);
});

test('validation: bad arguments are rejected before touching the phone', async () => {
  const deps = fakeDeps();
  assert.match((await executeTool('volume_set', { level: 150 }, deps)).error, /at most 100/);
  assert.match((await executeTool('torch_set', {}, deps)).error, /Missing required/);
  assert.match((await executeTool('torch_set', { enabled: 'yes' }, deps)).error, /true or false/);
  assert.match((await executeTool('url_open', { url: 'http://x.com' }, deps)).error, /https/);
  assert.equal(deps.log.length, 0);
});

test('volume.set supports relative change', async () => {
  const deps = fakeDeps();
  const r = await executeTool('volume_set', { change: 20 }, deps);
  assert.equal(r.level, 60);
});

test('step cap: a runaway tool loop is stopped and wrapped up honestly', async () => {
  const script = [...Array(3)].map(() => tools(call('device_get_battery'))); script.push(say('That is as far as I got.'));
  const { out, deps } = await turn({ userText: 'loop', maxSteps: 3, script });
  assert.equal(out.toolLog.length, 3);
  assert.equal(out.text, 'That is as far as I got.');
  assert.equal(deps.log.length, 0);
});

// ---- structure ----
test('tool registry: required initial tools exist, wire names are valid and unique', () => {
  const names = TOOLS.map(t => t.name);
  for (const n of ['torch.set', 'volume.set', 'volume.get', 'app.open', 'device.get_battery', 'device.get_info', 'media.play', 'media.pause', 'media.next', 'media.previous']) assert.ok(names.includes(n), n);
  const wire = TOOL_SCHEMAS.map(t => t.function.name);
  assert.equal(new Set(wire).size, wire.length);
  for (const w of wire) assert.match(w, /^[a-zA-Z0-9_-]+$/);
});

test('router classification', () => {
  assert.equal(classifyRoute({ userText: 'hello there', toolLog: [] }), 'conversation');
  assert.equal(classifyRoute({ userText: 'who made you?', toolLog: [] }), 'information');
  assert.equal(classifyRoute({ userText: 'x', toolLog: [{ name: 'torch_set' }] }), 'action');
  assert.equal(classifyRoute({ userText: 'x', toolLog: [{ name: 'device_get_battery' }, { name: 'volume_get' }] }), 'information');
  assert.equal(classifyRoute({ userText: 'x', toolLog: [{ name: 'app_open' }, { name: 'media_play' }] }), 'multi_step');
});

test('system prompt carries the honesty and behavior rules', () => {
  const p = buildSystemPrompt({ name: 'Tony Stark', now: 'noon', lastSms: 'Pepper', deviceState: { flashlight: 'on' } });
  for (const s of ['Never say an action is done before', 'success false', 'permission', 'CALL IT', 'Flashlight: on', 'Pepper', 'Tony']) assert.ok(p.includes(s), s);
  assert.doesNotMatch(p, /Stark/); // first name only
});
