import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalIntent } from '../src/lib/brain/localIntent.js';

test('recognises clear app-opening commands', () => {
  for (const [text, app] of [
    ['Open TikTok', 'TikTok'],
    ['Launch WhatsApp', 'WhatsApp'],
    ['Start YouTube', 'YouTube'],
    ['Open Instagram please', 'Instagram'],
    ['Go to Telegram', 'Telegram'],
  ]) {
    assert.deepEqual(parseLocalIntent(text), {
      tool: 'app_open',
      args: { name: app },
      kind: 'open',
      app,
    });
  }
});

test('does not open apps when the user asks to read, reply, or send', () => {
  assert.equal(parseLocalIntent('read WhatsApp'), null);
  assert.equal(parseLocalIntent('send a message on WhatsApp'), null);
  assert.equal(parseLocalIntent('reply on Telegram'), null);
});

test('does not guess an app from unclear or unrelated text', () => {
  assert.equal(parseLocalIntent('TikTok'), null);
  assert.equal(parseLocalIntent('What is TikTok?'), null);
  assert.equal(parseLocalIntent('open the app'), null);
  assert.equal(parseLocalIntent(''), null);
});

test('preserves existing local navigation and notification commands', () => {
  assert.equal(parseLocalIntent('press back')?.args.action, 'back');
  assert.equal(parseLocalIntent('take me home')?.args.action, 'home');
  assert.equal(parseLocalIntent('scroll down')?.args.direction, 'down');
  assert.equal(parseLocalIntent('read my latest notifications')?.kind, 'notification');
});
