import { access, cp, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'docs/wiki');
const checkOnly = process.argv.includes('--check');
const syncOnly = process.argv.includes('--sync');
const required = ['Home.md', 'API-Overview.md', 'Browser-API.md', 'Catalog-API.md', 'Sandbox-State-API.md', 'Listing-Flow.md', 'Error-Codes.md', 'Media-and-Drafts.md', 'Local-Development.md', 'Release-Runbook.md', '_Sidebar.md', '_Footer.md'];
const mirroredPages = [
  ['docs/api/browser-api.md', 'Browser-API.md'],
  ['docs/api/listing-flow.md', 'Listing-Flow.md'],
  ['docs/api/error-codes.md', 'Error-Codes.md'],
];

if (syncOnly) {
  for (const [sourceFile, wikiFile] of mirroredPages) {
    await copyFile(resolve(root, sourceFile), resolve(source, wikiFile));
  }
  console.log(`[wiki] synchronized ${mirroredPages.length} API guide pages from docs/api`);
}

for (const file of required) {
  await access(join(source, file));
  const text = await readFile(join(source, file), 'utf8');
  if (!text.trim()) throw new Error(`[wiki] empty page: ${file}`);
  if (/\]\(\.\.\//u.test(text)) throw new Error(`[wiki] repository-relative link is not portable in GitHub Wiki: ${file}`);
}
for (const [sourceFile, wikiFile] of mirroredPages) {
  const sourceText = await readFile(resolve(root, sourceFile), 'utf8');
  const wikiText = await readFile(join(source, wikiFile), 'utf8');
  const normalizeLineEndings = (text) => text.replaceAll('\r\n', '\n');
  if (normalizeLineEndings(sourceText) !== normalizeLineEndings(wikiText)) throw new Error(`[wiki] mirrored page drift: ${wikiFile} must exactly match ${sourceFile}`);
}
if (checkOnly) { console.log(`[wiki] checked ${required.length} source pages`); process.exit(0); }
if (syncOnly) { console.log(`[wiki] synchronized and checked ${mirroredPages.length} API guide pages; remote publish skipped`); process.exit(0); }

const { stdout: remote } = await exec('git', ['remote', 'get-url', 'origin'], { cwd: root });
const match = remote.trim().match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/u);
if (!match) throw new Error('[wiki] origin must be a GitHub repository');
const wikiUrl = `https://github.com/${match[1]}/${match[2]}.wiki.git`;
const temp = await mkdtemp(join(tmpdir(), 'furima-wiki-'));
try {
  await exec('git', ['clone', wikiUrl, temp], { cwd: root });
  for (const file of required) await cp(join(source, file), join(temp, file), { force: true });
  await exec('git', ['add', ...required], { cwd: temp });
  const { stdout: diff } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: temp });
  if (!diff.trim()) { console.log('[wiki] no changes to publish'); process.exit(0); }
  await exec('git', ['-c', 'user.name=Furima Docs Bot', '-c', 'user.email=docs@furima.invalid', 'commit', '-m', 'docs: update team wiki'], { cwd: temp });
  await exec('git', ['push', 'origin', 'HEAD'], { cwd: temp });
  console.log(`[wiki] published ${required.length} pages to ${wikiUrl}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
