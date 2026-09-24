import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

export const SOCKET_PATH = process.env.HERDR_SOCKET_PATH || join(homedir(), '.config', 'herdr', 'herdr.sock');

let seq = 0;

function lineReader(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try { onLine(JSON.parse(line)); } catch {}
    }
  };
}

// One-shot request on its own connection; resolves with `result`.
export function request(method, params = {}, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = `ac_${process.pid}_${++seq}`;
    const socket = createConnection(SOCKET_PATH);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`herdr ${method} timed out`));
    }, timeoutMs);
    const done = (fn, value) => {
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, method, params })}\n`));
    socket.on('data', lineReader((msg) => {
      if (msg.id !== id) return;
      if (msg.error) done(reject, new Error(`${msg.error.code}: ${msg.error.message}`));
      else done(resolve, msg.result);
    }));
    socket.on('error', (err) => done(reject, err));
  });
}

export async function listAgents() {
  const result = await request('agent.list');
  return result?.agents ?? [];
}

// tab_id → tab label.
export async function listTabs() {
  const result = await request('tab.list');
  return new Map((result?.tabs ?? []).map((t) => [t.tab_id, t.label]));
}

export async function readScreen(paneId, lines = 30) {
  const result = await request('agent.read', { target: paneId, source: 'visible', lines });
  return result?.read?.text ?? '';
}

// After events.subscribe a connection only streams events, so each subscription
// set needs its own connection. Returns a handle with close().
export function subscribe(subscriptions, { onEvent, onClose }) {
  const socket = createConnection(SOCKET_PATH);
  let closed = false;
  const finish = (err) => {
    if (closed) return;
    closed = true;
    socket.destroy();
    onClose?.(err);
  };
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({ id: `ac_sub_${++seq}`, method: 'events.subscribe', params: { subscriptions } })}\n`);
  });
  socket.on('data', lineReader((msg) => {
    if (msg.error) return finish(new Error(`${msg.error.code}: ${msg.error.message}`));
    if (msg.event) onEvent(msg);
  }));
  socket.on('error', finish);
  socket.on('close', () => finish());
  return {
    close() {
      closed = true;
      socket.destroy();
    },
  };
}
