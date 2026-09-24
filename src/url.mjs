// agent-cursor:// URLs → CLI commands. Any web page can open a URL scheme, so
// only a fixed set of harmless actions is accepted and arguments are validated.
//
//   agent-cursor://jump                 next blocked/done agent
//   agent-cursor://focus/w6:p4          focus a pane (also ?pane=w6:p4)
//   agent-cursor://toggle | start | stop

export const SCHEME = 'agent-cursor:';
const PANE_ID = /^w\d+:p\d+$/;
const SIMPLE = new Set(['jump', 'toggle', 'start', 'stop']);

// Returns { cmd, args } or throws with a user-facing message.
export function parseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid url: ${raw}`);
  }
  if (url.protocol !== SCHEME) throw new Error(`unsupported scheme: ${url.protocol}`);
  // agent-cursor://jump parses "jump" as host; agent-cursor:jump as pathname.
  const parts = [url.host, ...url.pathname.split('/')].filter(Boolean).map(decodeURIComponent);
  const [action, ...rest] = parts;
  if (SIMPLE.has(action) && rest.length === 0) return { cmd: action, args: [] };
  if (action === 'focus') {
    const pane = rest[0] ?? url.searchParams.get('pane');
    if (!pane || !PANE_ID.test(pane)) throw new Error(`focus needs a pane id like w1:p2, got: ${pane ?? 'nothing'}`);
    return { cmd: 'focus', args: [pane] };
  }
  throw new Error(`unknown action: ${action ?? '(none)'}`);
}

export function isPaneId(value) {
  return PANE_ID.test(value ?? '');
}
