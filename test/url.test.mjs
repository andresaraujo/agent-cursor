import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUrl } from '../src/url.mjs';

test('simple actions', () => {
  for (const cmd of ['jump', 'toggle', 'start', 'stop']) {
    assert.deepEqual(parseUrl(`agent-cursor://${cmd}`), { cmd, args: [] });
  }
  assert.deepEqual(parseUrl('agent-cursor:jump'), { cmd: 'jump', args: [] });
});

test('focus by path or query', () => {
  assert.deepEqual(parseUrl('agent-cursor://focus/w6:p4'), { cmd: 'focus', args: ['w6:p4'] });
  assert.deepEqual(parseUrl('agent-cursor://focus/w6%3Ap4'), { cmd: 'focus', args: ['w6:p4'] });
  assert.deepEqual(parseUrl('agent-cursor://focus?pane=w1:p2'), { cmd: 'focus', args: ['w1:p2'] });
  assert.deepEqual(parseUrl('agent-cursor://focus/w6:pA'), { cmd: 'focus', args: ['w6:pA'] });
});

test('rejects unknown actions, bad panes, other schemes', () => {
  assert.throws(() => parseUrl('agent-cursor://rm'), /unknown action/);
  assert.throws(() => parseUrl('agent-cursor://'), /unknown action/);
  assert.throws(() => parseUrl('agent-cursor://jump/extra'), /unknown action/);
  assert.throws(() => parseUrl('agent-cursor://focus/$(whoami)'), /pane id/);
  assert.throws(() => parseUrl('agent-cursor://focus'), /pane id/);
  assert.throws(() => parseUrl('https://jump'), /unsupported scheme/);
  assert.throws(() => parseUrl('not a url'), /invalid url/);
});
