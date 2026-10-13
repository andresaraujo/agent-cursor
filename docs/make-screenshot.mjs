// Render the real overlay HTML (src/ui.mjs) with sample views into a demo page.
// Usage: node docs/make-screenshot.mjs ./src/ui.mjs docs/demo.html, then screenshot it served over http.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { buildHtml } = await import(pathToFileURL(resolve(process.argv[2])).href);
const now = Date.now();
const views = {
  pill: { mode: 'pill', counts: { working: 2 }, rows: [
    { name: 'api', agent: 'claude', status: 'working', since: now - 83_000 },
    { name: 'web', agent: 'pi', status: 'working', since: now - 245_000 },
  ] },
  expanded: { mode: 'expanded', counts: {}, rows: [
    { name: 'api', agent: 'claude', status: 'blocked', since: now - 42_000, detail: 'Bash: npm test' },
    { name: 'docs', agent: 'codex', status: 'done', since: now - 10_000 },
    { name: 'web', agent: 'pi', status: 'working', since: now - 245_000 },
  ] },
};
const frame = (v, label) => {
  const doc = buildHtml().replace('</body>', `<script>render(${JSON.stringify(v)})</script></body>`);
  return `<figure><iframe srcdoc="${doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe>
  <svg class="cursor" viewBox="0 0 16 24"><path d="M1 1 L1 19 L6 14 L9 22 L12 21 L9 13 L15 13 Z" fill="#fff" stroke="#000" stroke-width="1.2"/></svg>
  <figcaption>${label}</figcaption></figure>`;
};
writeFileSync(process.argv[3], `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:flex;gap:56px;align-items:center;justify-content:center;
background:radial-gradient(1200px 600px at 20% 10%,#3b4a6b,transparent),radial-gradient(900px 500px at 90% 90%,#5b3b5f,transparent),#1d2230;font-family:system-ui}
figure{zoom:1.7;margin:0;position:relative;display:flex;flex-direction:column;align-items:flex-start}
iframe{border:0;width:420px;height:110px;background:transparent}
.cursor{position:absolute;width:16px;height:24px;left:6px;top:112px}
figcaption{color:rgba(255,255,255,.6);font-size:13px;margin-top:40px}
</style></head><body>${frame(views.pill, 'Agents working: a small pill near the cursor')}${frame(views.expanded, 'Something needs you: rows expand, ⌃⌥J jumps there')}</body></html>`);
