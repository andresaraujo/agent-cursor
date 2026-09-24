import { basename } from 'node:path';

export const DONE_MS = 4000;

const ACTIVE = new Set(['working', 'blocked']);
const ORDER = { blocked: 0, done: 1, working: 2 };

function projectOf(agent) {
  const cwd = agent.foreground_cwd || agent.cwd || '';
  return basename(cwd) || agent.agent || 'agent';
}

// Terminal title is the only free-form detail herdr gives; drop it when it just
// repeats the project or agent name (e.g. pi's "π - quick_chat").
function titleOf(agent, project) {
  const title = (agent.terminal_title_stripped || '').trim();
  if (!title) return '';
  if (title.includes(project)) return '';
  if (agent.agent && title.toLowerCase() === agent.agent.toLowerCase()) return '';
  return title;
}

// Display names: herdr agent name if set, else project; projects shared by
// several panes get the tab label ("lekey/4"), then the pane number if still ambiguous.
// Computed over all agents so a name doesn't change as other panes go idle.
export function labels(agents, tabs = new Map()) {
  const base = new Map();
  for (const a of agents) base.set(a.pane_id, a.name?.trim() || projectOf(a));
  const groups = new Map();
  for (const [id, name] of base) groups.set(name, [...(groups.get(name) ?? []), id]);

  const out = new Map();
  for (const [name, ids] of groups) {
    if (ids.length === 1) {
      out.set(ids[0], name);
      continue;
    }
    const withTab = ids.map((id) => {
      const a = agents.find((x) => x.pane_id === id);
      return [id, `${name}/${tabs.get(a.tab_id) ?? a.tab_id?.split(':t')[1] ?? '?'}`];
    });
    const counts = new Map();
    for (const [, n] of withTab) counts.set(n, (counts.get(n) ?? 0) + 1);
    for (const [id, n] of withTab) out.set(id, counts.get(n) > 1 ? `${n}.${id.split(':p')[1]}` : n);
  }
  return out;
}

// Merge a fresh agent.list into the previous per-pane state.
// `initial` suppresses showing panes that were already done before we started.
// `reasons` maps pane_id → blocked prompt summary.
export function reconcile(prev, agents, now, { initial = false, tabs, reasons = new Map() } = {}) {
  const names = labels(agents, tabs);
  const next = new Map();
  for (const agent of agents) {
    const id = agent.pane_id;
    const status = agent.agent_status || 'unknown';
    const old = prev.get(id);
    const project = projectOf(agent);
    const row = {
      id,
      agent: agent.agent || '',
      name: names.get(id),
      title: titleOf(agent, project),
      reason: status === 'blocked' ? reasons.get(id) ?? old?.reason ?? '' : '',
      status,
      focused: !!agent.focused,
      since: old && old.status === status ? old.since : now,
      finishedAt: old?.finishedAt ?? 0,
      seenAt: old?.seenAt ?? null,
      visitedAt: old?.visitedAt ?? 0,
    };
    if (old && !old.focused && row.focused) row.visitedAt = now;
    const wasActive = old ? ACTIVE.has(old.status) : false;
    // Finish on done, or on working→idle (herdr skips done for focused panes).
    // Unseen until the user moves the mouse or focuses the pane.
    if (!initial && wasActive && (status === 'done' || status === 'idle')) {
      row.finishedAt = now;
      row.seenAt = null;
    }
    if (ACTIVE.has(status)) {
      row.finishedAt = 0;
      row.seenAt = null;
    }
    if (row.finishedAt && row.seenAt === null && old && !old.focused && row.focused) row.seenAt = now;
    next.set(id, row);
  }
  return next;
}

export function hasUnseen(state) {
  for (const row of state.values()) if (row.finishedAt && row.seenAt === null) return true;
  return false;
}

// User is back (mouse moved): start the countdown on every unseen done row.
export function markSeen(state, now) {
  const next = new Map(state);
  for (const [id, row] of next) {
    if (row.finishedAt && row.seenAt === null) next.set(id, { ...row, seenAt: now });
  }
  return next;
}

function displayStatus(row, now) {
  if (ACTIVE.has(row.status)) return row.status;
  if (row.finishedAt && (row.seenAt === null || now - row.seenAt < DONE_MS)) return 'done';
  return null;
}

// Pure view model sent to the UI. mode: hidden | pill | expanded.
export function view(state, now) {
  const rows = [];
  for (const row of state.values()) {
    const status = displayStatus(row, now);
    if (!status) continue;
    rows.push({
      id: row.id,
      agent: row.agent,
      name: row.name,
      detail: status === 'blocked' && row.reason ? row.reason : row.title,
      status,
      since: status === 'done' ? row.finishedAt : row.since,
    });
  }
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.since - b.since);
  const counts = { blocked: 0, working: 0, done: 0 };
  for (const r of rows) counts[r.status]++;
  const mode = rows.length === 0 ? 'hidden' : counts.blocked || counts.done ? 'expanded' : 'pill';
  return { mode, counts, rows };
}

// Where "jump" should go, best first, independent of what the overlay shows:
// blocked (longest waiting) → finished but not visited since (newest; includes
// herdr "done" from before we started) → the most recently finished as fallback.
export function jumpTargets(state) {
  const rows = [...state.values()];
  const blocked = rows.filter((r) => r.status === 'blocked').sort((a, b) => a.since - b.since);
  const finishedAt = (r) => r.finishedAt || r.since;
  const unvisited = rows
    .filter((r) => r.status === 'done' || (r.finishedAt && !ACTIVE.has(r.status) && r.visitedAt < r.finishedAt))
    .sort((a, b) => finishedAt(b) - finishedAt(a));
  const targets = [...blocked, ...unvisited];
  if (targets.length === 0) {
    const last = rows.filter((r) => !ACTIVE.has(r.status) && r.finishedAt).sort((a, b) => b.finishedAt - a.finishedAt)[0];
    if (last) targets.push(last);
  }
  return targets.map((r) => r.id);
}

// Next time the view changes on its own (a seen done row expiring), or null.
export function nextExpiry(state, now) {
  let next = null;
  for (const row of state.values()) {
    if (!row.finishedAt || row.seenAt === null || ACTIVE.has(row.status)) continue;
    const at = row.seenAt + DONE_MS;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}
