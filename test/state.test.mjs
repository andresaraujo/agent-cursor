import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DONE_MS, hasUnseen, jumpTargets, labels, markSeen, nextExpiry, reconcile, view } from '../src/state.mjs';

const agent = (pane_id, agent_status, extra = {}) => ({
  pane_id,
  agent_status,
  agent: 'claude',
  foreground_cwd: `/code/${pane_id.replace(':', '-')}`,
  terminal_title_stripped: '',
  ...extra,
});

test('idle panes hidden', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'idle')], 0, { initial: true });
  assert.equal(view(s, 0).mode, 'hidden');
});

test('only working → collapsed pill', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'working'), agent('w1:p2', 'working')], 0);
  const v = view(s, 0);
  assert.equal(v.mode, 'pill');
  assert.equal(v.counts.working, 2);
});

test('blocked expands and sorts first', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'working'), agent('w1:p2', 'blocked')], 0);
  const v = view(s, 0);
  assert.equal(v.mode, 'expanded');
  assert.deepEqual(v.rows.map((r) => r.status), ['blocked', 'working']);
});

test('done stays until seen, then expires after DONE_MS', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working')], 0, { initial: true });
  s = reconcile(s, [agent('w1:p1', 'done')], 1000);
  assert.equal(view(s, 1000).rows[0].status, 'done');
  assert.ok(hasUnseen(s));
  assert.equal(nextExpiry(s, 1000), null);
  assert.equal(view(s, 1000 + 60_000).rows[0].status, 'done'); // still there, user away
  s = markSeen(s, 70_000);
  assert.ok(!hasUnseen(s));
  assert.equal(nextExpiry(s, 70_000), 70_000 + DONE_MS);
  assert.equal(view(s, 70_000 + DONE_MS).mode, 'hidden');
  // Stays hidden on later polls even though herdr still reports done.
  s = reconcile(s, [agent('w1:p1', 'done')], 80_000);
  assert.equal(view(s, 80_000).mode, 'hidden');
});

test('focusing the finished pane marks it seen', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working')], 0);
  s = reconcile(s, [agent('w1:p1', 'done')], 100);
  s = reconcile(s, [agent('w1:p1', 'idle', { focused: true })], 200);
  assert.equal(s.get('w1:p1').seenAt, 200);
});

test('blocked row shows reason instead of title', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'blocked', { terminal_title_stripped: 'Refactor' })], 0, {
    reasons: new Map([['w1:p1', 'Bash: npm test']]),
  });
  assert.equal(view(s, 0).rows[0].detail, 'Bash: npm test');
});

test('labels: unique project, herdr name, tab disambiguation, pane fallback', () => {
  const a = (pane_id, tab_id, cwd, extra = {}) => ({ pane_id, tab_id, foreground_cwd: cwd, ...extra });
  const out = labels([
    a('w1:p1', 'w1:t1', '/x/api'),
    a('w6:p1', 'w6:t1', '/x/lekey'),
    a('w6:p3', 'w6:t3', '/x/lekey'),
    a('w6:p4', 'w6:t3', '/x/lekey'),
    a('w6:p5', 'w6:t5', '/x/lekey', { name: 'reviewer' }),
  ], new Map([['w6:t1', '1'], ['w6:t3', '3']]));
  assert.equal(out.get('w1:p1'), 'api');
  assert.equal(out.get('w6:p1'), 'lekey/1');
  assert.equal(out.get('w6:p3'), 'lekey/3.3');
  assert.equal(out.get('w6:p4'), 'lekey/3.4');
  assert.equal(out.get('w6:p5'), 'reviewer');
});

test('working → idle also flashes done', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working')], 0);
  s = reconcile(s, [agent('w1:p1', 'idle')], 500);
  assert.equal(view(s, 500).rows[0].status, 'done');
});

test('already-done panes at startup not shown', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'done')], 0, { initial: true });
  assert.equal(view(s, 0).mode, 'hidden');
});

test('since kept while status unchanged', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working')], 100);
  s = reconcile(s, [agent('w1:p1', 'working')], 900);
  assert.equal(s.get('w1:p1').since, 100);
});

test('title repeating project dropped, real title kept', () => {
  const s = reconcile(new Map(), [
    agent('w1:p1', 'working', { foreground_cwd: '/x/quick_chat', terminal_title_stripped: 'π - quick_chat' }),
    agent('w1:p2', 'working', { terminal_title_stripped: 'Refactor auth' }),
  ], 0);
  assert.equal(s.get('w1:p1').title, '');
  assert.equal(s.get('w1:p2').title, 'Refactor auth');
});

test('jumpTargets: blocked first, then unvisited done newest first', () => {
  let s = reconcile(new Map(), [
    agent('w1:p1', 'working'), agent('w1:p2', 'working'), agent('w1:p3', 'working'), agent('w1:p4', 'working'),
  ], 0);
  s = reconcile(s, [
    agent('w1:p1', 'done'), agent('w1:p2', 'blocked'), agent('w1:p3', 'working'), agent('w1:p4', 'working'),
  ], 100);
  s = reconcile(s, [
    agent('w1:p1', 'done'), agent('w1:p2', 'blocked'), agent('w1:p3', 'blocked'), agent('w1:p4', 'idle'),
  ], 200);
  assert.deepEqual(jumpTargets(s), ['w1:p2', 'w1:p3', 'w1:p4', 'w1:p1']);
});

test('jumpTargets: unvisited survives overlay fade; visiting removes it', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working')], 0);
  s = reconcile(s, [agent('w1:p1', 'idle')], 100);
  s = markSeen(s, 200);
  assert.equal(view(s, 200 + DONE_MS).mode, 'hidden');
  assert.deepEqual(jumpTargets(s), ['w1:p1']); // still unvisited
  s = reconcile(s, [agent('w1:p1', 'idle', { focused: true })], 10_000);
  // Visited: only the fallback keeps it reachable.
  assert.equal(s.get('w1:p1').visitedAt, 10_000);
  assert.deepEqual(jumpTargets(s), ['w1:p1']);
});

test('jumpTargets: fallback is most recent finish, only when nothing else', () => {
  let s = reconcile(new Map(), [agent('w1:p1', 'working'), agent('w1:p2', 'working')], 0);
  s = reconcile(s, [agent('w1:p1', 'idle'), agent('w1:p2', 'working')], 100);
  s = reconcile(s, [agent('w1:p1', 'idle'), agent('w1:p2', 'idle')], 200);
  s = reconcile(s, [agent('w1:p1', 'idle', { focused: true }), agent('w1:p2', 'idle')], 300);
  s = reconcile(s, [agent('w1:p1', 'idle'), agent('w1:p2', 'idle', { focused: true })], 400);
  assert.deepEqual(jumpTargets(s), ['w1:p2']);
});

test('jumpTargets: herdr done from before startup counts as unvisited', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'done'), agent('w1:p2', 'idle')], 0, { initial: true });
  assert.deepEqual(jumpTargets(s), ['w1:p1']);
  assert.equal(view(s, 0).mode, 'hidden');
});

test('jumpTargets: nothing → empty', () => {
  const s = reconcile(new Map(), [agent('w1:p1', 'idle'), agent('w1:p2', 'working')], 0, { initial: true });
  assert.deepEqual(jumpTargets(s), []);
});
