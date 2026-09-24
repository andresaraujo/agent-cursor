import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './runtime.mjs';

export const OVERLAY_BIN = join(ROOT, 'native', 'bin', 'agent-cursor-overlay');

// Wraps the native overlay process. Events: ready, cursor-moved, hotkey, frontmost, closed.
export function openOverlay(html, { width = 520, height = 320, hideWhenFrontmost, hotkey } = {}) {
  if (!existsSync(OVERLAY_BIN)) throw new Error(`overlay binary missing: ${OVERLAY_BIN} (run native/build.sh)`);
  const args = ['--width', String(width), '--height', String(height)];
  if (hideWhenFrontmost) args.push('--hide-when-frontmost', hideWhenFrontmost);
  if (hotkey) args.push('--hotkey', hotkey);

  const proc = spawn(OVERLAY_BIN, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const events = new EventEmitter();
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        events.emit(msg.type, msg);
      } catch {}
    }
  });
  proc.on('exit', () => events.emit('closed'));
  proc.on('error', (err) => events.emit('error', err));

  const write = (msg) => {
    if (proc.exitCode === null && proc.stdin.writable) proc.stdin.write(`${JSON.stringify(msg)}\n`);
  };
  write({ type: 'html', html: Buffer.from(html).toString('base64') });

  return Object.assign(events, {
    eval: (js) => write({ type: 'eval', js }),
    watchCursor: () => write({ type: 'watch-cursor' }),
    activate: (bundleId) => write({ type: 'activate', bundleId }),
    close: () => write({ type: 'close' }),
  });
}
