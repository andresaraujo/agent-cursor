import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, openSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { listAgents } from './herdr.mjs';
import { OVERLAY_BIN } from './overlay.mjs';
import { CONFIG_FILE, CONTROL_SOCKET, LOG_FILE, ROOT, ensureStateDir, isDisabled, runningPid, setDisabled } from './runtime.mjs';
import { reconcile, view } from './state.mjs';
import { isPaneId, parseUrl } from './url.mjs';

function start() {
  if (isDisabled()) return console.log('agent-cursor disabled (run toggle to enable)');
  const pid = runningPid();
  if (pid) return console.log(`agent-cursor already running (pid ${pid})`);
  if (!existsSync(OVERLAY_BIN)) {
    console.error(`overlay binary missing: ${OVERLAY_BIN}\nbuild it with: sh native/build.sh`);
    process.exit(1);
  }
  ensureStateDir();
  const out = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [join(ROOT, 'src', 'daemon.mjs')], {
    detached: true,
    stdio: ['ignore', out, out],
    env: process.env,
  });
  child.unref();
  console.log(`agent-cursor started (pid ${child.pid})`);
}

function stop() {
  const pid = runningPid();
  if (!pid) return console.log('agent-cursor not running');
  process.kill(pid, 'SIGTERM');
  console.log(`agent-cursor stopped (pid ${pid})`);
}

function toggle() {
  if (runningPid()) {
    setDisabled(true);
    stop();
  } else {
    setDisabled(false);
    start();
  }
}

async function status() {
  const pid = runningPid();
  console.log(`daemon: ${pid ? `running (pid ${pid})` : 'stopped'}${isDisabled() ? ', disabled' : ''}`);
  console.log(`log: ${LOG_FILE}`);
  console.log(`config: ${CONFIG_FILE}`);
  try {
    const agents = await listAgents();
    const v = view(reconcile(new Map(), agents, Date.now()), Date.now());
    console.log(`agents: ${agents.length} · view: ${v.mode}`);
    for (const r of v.rows) console.log(`  ${r.id.padEnd(7)} ${r.status.padEnd(8)} ${r.name} (${r.agent}) ${r.detail}`);
  } catch (err) {
    console.log(`herdr: unreachable (${err.message})`);
  }
}

// Send one command to the running daemon's control socket.
function control(msg) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(CONTROL_SOCKET);
    let buffer = '';
    const timer = setTimeout(() => socket.destroy(new Error('daemon did not answer')), 3000);
    socket.on('connect', () => socket.write(`${JSON.stringify(msg)}\n`));
    socket.on('data', (chunk) => { buffer += chunk; });
    socket.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer)); } catch { reject(new Error('bad reply from daemon')); }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' || err.code === 'ECONNREFUSED' ? new Error('agent-cursor not running') : err);
    });
  });
}

async function report(promise) {
  const reply = await promise;
  if (!reply.ok) throw new Error(reply.error);
  console.log(reply.focused ? `focused ${reply.focused}` : 'nothing blocked or done');
}

const jump = () => report(control({ cmd: 'jump' }));

function focus(pane) {
  if (!isPaneId(pane)) throw new Error('usage: focus <pane id, e.g. w6:p4>');
  return report(control({ cmd: 'focus', pane }));
}

function url(raw) {
  const { cmd, args } = parseUrl(raw ?? '');
  return commands[cmd](...args);
}

const commands = { start, stop, toggle, status, jump, focus, url };
const cmd = commands[process.argv[2]];
if (!cmd) {
  console.error('usage: run.sh start|stop|toggle|status|jump|focus <pane>|url <agent-cursor://…>');
  process.exit(2);
}
try {
  await cmd(...process.argv.slice(3));
} catch (err) {
  console.error(`agent-cursor: ${err.message}`);
  // URL launches have no terminal; leave a trace in the daemon log.
  if (process.argv[2] === 'url') {
    try { appendFileSync(LOG_FILE, `${new Date().toISOString()} url ${process.argv[3]}: ${err.message}\n`); } catch {}
  }
  process.exit(1);
}
