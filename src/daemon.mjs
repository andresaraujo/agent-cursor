import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import process from 'node:process';
import { listAgents, listTabs, readScreen, request, subscribe } from './herdr.mjs';
import { openOverlay } from './overlay.mjs';
import { blockedReason } from './prompt.mjs';
import { CONTROL_SOCKET, acquireLock, detectTerminal, readConfig, releaseLock } from './runtime.mjs';
import { hasUnseen, jumpTargets, markSeen, nextExpiry, reconcile, view } from './state.mjs';
import { buildHtml } from './ui.mjs';
import { isPaneId } from './url.mjs';

const POLL_MS = 2000;
const DEBOUNCE_MS = 100;
const MAX_HERDR_DOWN_MS = 30_000;

if (!acquireLock()) process.exit(0);

const log = (...args) => console.log(new Date().toISOString(), ...args);

const config = readConfig();
const TERMINAL_BUNDLE_ID = detectTerminal(config);

let state = new Map();
let initialized = false;
let lastViewJson = '';
let herdrDownSince = null;
let refreshTimer = null;
let expiryTimer = null;
let refreshing = false;
let refreshAgain = false;

// --- Overlay window ---------------------------------------------------------

const overlay = openOverlay(buildHtml(), {
  hideWhenFrontmost: config.hideWhenFrontmost === false ? null : TERMINAL_BUNDLE_ID,
  hotkey: config.hotkey === null ? null : config.hotkey ?? 'ctrl+opt+j',
});

overlay.on('closed', shutdown);
overlay.on('frontmost', ({ hidden }) => log(hidden ? 'terminal frontmost, hidden' : 'shown'));

function pushView() {
  const json = JSON.stringify(view(state, Date.now()));
  if (json === lastViewJson) return;
  lastViewJson = json;
  overlay.eval(`render(${json})`);
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const at = nextExpiry(state, Date.now());
  if (at) expiryTimer = setTimeout(() => { pushView(); scheduleExpiry(); }, at - Date.now() + 20);
}

// --- "Seen" detection -------------------------------------------------------
// Done rows stay until the user is back: the overlay reports the first cursor
// move after we start watching, which starts their countdown.

let watchingCursor = false;

overlay.on('cursor-moved', () => {
  watchingCursor = false;
  state = markSeen(state, Date.now());
  pushView();
  scheduleExpiry();
});

function syncCursorWatch() {
  if (!hasUnseen(state)) {
    watchingCursor = false;
  } else if (!watchingCursor) {
    watchingCursor = true;
    overlay.watchCursor();
  }
}

// --- Jump / focus ---------------------------------------------------------
// Jump goes to what needs you (see jumpTargets), skipping the pane you're on so
// repeated presses cycle. Both bring the terminal forward.

async function focusPane(paneId) {
  await request('agent.focus', { target: paneId });
  if (TERMINAL_BUNDLE_ID) overlay.activate(TERMINAL_BUNDLE_ID);
  requestRefresh();
}

async function jump() {
  const targets = jumpTargets(state);
  const target = targets.find((id) => !state.get(id)?.focused) ?? targets[0];
  if (!target) {
    overlay.eval(`flash(${JSON.stringify('All quiet')})`);
    return { ok: true, focused: null };
  }
  await focusPane(target);
  return { ok: true, focused: target };
}

overlay.on('hotkey', () => jump().catch((err) => log('jump failed:', err.message)));

// --- Control socket ---------------------------------------------------------
// NDJSON commands from the CLI (and through it the URL handler, Raycast, …).

const COMMANDS = {
  jump,
  targets: async () => ({
    ok: true,
    targets: jumpTargets(state),
    rows: [...state.values()].filter((r) => r.status !== 'idle' || r.finishedAt),
  }),
  focus: async ({ pane }) => {
    if (!isPaneId(pane)) throw new Error(`invalid pane id: ${pane}`);
    await focusPane(pane);
    return { ok: true, focused: pane };
  },
};

rmSync(CONTROL_SOCKET, { force: true });
const control = createServer((socket) => {
  let buffer = '';
  socket.on('data', async (chunk) => {
    buffer += chunk.toString('utf8');
    const nl = buffer.indexOf('\n');
    if (nl < 0) return;
    let reply;
    try {
      const msg = JSON.parse(buffer.slice(0, nl));
      const handler = COMMANDS[msg.cmd];
      reply = handler ? await handler(msg) : { ok: false, error: `unknown command: ${msg.cmd}` };
    } catch (err) {
      reply = { ok: false, error: err.message };
    }
    socket.end(`${JSON.stringify(reply)}\n`);
  });
  socket.on('error', () => {});
});
control.listen(CONTROL_SOCKET);

// --- Blocked reasons --------------------------------------------------------

async function readReasons(agents) {
  const blocked = agents.filter((a) => a.agent_status === 'blocked');
  const entries = await Promise.all(blocked.map(async (a) => {
    try {
      return [a.pane_id, blockedReason(await readScreen(a.pane_id))];
    } catch {
      return [a.pane_id, ''];
    }
  }));
  return new Map(entries.filter(([, r]) => r));
}

// --- Reconcile loop ---------------------------------------------------------

async function refresh() {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    const [agents, tabs] = await Promise.all([listAgents(), listTabs()]);
    const reasons = await readReasons(agents);
    herdrDownSince = null;
    state = reconcile(state, agents, Date.now(), { initial: !initialized, tabs, reasons });
    initialized = true;
    syncCursorWatch();
    pushView();
    scheduleExpiry();
    syncStatusStream();
  } catch (err) {
    herdrDownSince ??= Date.now();
    if (Date.now() - herdrDownSince > MAX_HERDR_DOWN_MS) {
      log('herdr unreachable, exiting:', err.message);
      shutdown();
    }
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}

function requestRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, DEBOUNCE_MS);
}

// --- Event streams ----------------------------------------------------------
// Lifecycle stream is global; agent_status_changed needs a pane_id, so the
// status stream is rebuilt whenever the set of agent panes changes.

const LIFECYCLE = ['pane.created', 'pane.closed', 'pane.exited', 'pane.updated', 'pane.agent_detected'];
let lifecycleStream = null;
let statusStream = null;
let statusKey = '';

function openLifecycleStream() {
  lifecycleStream = subscribe(LIFECYCLE.map((type) => ({ type })), {
    onEvent: requestRefresh,
    onClose: () => {
      lifecycleStream = null;
      setTimeout(openLifecycleStream, POLL_MS);
    },
  });
}

function syncStatusStream() {
  const ids = [...state.keys()].sort();
  const key = ids.join(',');
  if (key === statusKey && statusStream) return;
  statusKey = key;
  statusStream?.close();
  statusStream = null;
  if (ids.length === 0) return;
  const stream = subscribe(ids.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id })), {
    onEvent: requestRefresh,
    onClose: () => {
      if (statusStream === stream) {
        statusStream = null;
        statusKey = '';
      }
    },
  });
  statusStream = stream;
}

// --- Lifecycle --------------------------------------------------------------

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  lifecycleStream?.close();
  statusStream?.close();
  control.close();
  rmSync(CONTROL_SOCKET, { force: true });
  releaseLock();
  overlay.close();
}

function shutdown() {
  cleanup();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', cleanup);

log('started pid', process.pid, 'terminal', TERMINAL_BUNDLE_ID);
openLifecycleStream();
refresh();
setInterval(refresh, POLL_MS);
