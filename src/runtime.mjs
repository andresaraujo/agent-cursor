import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STATE_DIR = process.env.HERDR_PLUGIN_STATE_DIR || join(homedir(), '.local', 'state', 'herdr', 'plugins', 'local.agent-cursor');
export const LOCK_FILE = join(STATE_DIR, 'daemon.pid');
export const DISABLED_FILE = join(STATE_DIR, 'disabled');
export const LOG_FILE = join(STATE_DIR, 'daemon.log');
export const CONTROL_SOCKET = join(STATE_DIR, 'control.sock');
export const CONFIG_FILE = join(
  process.env.HERDR_PLUGIN_CONFIG_DIR || join(homedir(), '.config', 'herdr', 'plugins', 'config', 'local.agent-cursor'),
  'config.json',
);

// Optional user config: { hotkey: "ctrl+opt+j" | null, hideWhenFrontmost: bool, terminalBundleId }.
export function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function runningPid() {
  try {
    const pid = Number.parseInt(readFileSync(LOCK_FILE, 'utf8'), 10);
    return isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

// Exclusive pid lock; clears a stale lock left by a dead process.
export function acquireLock() {
  ensureStateDir();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_FILE, `${process.pid}\n`, { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (runningPid()) return false;
      rmSync(LOCK_FILE, { force: true });
    }
  }
  return false;
}

export function releaseLock() {
  if (runningPid() === process.pid) rmSync(LOCK_FILE, { force: true });
}

export function isDisabled() {
  return existsSync(DISABLED_FILE);
}

export function setDisabled(disabled) {
  ensureStateDir();
  if (disabled) writeFileSync(DISABLED_FILE, `${Date.now()}\n`);
  else rmSync(DISABLED_FILE, { force: true });
}
