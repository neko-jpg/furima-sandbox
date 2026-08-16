import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'docs/wiki');
const checkOnly = process.argv.includes('--check');
const required = ['Home.md', 'API-Overview.md', 'Browser-API.md', 'Catalog-API.md', 'Sandbox-State-API.md', 'Listing-Flow.md', 'Media-and-Drafts.md', 'Local-Development.md', 'Release-Runbook.md', '_Sidebar.md', '_Footer.md'];

for (const file of required) {
  await access(join(source, file));
  const text = await readFile(join(source, file), 'utf8');
  if (!text.trim()) throw new Error(`[wiki] empty page: ${file}`);
}
if (checkOnly) { console.log(`[wiki] checked ${required.length} source pages`); process.exit(0); }

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
