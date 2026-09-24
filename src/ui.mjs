// Overlay window HTML. The daemon calls render(view) with the output of state.view().
export function buildHtml() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: transparent !important;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 600;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100vh;
}
#pill {
  width: fit-content;
  background: rgba(0,0,0,0.5);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-radius: 10px;
  padding: 4px 0;
  opacity: 0;
  transition: opacity 0.25s ease-out;
}
.row { display: flex; align-items: center; gap: 6px; padding: 3px 12px; white-space: nowrap; }
.row + .row { border-top: 1px solid rgba(255,255,255,0.08); }
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.blocked .dot { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.project { color: rgba(255,255,255,0.96); }
.agent { color: rgba(255,255,255,0.55); font-weight: 500; }
.sep { color: rgba(255,255,255,0.4); }
.status { color: rgba(255,255,255,0.92); }
.blocked .status { color: #FCA5A5; }
.meta, .detail {
  color: rgba(255,255,255,0.7);
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 10px;
  font-weight: 500;
}
.summary span + span::before { content: '·'; color: rgba(255,255,255,0.4); margin: 0 5px; }
</style>
</head>
<body>
<div id="pill"></div>
<script>
const COLOR = { blocked: '#EF4444', working: '#F59E0B', done: '#22C55E' };
const LABEL = { blocked: 'Blocked', working: 'Working', done: 'Done' };
let current = { mode: 'hidden', rows: [], counts: {} };
let tick = null;

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function trunc(v, max) {
  const s = String(v || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function elapsed(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's';
}

function dot(status) {
  return '<span class="dot" style="background:' + COLOR[status] + '"></span>';
}

function rowHtml(r) {
  const parts = [
    dot(r.status),
    '<span class="project">' + esc(trunc(r.name, 28)) + '</span>',
    '<span class="agent">' + esc(r.agent) + '</span>',
    '<span class="sep">·</span>',
    '<span class="status">' + LABEL[r.status] + '</span>',
  ];
  if (r.status !== 'done') parts.push('<span class="meta">' + elapsed(r.since) + '</span>');
  if (r.detail) parts.push('<span class="sep">·</span><span class="detail">' + esc(trunc(r.detail, 48)) + '</span>');
  return '<div class="row ' + r.status + '">' + parts.join('') + '</div>';
}

const PILL_MAX_ROWS = 4;

// One agent: its full row. Several: one compact line each (no title), capped.
function pillHtml(v) {
  if (v.rows.length === 1) return rowHtml(v.rows[0]);
  const lines = v.rows.slice(0, PILL_MAX_ROWS).map((r) =>
    '<div class="row working">' + dot('working') +
    '<span class="project">' + esc(trunc(r.name, 24)) + '</span>' +
    '<span class="agent">' + esc(r.agent) + '</span>' +
    '<span class="meta">' + elapsed(r.since) + '</span></div>'
  );
  const more = v.rows.length - PILL_MAX_ROWS;
  if (more > 0) lines.push('<div class="row"><span class="agent">+' + more + ' more working</span></div>');
  return lines.join('');
}

// Transient message (e.g. jump with nothing to jump to); wins over the view.
let flashText = '';
let flashUntil = 0;

function flash(text) {
  flashText = text;
  flashUntil = Date.now() + 1500;
  paint();
  setTimeout(paint, 1550);
}

function paint() {
  const pill = document.getElementById('pill');
  if (Date.now() < flashUntil) {
    pill.innerHTML = '<div class="row">' + dot('done') + '<span class="status">' + esc(flashText) + '</span></div>';
    pill.style.opacity = '1';
    return;
  }
  if (current.mode === 'hidden') {
    pill.style.opacity = '0';
    return;
  }
  pill.innerHTML = current.mode === 'pill' ? pillHtml(current) : current.rows.map(rowHtml).join('');
  pill.style.opacity = '1';
}

function render(v) {
  current = v;
  paint();
  if (v.mode === 'hidden' && tick) { clearInterval(tick); tick = null; }
  if (v.mode !== 'hidden' && !tick) tick = setInterval(paint, 1000);
}
</script>
</body>
</html>`;
}
