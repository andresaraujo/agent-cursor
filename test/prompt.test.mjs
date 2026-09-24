import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockedReason } from '../src/prompt.mjs';

test('claude boxed bash permission → tool + command', () => {
  const screen = `
╭──────────────────────────────────────────────╮
│ Bash command                                 │
│                                              │
│   npm test                                   │
│   Run the test suite                         │
│                                              │
│ Do you want to proceed?                      │
│ ❯ 1. Yes                                     │
│   2. Yes, and don't ask again for npm        │
│   3. No, and tell Claude what to do (esc)    │
╰──────────────────────────────────────────────╯`;
  assert.equal(blockedReason(screen), 'Bash: npm test');
});

// Captured from Claude Code v2.1.281 in herdr.
test('real claude bash permission with tip line', () => {
  const screen = `⏺ Creating foo dir and writing hi to bar.txt
  ⎿  $ mkdir -p foo && echo hi > foo/bar.txt
────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
   mkdir -p foo && echo hi > foo/bar.txt
   Create foo dir and write hi to bar.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for mkdir -p foo and echo hi commands in /tmp/blocktest
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No
 Esc to cancel · Tab to amend`;
  assert.equal(blockedReason(screen), 'Bash: mkdir -p foo && echo hi > foo/bar.txt');
});

test('claude unboxed edit permission', () => {
  const screen = `
────────────────────────────────────────
 Edit file
 src/auth.ts

 Do you want to make this edit to auth.ts?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No, and tell Claude what to do differently (esc)
`;
  assert.equal(blockedReason(screen), 'Edit file: src/auth.ts');
});

test('specific question shown as-is', () => {
  const screen = `Some output\n\nWhich database should I use for the cache?\n> `;
  assert.equal(blockedReason(screen), 'Which database should I use for the cache?');
});

test('no question → empty (status bars are not reasons)', () => {
  assert.equal(blockedReason('building…\n↑205k ↓9.0k $3.32 (sub)\n────\n'), '');
});

test('wrapped question joined with line above', () => {
  const screen = 'Should I turn this prototype\ninto an actual app?\n> ';
  assert.equal(blockedReason(screen), 'Should I turn this prototype into an actual app?');
});

test('empty screen', () => {
  assert.equal(blockedReason(''), '');
});

test('long lines truncated', () => {
  const r = blockedReason(`${'x'.repeat(200)}?`);
  assert.equal(r.length, 72);
  assert.ok(r.startsWith('…') && r.endsWith('?'));
});
