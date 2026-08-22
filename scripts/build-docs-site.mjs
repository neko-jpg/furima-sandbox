import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as viteBuild } from 'vite';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'output/docs-site');
const apiSource = resolve(root, 'docs/api');
const siteSource = resolve(root, 'docs');

const pages = [
  ['browser-api', 'Browser API', 'browser-api.md', '01', 'ブラウザからSandboxを操作するための実行契約。', 'lime'],
  ['listing-flow', 'Listing Flow', 'listing-flow.md', '02', '写真から公開までの出品フローと画面ルール。', 'aqua'],
  ['error-codes', 'Error Codes', 'error-codes.md', '03', '失敗を分類し、安全にリトライするための一覧。', 'coral'],
];

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const slugify = (value, usedIds) => {
  const base = value
    .replaceAll('`', '')
    .replaceAll('*', '')
    .trim()
    .toLocaleLowerCase('ja-JP')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/gu, '') || 'section';
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
};

const inline = (value) => {
  let html = escapeHtml(value);
  html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|\.\.?\/|#)[^)]+)\)/gu, (_match, label, href) => {
    const external = /^https?:\/\//u.test(href);
    return `<a href="${href}"${external ? ' rel="noreferrer"' : ''}>${label}</a>`;
  });
  html = html.replace(/`([^`]+)`/gu, '<code>$1</code>');
  return html;
};

const splitTableRow = (line) => line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);

const renderCodeBlock = (code, language = 'text') => {
  const safeLanguage = language || 'text';
  return `<div class="code-block" data-code-block><div class="code-toolbar"><span class="code-language">${escapeHtml(safeLanguage)}</span><button type="button" class="copy-button" data-copy-code>Copy</button></div><pre><code class="language-${escapeHtml(safeLanguage)}">${escapeHtml(code)}</code></pre></div>`;
};

const renderStateDiagram = (source) => {
  const transitions = source
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.match(/^(.+?)\s+-->\s+([^:]+?)(?::\s*(.+))?$/u))
    .filter(Boolean)
    .map((match) => {
      const label = (value) => value === '[*]' ? 'Start / End' : value;
      return { from: label(match[1].trim()), to: label(match[2].trim()), note: match[3]?.trim() || '' };
    });

  if (!transitions.length) return renderCodeBlock(source, 'mermaid');

  const flow = transitions.map(({ from, to, note }, index) => `<li class="state-flow__item"><span class="state-flow__step">${String(index + 1).padStart(2, '0')}</span><span class="state-node">${inline(from)}</span><span class="state-arrow" aria-hidden="true">→</span><span class="state-node state-node--accent">${inline(to)}</span>${note ? `<span class="state-note">${inline(note)}</span>` : ''}</li>`).join('');
  return `<div class="diagram-card"><div class="diagram-card__header"><span class="eyebrow eyebrow--small">STATE MAP</span><span class="diagram-card__hint">Accessible flow view</span></div><ol class="state-flow">${flow}</ol><details class="source-disclosure"><summary>Mermaidソースを表示</summary>${renderCodeBlock(source, 'mermaid')}</details></div>`;
};

const markdownToHtml = (markdown) => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const result = [];
  const toc = [];
  const usedIds = new Set(['top']);
  let inCode = false;
  let codeLanguage = 'text';
  let code = [];
  let listType = '';
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      result.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (listType) {
      result.push(`</${listType}>`);
      listType = '';
    }
  };

  const openList = (nextType) => {
    if (listType === nextType) return;
    closeList();
    listType = nextType;
    result.push(`<${nextType}>`);
  };

  const renderTable = (startIndex) => {
    const header = splitTableRow(lines[startIndex]);
    const rows = [];
    let index = startIndex + 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      rows.push(splitTableRow(lines[index]));
      index += 1;
    }
    const headHtml = header.map((cell) => `<th scope="col">${inline(cell)}</th>`).join('');
    const rowsHtml = rows.map((row) => `<tr>${header.map((_cell, cellIndex) => `<td>${inline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('');
    result.push(`<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`);
    return index - 1;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/u);
    if (fence) {
      if (inCode) {
        const source = code.join('\n');
        result.push(codeLanguage === 'mermaid' ? renderStateDiagram(source) : renderCodeBlock(source, codeLanguage));
        inCode = false;
        codeLanguage = 'text';
        code = [];
      } else {
        flushParagraph();
        closeList();
        inCode = true;
        codeLanguage = fence[2] || 'text';
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const id = slugify(heading[2], usedIds);
      result.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
      if (level >= 2) toc.push({ id, label: heading[2], level });
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && isTableSeparator(lines[index + 1])) {
      flushParagraph();
      closeList();
      index = renderTable(index);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/u);
    if (bullet) {
      flushParagraph();
      openList('ul');
      result.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/u);
    if (ordered) {
      flushParagraph();
      openList('ol');
      result.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }
    const quote = line.match(/^\s*>\s+(.+)$/u);
    if (quote) {
      flushParagraph();
      closeList();
      result.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }

  if (inCode) {
    const source = code.join('\n');
    result.push(codeLanguage === 'mermaid' ? renderStateDiagram(source) : renderCodeBlock(source, codeLanguage));
  }
  flushParagraph();
  closeList();
  return { html: result.join('\n'), toc };
};

const navItems = (prefix = '') => [
  ['', 'API Reference', `${prefix}index.html`, 'home'],
  ...pages.map(([slug, title]) => [slug, title, `${prefix}api/${slug}.html`, 'guide']),
  ['openapi', 'OpenAPI YAML', `${prefix}api/openapi.yaml`, 'download'],
];

const navLinks = (current = '', prefix = '') => navItems(prefix).map(([slug, title, href, kind]) => `<a class="site-nav__link site-nav__link--${kind}${current === slug ? ' is-active' : ''}" href="${href}"${current === slug ? ' aria-current="page"' : ''}>${escapeHtml(title)}</a>`).join('');

const siteHeader = (current = '', prefix = '') => `<header class="site-header"><div class="site-header__inner"><a class="brand" href="${prefix}index.html" aria-label="Furima Sandbox API Reference ホーム"><span class="brand__mark" aria-hidden="true">F</span><span class="brand__text"><span>Furima Sandbox</span><strong>API REFERENCE</strong></span></a><div class="site-header__desktop"><nav class="site-nav" data-site-nav aria-label="メインナビゲーション">${navLinks(current, prefix)}</nav><span class="header-status"><span class="status-dot" aria-hidden="true"></span>READ-ONLY</span></div><button class="menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="mobile-menu"><span class="sr-only">メニューを開く</span><span aria-hidden="true">MENU</span><span class="menu-button__icon" aria-hidden="true">☰</span></button></div><div class="mobile-menu" id="mobile-menu" data-mobile-menu><nav class="site-nav site-nav--mobile" data-site-nav aria-label="モバイルナビゲーション">${navLinks(current, prefix)}</nav><p class="mobile-menu__note">OpenAPI 3.1を正本にした、チーム共有用の静的リファレンスです。</p></div></header>`;

const baseStyles = `
:root {
  color-scheme: light;
  --ink: #171717;
  --paper: #fffdf4;
  --paper-warm: #f4eedc;
  --paper-deep: #e7ddc5;
  --lime: #c9f45a;
  --aqua: #a7e8ff;
  --coral: #f08a70;
  --yellow: #f5d95a;
  --lavender: #c9b7ff;
  --muted: #5c574e;
  --line: 3px solid var(--ink);
  --shadow: 8px 8px 0 var(--ink);
  --shadow-small: 4px 4px 0 var(--ink);
  --content: 1280px;
  --radius: 0;
}

*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body.docs-page { margin: 0; min-width: 320px; background: var(--paper); color: var(--ink); font: 16px/1.65 "Arial", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; overflow-x: hidden; }
body.docs-page::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: .35; background-image: linear-gradient(rgba(23,23,23,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(23,23,23,.055) 1px, transparent 1px); background-size: 28px 28px; mask-image: linear-gradient(to bottom, #000 0%, transparent 70%); }
body.menu-open { overflow: hidden; }
a { color: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.skip-link { position: fixed; left: 16px; top: 12px; z-index: 100; padding: 10px 14px; background: var(--lime); border: var(--line); box-shadow: var(--shadow-small); transform: translateY(-150%); transition: transform .18s ease; }
.skip-link:focus { transform: translateY(0); }

.site-header { position: sticky; top: 0; z-index: 50; border-bottom: var(--line); background: rgba(255,253,244,.92); backdrop-filter: blur(16px); }
.site-header__inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; max-width: var(--content); min-height: 78px; margin: 0 auto; padding: 12px 28px; }
.brand { display: inline-flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
.brand__mark { display: grid; place-items: center; width: 42px; height: 42px; border: var(--line); background: var(--coral); box-shadow: 4px 4px 0 var(--ink); font: 900 25px/1 "Arial Black", Arial, sans-serif; transform: rotate(-4deg); }
.brand__text { display: grid; gap: 0; font-size: 13px; letter-spacing: .04em; line-height: 1.15; text-transform: uppercase; }
.brand__text strong { font-size: 16px; letter-spacing: .08em; }
.site-header__desktop { display: flex; align-items: center; gap: 22px; }
.site-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.site-nav__link { display: inline-flex; align-items: center; min-height: 38px; padding: 6px 10px; border: 2px solid transparent; font-size: 13px; font-weight: 800; letter-spacing: .01em; text-decoration: none; white-space: nowrap; }
.site-nav__link:hover, .site-nav__link:focus-visible { border-color: var(--ink); background: var(--aqua); box-shadow: 3px 3px 0 var(--ink); outline: none; transform: translate(-1px, -1px); }
.site-nav__link.is-active { border-color: var(--ink); background: var(--lime); box-shadow: 3px 3px 0 var(--ink); }
.site-nav__link--download { background: var(--ink); color: var(--paper); }
.site-nav__link--download:hover, .site-nav__link--download:focus-visible { background: var(--ink); color: var(--paper); }
.header-status { display: inline-flex; align-items: center; gap: 7px; padding: 6px 9px; border: 2px solid var(--ink); background: var(--paper-warm); font-size: 11px; font-weight: 900; letter-spacing: .1em; }
.status-dot { width: 8px; height: 8px; border: 2px solid var(--ink); border-radius: 50%; background: var(--lime); }
.menu-button { display: none; align-items: center; gap: 8px; padding: 9px 11px; border: var(--line); background: var(--lime); box-shadow: var(--shadow-small); font-size: 12px; font-weight: 900; letter-spacing: .08em; }
.menu-button__icon { font-size: 17px; line-height: 1; }
.mobile-menu { display: none; max-width: var(--content); margin: 0 auto; padding: 0 28px 20px; }
.mobile-menu[data-open] { display: block; }
.site-nav--mobile { display: grid; gap: 4px; padding-top: 8px; }
.site-nav--mobile .site-nav__link { justify-content: space-between; min-height: 46px; border: 2px solid var(--ink); background: var(--paper-warm); }
.site-nav--mobile .site-nav__link--download { background: var(--ink); color: var(--paper); }
.mobile-menu__note { margin: 18px 0 0; padding: 12px; border-left: 5px solid var(--coral); color: var(--muted); font-size: 13px; }

.docs-main { max-width: var(--content); margin: 0 auto; padding: 0 28px 80px; }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; margin: 0; color: var(--muted); font-size: 12px; font-weight: 900; letter-spacing: .14em; line-height: 1.3; text-transform: uppercase; }
.eyebrow::before { content: "✳"; display: inline-block; color: var(--coral); font-size: 18px; line-height: 1; }
.eyebrow--small { font-size: 10px; }
.eyebrow--small::before { font-size: 14px; }
.home-hero { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(330px, .88fr); gap: 58px; align-items: center; min-height: 545px; padding: 78px 0 70px; }
.hero-copy { position: relative; z-index: 1; }
.hero-title { max-width: 800px; margin: 22px 0 20px; font: 900 clamp(54px, 8vw, 108px)/.86 "Arial Black", "Arial Narrow", "Hiragino Kaku Gothic ProN", sans-serif; letter-spacing: -.07em; text-transform: uppercase; }
.hero-title span { display: inline-block; padding: 5px 13px 10px; background: var(--yellow); border: var(--line); box-shadow: var(--shadow); transform: rotate(-2deg); }
.hero-lede { max-width: 620px; margin: 0; color: var(--muted); font-size: clamp(17px, 2vw, 21px); line-height: 1.65; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 30px; }
.neo-button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 10px 16px; border: var(--line); box-shadow: var(--shadow-small); font-weight: 900; text-decoration: none; transition: transform .18s ease, box-shadow .18s ease; }
.neo-button:hover, .neo-button:focus-visible { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--ink); outline: none; }
.neo-button:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--ink); }
.neo-button--primary { background: var(--ink); color: var(--paper); }
.neo-button--secondary { background: var(--aqua); }
.neo-button__arrow { font-size: 22px; line-height: .7; }
.hero-poster { position: relative; min-height: 388px; padding: 25px; border: var(--line); background: var(--lavender); box-shadow: 12px 12px 0 var(--ink); transform: rotate(2deg); }
.hero-poster::after { content: ""; position: absolute; right: -18px; bottom: -18px; width: 92px; height: 92px; border: var(--line); background: var(--aqua); box-shadow: 5px 5px 0 var(--ink); transform: rotate(13deg); }
.poster-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; height: 100%; min-height: 338px; }
.poster-block { display: flex; flex-direction: column; justify-content: space-between; padding: 16px; border: var(--line); background: var(--paper); }
.poster-block--wide { grid-column: 1 / -1; background: var(--coral); }
.poster-block--dark { background: var(--ink); color: var(--paper); }
.poster-number { font: 900 clamp(58px, 8vw, 100px)/.8 "Arial Black", Arial, sans-serif; letter-spacing: -.09em; }
.poster-label { font-size: 12px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.poster-copy { max-width: 170px; margin: 0; font-weight: 800; line-height: 1.35; }
.poster-barcode { display: flex; gap: 4px; align-items: end; height: 46px; }
.poster-barcode span { display: block; width: 4px; height: 100%; background: currentColor; }
.poster-barcode span:nth-child(2n) { height: 68%; }
.poster-barcode span:nth-child(3n) { height: 84%; }

.metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 84px; }
.metric-card { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; min-height: 106px; padding: 18px; border: var(--line); box-shadow: var(--shadow-small); background: var(--paper-warm); }
.metric-card:nth-child(2) { background: var(--lime); }
.metric-card:nth-child(3) { background: var(--aqua); }
.metric-value { font: 900 38px/.9 "Arial Black", Arial, sans-serif; letter-spacing: -.07em; }
.metric-label { margin: 0; font-size: 12px; font-weight: 900; line-height: 1.35; text-transform: uppercase; }
.metric-note { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; font-weight: 600; text-transform: none; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.section-heading h2 { margin: 5px 0 0; font: 900 clamp(32px, 5vw, 58px)/.95 "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; letter-spacing: -.06em; text-transform: uppercase; }
.section-heading__side { max-width: 360px; margin: 0; color: var(--muted); font-size: 14px; }
.reference-section { scroll-margin-top: 100px; }
.reference-panel { border: var(--line); box-shadow: var(--shadow); background: var(--paper-warm); }
.reference-bar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 18px; border-bottom: var(--line); background: var(--ink); color: var(--paper); }
.reference-bar__title { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.reference-bar__title::before { content: "◎"; color: var(--lime); font-size: 20px; }
.reference-bar__meta { display: flex; flex-wrap: wrap; justify-content: end; gap: 8px; color: #e9e1d1; font-size: 11px; font-weight: 800; letter-spacing: .06em; }
.reference-bar__meta span { padding: 4px 7px; border: 1px solid currentColor; }
.docs-shell { min-height: 780px; overflow: hidden; background: var(--paper); }
.docs-shell #scalar-api-reference { min-height: 780px; }
.reference-footnote { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 15px 18px; border-top: var(--line); background: var(--yellow); font-size: 13px; }
.reference-footnote p { margin: 0; }
.reference-footnote a { font-weight: 900; }

.guide-section { margin-top: 102px; scroll-margin-top: 100px; }
.guide-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 17px; }
.guide-card { position: relative; display: flex; flex-direction: column; min-height: 245px; padding: 23px; border: var(--line); box-shadow: var(--shadow-small); text-decoration: none; transition: transform .18s ease, box-shadow .18s ease; }
.guide-card:hover, .guide-card:focus-visible { transform: translate(-3px, -3px); box-shadow: 7px 7px 0 var(--ink); outline: none; }
.guide-card--lime { background: var(--lime); }
.guide-card--aqua { background: var(--aqua); }
.guide-card--coral { background: var(--coral); }
.guide-card__number { align-self: end; font: 900 42px/.8 "Arial Black", Arial, sans-serif; letter-spacing: -.1em; }
.guide-card h3 { margin: 25px 0 8px; font: 900 28px/1 "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; letter-spacing: -.05em; text-transform: uppercase; }
.guide-card p { max-width: 320px; margin: 0; font-size: 14px; font-weight: 700; line-height: 1.45; }
.guide-card__arrow { position: absolute; right: 20px; bottom: 18px; font-size: 28px; }
.home-note { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: start; margin-top: 70px; padding: 18px; border: var(--line); background: var(--ink); color: var(--paper); box-shadow: var(--shadow-small); }
.home-note__mark { color: var(--yellow); font-size: 28px; line-height: 1; }
.home-note p { margin: 0; font-size: 13px; }
.home-note strong { color: var(--lime); }

.page-layout { display: grid; grid-template-columns: 245px minmax(0, 1fr); gap: 45px; align-items: start; padding-top: 62px; }
.article-aside { position: sticky; top: 106px; }
.aside-back { display: inline-flex; align-items: center; gap: 7px; margin-bottom: 20px; color: var(--muted); font-size: 12px; font-weight: 900; text-decoration: none; text-transform: uppercase; }
.aside-back:hover, .aside-back:focus-visible { color: var(--ink); text-decoration: underline; outline: none; }
.aside-panel { border: var(--line); box-shadow: var(--shadow-small); background: var(--paper-warm); }
.aside-panel__header { padding: 14px; border-bottom: var(--line); background: var(--yellow); font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.toc { display: grid; gap: 0; padding: 9px; }
.toc a { display: block; padding: 8px 9px; border-left: 3px solid transparent; font-size: 13px; font-weight: 700; line-height: 1.35; text-decoration: none; }
.toc a:hover, .toc a:focus-visible { border-left-color: var(--ink); background: var(--aqua); outline: none; }
.toc a.toc--level-3 { padding-left: 22px; color: var(--muted); font-size: 12px; }
.aside-guides { margin-top: 18px; padding: 14px; border: var(--line); background: var(--ink); color: var(--paper); box-shadow: var(--shadow-small); }
.aside-guides p { margin: 0 0 10px; color: #ddd4c5; font-size: 11px; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
.aside-guides a { display: block; padding: 5px 0; color: var(--paper); font-size: 13px; font-weight: 800; text-decoration: none; }
.aside-guides a:hover, .aside-guides a:focus-visible { color: var(--lime); outline: none; }
.docs-article { min-width: 0; padding: 32px clamp(20px, 5vw, 64px) 56px; border: var(--line); box-shadow: var(--shadow); background: var(--paper); }
.article-kicker { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 15px; border-bottom: 2px solid var(--ink); }
.article-kicker__number { font: 900 28px/.8 "Arial Black", Arial, sans-serif; letter-spacing: -.08em; }
.article-kicker__source { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.markdown-body { max-width: 850px; padding-top: 28px; }
.markdown-body h1 { margin: 0 0 22px; font: 900 clamp(42px, 7vw, 78px)/.9 "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; letter-spacing: -.07em; text-transform: uppercase; }
.markdown-body h2 { margin: 53px 0 18px; padding-top: 18px; border-top: var(--line); font: 900 clamp(25px, 4vw, 38px)/1 "Arial Black", "Hiragino Kaku Gothic ProN", sans-serif; letter-spacing: -.05em; }
.markdown-body h3 { margin: 35px 0 12px; font-size: 21px; line-height: 1.25; }
.markdown-body p { max-width: 760px; margin: 0 0 17px; color: #2a2823; }
.markdown-body a { text-decoration-thickness: 2px; text-underline-offset: 3px; }
.markdown-body a:hover, .markdown-body a:focus-visible { background: var(--yellow); outline: none; }
.markdown-body code { padding: 2px 5px; border: 1px solid var(--ink); background: var(--paper-warm); font: 0.9em/1.35 "SFMono-Regular", Consolas, monospace; }
.markdown-body ul, .markdown-body ol { max-width: 760px; margin: 0 0 20px; padding-left: 25px; }
.markdown-body li { margin: 7px 0; padding-left: 4px; }
.markdown-body li::marker { font-weight: 900; }
.markdown-body blockquote { margin: 22px 0; padding: 16px 20px; border: var(--line); border-left: 10px solid var(--coral); background: var(--aqua); box-shadow: var(--shadow-small); font-weight: 800; }
.code-block { margin: 22px 0 26px; border: var(--line); background: #111; box-shadow: var(--shadow-small); }
.code-toolbar { display: flex; align-items: center; justify-content: space-between; min-height: 38px; padding: 6px 10px; border-bottom: 2px solid var(--paper); background: var(--ink); color: var(--paper); }
.code-language { color: var(--lime); font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.copy-button { padding: 5px 9px; border: 2px solid var(--paper); background: transparent; color: var(--paper); font-size: 11px; font-weight: 900; cursor: pointer; }
.copy-button:hover, .copy-button:focus-visible, .copy-button[data-copied] { background: var(--lime); color: var(--ink); outline: none; }
.code-block pre { max-height: 540px; margin: 0; overflow: auto; padding: 18px; color: #f6f2e8; font: 14px/1.65 "SFMono-Regular", Consolas, monospace; white-space: pre; }
.code-block pre code { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
.table-wrap { margin: 22px 0 28px; overflow-x: auto; border: var(--line); box-shadow: var(--shadow-small); background: var(--paper-warm); }
.table-wrap table { width: 100%; min-width: 580px; border-collapse: collapse; font-size: 14px; }
.table-wrap th, .table-wrap td { padding: 12px 14px; border-bottom: 2px solid var(--ink); border-right: 2px solid var(--ink); vertical-align: top; text-align: left; }
.table-wrap th:last-child, .table-wrap td:last-child { border-right: 0; }
.table-wrap tr:last-child td { border-bottom: 0; }
.table-wrap th { background: var(--yellow); font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.table-wrap td:first-child { font-weight: 900; white-space: nowrap; }
.diagram-card { margin: 24px 0 30px; padding: 17px; border: var(--line); box-shadow: var(--shadow-small); background: var(--lavender); }
.diagram-card__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 12px; border-bottom: 2px solid var(--ink); }
.diagram-card__hint { color: var(--muted); font-size: 11px; font-weight: 800; }
.state-flow { display: grid; gap: 9px; margin: 16px 0 12px !important; padding: 0 !important; list-style: none; }
.state-flow__item { display: grid; grid-template-columns: 32px minmax(92px, auto) 28px minmax(92px, auto) 1fr; gap: 8px; align-items: center; margin: 0 !important; padding: 0 !important; }
.state-flow__step { color: var(--muted); font: 900 11px/1 monospace; }
.state-node { display: inline-block; padding: 7px 10px; border: 2px solid var(--ink); background: var(--paper); font-weight: 900; text-align: center; }
.state-node--accent { background: var(--lime); }
.state-arrow { font-size: 23px; font-weight: 900; text-align: center; }
.state-note { color: var(--muted); font-size: 12px; font-weight: 700; }
.source-disclosure { margin-top: 15px; border-top: 2px solid var(--ink); padding-top: 10px; }
.source-disclosure summary { cursor: pointer; font-size: 12px; font-weight: 900; }
.source-disclosure .code-block { margin-bottom: 0; }
.article-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; margin-top: 48px; padding-top: 16px; border-top: var(--line); color: var(--muted); font-size: 12px; }
.article-footer p { margin: 0; }
.article-footer a { font-weight: 900; }

.site-footer { max-width: var(--content); margin: 0 auto; padding: 24px 28px 42px; }
.site-footer__inner { display: flex; align-items: start; justify-content: space-between; gap: 20px; padding-top: 20px; border-top: var(--line); }
.site-footer p { margin: 0; color: var(--muted); font-size: 12px; }
.site-footer__links { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; font-weight: 900; }
.site-footer__links a:hover, .site-footer__links a:focus-visible { background: var(--yellow); outline: none; }

@media (max-width: 1080px) {
  .site-header__desktop { gap: 10px; }
  .site-nav { gap: 2px; }
  .site-nav__link { padding-inline: 7px; font-size: 12px; }
  .home-hero { gap: 35px; }
}

@media (max-width: 900px) {
  .site-header__desktop { display: none; }
  .menu-button { display: inline-flex; }
  .home-hero { grid-template-columns: 1fr; min-height: unset; padding-top: 58px; }
  .hero-poster { max-width: 620px; width: 100%; margin: 0 auto; transform: rotate(1deg); }
  .metric-grid, .guide-grid { grid-template-columns: 1fr; }
  .metric-card { min-height: 86px; }
  .guide-card { min-height: 210px; }
  .section-heading { display: block; }
  .section-heading__side { margin-top: 12px; }
  .page-layout { grid-template-columns: 1fr; gap: 22px; padding-top: 42px; }
  .article-aside { position: static; }
  .aside-panel { max-width: 680px; }
  .toc { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .aside-guides { display: none; }
}

@media (max-width: 620px) {
  .site-header__inner, .mobile-menu, .docs-main, .site-footer { padding-left: 17px; padding-right: 17px; }
  .site-header__inner { min-height: 68px; }
  .brand__mark { width: 36px; height: 36px; font-size: 21px; }
  .brand__text { font-size: 11px; }
  .brand__text strong { font-size: 13px; }
  .hero-title { font-size: clamp(43px, 12vw, 62px); }
  .hero-title span { padding-inline: 8px; box-shadow: var(--shadow-small); }
  .hero-poster { min-height: 320px; padding: 15px; box-shadow: var(--shadow-small); }
  .poster-grid { min-height: 288px; gap: 8px; }
  .poster-block { padding: 11px; }
  .poster-number { font-size: 56px; }
  .metric-grid { margin-bottom: 60px; }
  .reference-bar, .reference-footnote { align-items: start; flex-direction: column; }
  .reference-bar__meta { justify-content: start; }
  .docs-shell, .docs-shell #scalar-api-reference { min-height: 620px; }
  .page-layout { padding-top: 28px; }
  .docs-article { padding: 23px 17px 38px; box-shadow: var(--shadow-small); }
  .markdown-body h1 { font-size: clamp(39px, 14vw, 62px); }
  .markdown-body h2 { margin-top: 40px; }
  .toc { grid-template-columns: 1fr; }
  .state-flow__item { grid-template-columns: 24px 1fr 22px 1fr; }
  .state-note { grid-column: 2 / -1; }
  .state-node { padding: 6px 7px; font-size: 13px; }
  .site-footer__inner { display: block; }
  .site-footer__links { margin-top: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}

@media print {
  body.docs-page::before, .site-header, .article-aside, .copy-button, .hero-actions, .site-footer__links { display: none !important; }
  .docs-main { max-width: none; padding: 0; }
  .docs-article, .reference-panel, .guide-card { box-shadow: none; }
  .page-layout { display: block; padding: 0; }
  .docs-article { border: 0; }
}
`;

const layout = ({ title, body, current = '', prefix = '', pageType = 'home', head = '', scripts = '' }) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Furima Sandbox API reference — OpenAPI 3.1, Browser API, Listing Flow, and Error Codes"><meta name="theme-color" content="#fffdf4"><link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml"><title>${escapeHtml(title)} | Furima Sandbox API</title>${head}<style>${baseStyles}</style></head><body class="docs-page docs-page--${pageType}"><a class="skip-link" href="#main-content">本文へスキップ</a>${siteHeader(current, prefix)}<main id="main-content" class="docs-main">${body}</main><footer class="site-footer"><div class="site-footer__inner"><p>Furima Sandbox / API Reference<br>OpenAPI 3.1を正本にした、チーム共有用の静的サイト。</p><div class="site-footer__links"><a href="${prefix}index.html#reference">API Reference</a><a href="${prefix}api/openapi.yaml">OpenAPI YAML</a><a href="${prefix}index.html#guides">Guides</a></div></div></footer>${scripts}</body></html>`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'api'), { recursive: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
await copyFile(resolve(apiSource, 'openapi.yaml'), resolve(output, 'api/openapi.yaml'));
await copyFile(resolve(siteSource, 'favicon.svg'), resolve(output, 'favicon.svg'));

await viteBuild({
  configFile: false,
  root,
  base: './',
  publicDir: false,
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

await viteBuild({
  configFile: false,
  root,
  base: './',
  publicDir: false,
  logLevel: 'error',
  build: {
    outDir: output,
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(siteSource, 'site-entry.js'),
      output: {
        entryFileNames: 'assets/site.js',
        chunkFileNames: 'assets/site-[hash].js',
        assetFileNames: 'assets/site-[name]-[hash][extname]',
      },
    },
  },
});

const scalarAssets = await readdir(resolve(output, 'assets'));
if (!scalarAssets.includes('scalar.js') || !scalarAssets.includes('scalar.css') || !scalarAssets.includes('site.js')) {
  throw new Error('[docs:site] Scalar and site assets were not generated');
}

const spec = parseYaml(await readFile(resolve(apiSource, 'openapi.yaml'), 'utf8')) || {};
const paths = spec.paths || {};
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const routeCount = Object.keys(paths).length;
const operationCount = Object.values(paths).reduce((total, pathItem) => total + Object.keys(pathItem || {}).filter((key) => httpMethods.has(key)).length, 0);
const errorMarkdown = await readFile(resolve(apiSource, 'error-codes.md'), 'utf8');
const errorCount = errorMarkdown.split('\n').filter((line) => /^\|\s*[A-Z][A-Z0-9_]*\s*\|/u.test(line)).length;
const specVersion = spec.openapi || 'OpenAPI';

const guideCards = pages.map(([slug, title, , number, description, color]) => `<a class="guide-card guide-card--${color}" href="api/${slug}.html"><span class="guide-card__number" aria-hidden="true">${number}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><span class="guide-card__arrow" aria-hidden="true">↗</span></a>`).join('');
const indexBody = `<section class="home-hero" aria-labelledby="home-title"><div class="hero-copy"><p class="eyebrow">API CONTRACT / FURIMA SANDBOX</p><h1 class="hero-title" id="home-title">Build with<br><span>confidence.</span></h1><p class="hero-lede">出品・メディア参照・Sandboxウォレット・プロフィール・フォロー関係を扱うBrowser APIとHTTP契約を、迷わず読める形にまとめました。</p><div class="hero-actions"><a class="neo-button neo-button--primary" href="#reference">APIを探す <span class="neo-button__arrow" aria-hidden="true">↓</span></a><a class="neo-button neo-button--secondary" href="api/openapi.yaml">OpenAPIを取得 <span class="neo-button__arrow" aria-hidden="true">↗</span></a></div></div><div class="hero-poster" aria-label="Furima Sandbox APIの概要"><div class="poster-grid"><div class="poster-block poster-block--wide"><span class="poster-label">Contract first / Shared truth</span><span class="poster-number">API</span></div><div class="poster-block"><span class="poster-label">Version</span><span class="poster-copy">${escapeHtml(specVersion)}<br>View-only reference</span><div class="poster-barcode" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div></div><div class="poster-block poster-block--dark"><span class="poster-label">Navigate</span><span class="poster-copy">Search. Scan. Ship.</span><span class="poster-label">FURIMA / 2026</span></div></div></div></section><section class="metric-grid" aria-label="APIドキュメントの概要"><div class="metric-card"><span class="metric-value">${routeCount}</span><p class="metric-label">HTTP routes<span class="metric-note">OpenAPI paths</span></p></div><div class="metric-card"><span class="metric-value">${operationCount}</span><p class="metric-label">Operations<span class="metric-note">GET / POST / PUT …</span></p></div><div class="metric-card"><span class="metric-value">${errorCount}</span><p class="metric-label">Error codes<span class="metric-note">Safe failure vocabulary</span></p></div></section><section class="reference-section" id="reference" aria-labelledby="reference-title"><div class="section-heading"><div><p class="eyebrow">01 / SPEC BROWSER</p><h2 id="reference-title">Explore the contract.</h2></div><p class="section-heading__side">左のナビゲーションでタグを選び、検索で操作を絞り込めます。実行ボタンは本番公開時の安全性のため非表示です。</p></div><div class="reference-panel"><div class="reference-bar"><div class="reference-bar__title">Scalar API Reference</div><div class="reference-bar__meta"><span>OPENAPI 3.1</span><span>READ-ONLY</span><span>LOCAL ASSETS</span></div></div><div class="docs-shell"><div id="scalar-api-reference"></div></div><div class="reference-footnote"><p><strong>正本：</strong><code>docs/api/openapi.yaml</code> から生成された参照です。</p><a href="api/openapi.yaml">YAMLを確認する ↗</a></div></div></section><section class="guide-section" id="guides" aria-labelledby="guides-title"><div class="section-heading"><div><p class="eyebrow">02 / FIELD NOTES</p><h2 id="guides-title">Read the guides.</h2></div><p class="section-heading__side">APIを使う順番・ブラウザ実行・エラー対応を、実装チーム向けの補足資料としてまとめています。</p></div><div class="guide-grid">${guideCards}</div></section><aside class="home-note"><span class="home-note__mark" aria-hidden="true">✳</span><p><strong>Source of truth:</strong> API仕様はOpenAPI、補足資料はこのサイトの生成元Markdownです。認証情報・Access設定・内部運用手順は公開サイトへ掲載しません。</p></aside>`;

await writeFile(resolve(output, 'index.html'), layout({
  title: 'API Docs',
  body: indexBody,
  head: '<link rel="stylesheet" href="assets/scalar.css">',
  scripts: '<script type="module" src="assets/scalar.js"></script><script type="module" src="assets/site.js"></script>',
}), 'utf8');

for (const [slug, title, file, number, description] of pages) {
  const markdown = await readFile(resolve(apiSource, file), 'utf8');
  const rendered = markdownToHtml(markdown);
  const toc = rendered.toc.length
    ? `<nav class="toc" aria-label="このページの目次">${rendered.toc.map(({ id, label, level }) => `<a class="toc--level-${level}" href="#${id}">${inline(label)}</a>`).join('')}</nav>`
    : '<p class="mobile-menu__note">このページに目次はありません。</p>';
  const sideGuides = pages.map(([pageSlug, pageTitle, , pageNumber]) => `<a href="${pageSlug === slug ? `#${rendered.toc[0]?.id || 'top'}` : `../api/${pageSlug}.html`}"${pageSlug === slug ? ' aria-current="page"' : ''}>${pageNumber} / ${escapeHtml(pageTitle)}</a>`).join('');
  const body = `<div class="page-layout"><aside class="article-aside"><a class="aside-back" href="../index.html#guides">← API Referenceへ戻る</a><div class="aside-panel"><div class="aside-panel__header">On this page</div>${toc}</div><div class="aside-guides"><p>Field notes</p>${sideGuides}</div></aside><article class="docs-article"><div class="article-kicker"><span class="article-kicker__number">${number}</span><span class="article-kicker__source">Source / docs/api/${escapeHtml(file)}</span></div><div class="markdown-body">${rendered.html}</div><footer class="article-footer"><p>${escapeHtml(description)}</p><a href="../index.html#reference">OpenAPIリファレンスを見る ↗</a></footer></article></div>`;
  await writeFile(resolve(output, `api/${slug}.html`), layout({
    title,
    body,
    current: slug,
    prefix: '../',
    pageType: 'article',
    scripts: '<script type="module" src="../assets/site.js"></script>',
  }), 'utf8');
}

await writeFile(resolve(output, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
`);

console.log(`[docs:site] generated neo-brutalist Scalar, ${pages.length} guide pages, OpenAPI YAML, and security headers at ${output}`);
