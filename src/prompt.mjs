// Extract a short "what does the agent want" line from a blocked pane's screen.
// Heuristic, agent-agnostic: find the last question on screen; if it's a generic
// permission question ("Do you want to proceed?"), describe what it's about instead.

const BORDER_ONLY = /^[\s─━═│┃║╭╮╰╯┌┐└┘├┤┬┴┼\-_=|+]*$/;
const EDGE_BORDERS = /^[│┃║|]\s?|\s?[│┃║|]$/g;
const OPTION = /^(?:[❯>›▶●○◯]\s*)?(?:\d+[.)]|\[[ xX]?\]|\(?[yYnN]\)?\/)\s*/;
const HINT = /\b(esc|enter|tab|ctrl\+|shift\+)\b.*\b(cancel|confirm|select|navigate|submit|to)\b/i;
const TIP = /^(tip|hint|note):/i;
const GENERIC_QUESTION = /^(do you want to (proceed|continue|make this edit|allow)|allow( this)?|proceed|continue|approve)\b.*\?$/i;

const MAX_LEN = 72;

function clean(line) {
  return line.replace(EDGE_BORDERS, '').replace(/\s+/g, ' ').trim();
}

function meaningful(line) {
  return line && !BORDER_ONLY.test(line) && !OPTION.test(line) && !HINT.test(line) && !TIP.test(line);
}

function shorten(text) {
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text;
}

// Questions keep their end ("…should I use for the cache?"), which carries the ask.
function shortenQuestion(text) {
  return text.length > MAX_LEN ? `…${text.slice(-(MAX_LEN - 1))}` : text;
}

// A question starting lowercase is a wrapped continuation; pull in the line above.
function fullQuestion(lines, q) {
  let text = lines[q];
  for (let i = q - 1; i >= 0 && /^[a-z]/.test(text) && meaningful(lines[i]); i--) text = `${lines[i]} ${text}`;
  return text;
}

export function blockedReason(screen) {
  if (!screen) return '';
  const lines = screen.split('\n').map(clean);

  let q = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (meaningful(lines[i]) && lines[i].endsWith('?')) { q = i; break; }
  }
  // No question on screen: nothing reliable to say (last lines are usually status bars).
  if (q < 0) return '';

  const question = fullQuestion(lines, q);
  if (!GENERIC_QUESTION.test(question)) return shortenQuestion(question);

  // Generic question: use the block above it, e.g. "Bash command" + "npm test".
  const context = [];
  for (let i = q - 1; i >= 0 && context.length < 6; i--) {
    if (!lines[i]) {
      if (context.length && !lines[i - 1]) break; // two blank lines end the block
      continue;
    }
    if (BORDER_ONLY.test(lines[i])) break;
    if (meaningful(lines[i])) context.unshift(lines[i]);
  }
  if (context.length === 0) return shorten(question);
  const [header, subject] = context;
  return shorten(subject ? `${header.replace(/\s+command$/i, '')}: ${subject}` : header);
}
