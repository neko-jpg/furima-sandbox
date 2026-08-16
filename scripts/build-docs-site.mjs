import { mkdir, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'output/docs-site');
const apiSource = resolve(root, 'docs/api');

const pages = [
  ['browser-api', 'Browser API', 'browser-api.md'],
  ['listing-flow', 'Listing Flow', 'listing-flow.md'],
  ['error-codes', 'Error Codes', 'error-codes.md'],
];

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const inline = (value) => escapeHtml(value).replace(/\[([^\]]+)\]\((https?:[^)]+)\)/gu, '<a href="$2" rel="noreferrer">$1</a>').replace(/`([^`]+)`/gu, '<code>$1</code>');

const markdownToHtml = (markdown) => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const result = [];
  let inCode = false;
  let code = [];
  let listOpen = false;
  const closeList = () => { if (listOpen) { result.push('</ul>'); listOpen = false; } };
  for (const line of lines) {
    const fence = line.match(/^(```|~~~)/u);
    if (fence) {
      if (inCode) { result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; inCode = false; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(line); continue; }
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) { closeList(); const level = heading[1].length; result.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    const bullet = line.match(/^\s*-\s+(.+)$/u);
    if (bullet) { if (!listOpen) { result.push('<ul>'); listOpen = true; } result.push(`<li>${inline(bullet[1])}</li>`); continue; }
    closeList();
    result.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  closeList();
  return result.join('\n');
};

const nav = (current = '') => `<nav><a href="../index.html">API Docs</a>${pages.map(([slug, title]) => `<a class="${current === slug ? 'active' : ''}" href="${slug}.html">${title}</a>`).join('')}<a href="openapi.yaml">OpenAPI YAML</a></nav>`;
const layout = (title, body, current = '') => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | Furima Sandbox API</title><style> :root{color-scheme:dark;--bg:#15171a;--panel:#202329;--line:#39404a;--text:#eef3f7;--muted:#aeb9c5;--blue:#7bd7ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}header,main{max-width:1120px;margin:auto;padding:24px}header{padding-bottom:8px}h1{font-size:32px;line-height:1.25}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:8px}h3{margin-top:1.6em}p{color:var(--muted)}a{color:var(--blue)}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}nav a{border:1px solid var(--line);border-radius:8px;padding:7px 11px;text-decoration:none}nav a.active{background:#173d51;border-color:#4b9fc6;color:#fff}pre{overflow:auto;border:1px solid var(--line);border-radius:10px;background:#0d0f12;padding:16px;color:#e7edf2}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#d4f0ff}.card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:18px;margin:14px 0}.small{font-size:13px;color:var(--muted)}footer{max-width:1120px;margin:auto;padding:24px;color:var(--muted);border-top:1px solid var(--line)}</style></head><body><header><div class="small">Furima Sandbox / API Reference</div>${nav(current)}</header><main>${body}</main><footer>OpenAPI YAMLと型定義はprivate repository内のdocs/apiを正本とします。</footer></body></html>`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'api'), { recursive: true });
await mkdir(resolve(output, 'api'), { recursive: true });
await copyFile(resolve(apiSource, 'openapi.yaml'), resolve(output, 'api/openapi.yaml'));

const cards = pages.map(([slug, title]) => `<div class="card"><h2><a href="api/${slug}.html">${title}</a></h2><p>チーム向けのAPI契約と利用例を確認します。</p></div>`).join('');
const indexBody = `<h1>Furima Sandbox API</h1><p>出品・メディア参照・Sandboxウォレット・プロフィール・フォロー関係を扱うBrowser APIとHTTP契約です。</p><div class="card"><h2><a href="api/openapi.yaml">OpenAPI 3.1 YAML</a></h2><p>リポジトリの <code>docs/api/openapi.yaml</code> から生成した契約正本です。</p></div>${cards}<p class="small">このPagesサイトは公開しても問題ないAPI参照だけを含みます。privateな運用手順はGitHub Wikiを参照してください。</p>`;
await writeFile(resolve(output, 'index.html'), layout('API Docs', indexBody), 'utf8');

for (const [slug, title, file] of pages) {
  const markdown = await readFile(resolve(apiSource, file), 'utf8');
  await writeFile(resolve(output, `api/${slug}.html`), layout(title, markdownToHtml(markdown), slug), 'utf8');
}

console.log(`[docs:site] generated ${pages.length + 1} HTML pages and OpenAPI YAML at ${output}`);
