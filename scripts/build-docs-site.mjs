import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';

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

const inline = (value) => escapeHtml(value)
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/gu, '<a href="$2" rel="noreferrer">$1</a>')
  .replace(/`([^`]+)`/gu, '<code>$1</code>');

const markdownToHtml = (markdown) => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const result = [];
  let inCode = false;
  let code = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      result.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^(```|~~~)/u);
    if (fence) {
      if (inCode) {
        result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      closeList();
      const level = heading[1].length;
      result.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.+)$/u);
    if (bullet) {
      if (!listOpen) {
        result.push('<ul>');
        listOpen = true;
      }
      result.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    closeList();
    result.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) result.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  closeList();
  return result.join('\n');
};

const nav = (current = '', prefix = '') => `<nav><a href="${prefix}index.html">API Docs</a>${pages.map(([slug, title]) => `<a class="${current === slug ? 'active' : ''}" href="${prefix}api/${slug}.html">${title}</a>`).join('')}<a href="${prefix}api/openapi.yaml">OpenAPI YAML</a></nav>`;

const baseStyles = `:root{color-scheme:dark;--bg:#15171a;--panel:#202329;--line:#39404a;--text:#eef3f7;--muted:#aeb9c5;--blue:#7bd7ff}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}header,main{max-width:1120px;margin:auto;padding:24px}header{padding-bottom:8px}h1{font-size:32px;line-height:1.25}h2{margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:8px}h3{margin-top:1.6em}p{color:var(--muted)}a{color:var(--blue)}nav{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}nav a{border:1px solid var(--line);border-radius:8px;padding:7px 11px;text-decoration:none}nav a.active{background:#173d51;border-color:#4b9fc6;color:#fff}pre{overflow:auto;border:1px solid var(--line);border-radius:10px;background:#0d0f12;padding:16px;color:#e7edf2}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#d4f0ff}.card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:18px;margin:14px 0}.small{font-size:13px;color:var(--muted)}footer{max-width:1120px;margin:auto;padding:24px;color:var(--muted);border-top:1px solid var(--line)}.scalar-shell{margin:16px 0 28px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#11151a;min-height:720px}.scalar-shell #scalar-api-reference{min-height:720px}`;

const layout = (title, body, current = '', prefix = '', head = '', scripts = '') => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Furima Sandbox API reference"><title>${escapeHtml(title)} | Furima Sandbox API</title>${head}<style>${baseStyles}</style></head><body><header><div class="small">Furima Sandbox / API Reference</div>${nav(current, prefix)}</header><main>${body}</main><footer>OpenAPI YAMLと型定義はprivate repository内のdocs/apiを正本とします。</footer>${scripts}</body></html>`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'api'), { recursive: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
await copyFile(resolve(apiSource, 'openapi.yaml'), resolve(output, 'api/openapi.yaml'));

await viteBuild({
  configFile: false,
  root,
  base: './',
  logLevel: 'error',
  build: {
    outDir: output,
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(root, 'docs/scalar-entry.js'),
      output: {
        entryFileNames: 'assets/scalar.js',
        chunkFileNames: 'assets/scalar-[hash].js',
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css')
          ? 'assets/scalar.css'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
});

const scalarAssets = await readdir(resolve(output, 'assets'));
if (!scalarAssets.includes('scalar.js') || !scalarAssets.includes('scalar.css')) {
  throw new Error('[docs:site] Scalar assets were not generated');
}

const cards = pages.map(([slug, title]) => `<div class="card"><h2><a href="api/${slug}.html">${title}</a></h2><p>チーム向けのAPI契約と利用例を確認します。</p></div>`).join('');
const indexBody = `<h1>Furima Sandbox API</h1><p>出品・メディア参照・Sandboxウォレット・プロフィール・フォロー関係を扱うBrowser APIとHTTP契約です。</p><div class="scalar-shell"><div id="scalar-api-reference"></div></div><div class="card"><h2><a href="api/openapi.yaml">OpenAPI 3.1 YAML</a></h2><p>リポジトリの <code>docs/api/openapi.yaml</code> から生成した契約正本です。</p></div>${cards}<p class="small">このPagesサイトにはAPI参照だけを掲載します。内部の復旧手順、Access設定、個人情報、secret値はGitHub Wikiを参照してください。</p>`;
await writeFile(resolve(output, 'index.html'), layout('API Docs', indexBody, '', '', '<link rel="stylesheet" href="assets/scalar.css">', '<script type="module" src="assets/scalar.js"></script>'), 'utf8');

for (const [slug, title, file] of pages) {
  const markdown = await readFile(resolve(apiSource, file), 'utf8');
  await writeFile(resolve(output, `api/${slug}.html`), layout(title, markdownToHtml(markdown), slug, '../'), 'utf8');
}

await writeFile(resolve(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
`);

console.log(`[docs:site] generated Scalar, ${pages.length} HTML pages, OpenAPI YAML, and security headers at ${output}`);
