import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
const deletedFiles = new Set([
  ...execFileSync('git', ['diff', '--name-only', '--diff-filter=D', '-z'], { cwd: root }).toString('utf8').split('\0'),
  ...execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=D', '-z'], { cwd: root }).toString('utf8').split('\0'),
].filter(Boolean));
const forbiddenPath = /^(?:\.playwright-cli(?:[\\/]|$)|(?:\.next|\.vinext|\.wrangler|dist|output|outputs|test-results)(?:[\\/]|$))/u;
const localPath = /(?:[A-Za-z]:[\\/](?:Users|development|workspace|home|tmp|var)[^\s"']*|(?:^|["'\s])\/(?:Users|home|mnt|private|tmp|var|development)\/[^\s"']*)/iu;
const textExtensions = new Set(['.env', '.json', '.md', '.txt', '.yaml', '.yml']);
const failures = [];
const warnings = [];

for (const file of trackedFiles) {
  if (forbiddenPath.test(file.replaceAll('\\', '/'))) failures.push(`${file}: local/generated artifact is tracked`);
  const absolute = resolve(root, file);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    if (deletedFiles.has(file)) {
      warnings.push(`${file}: tracked file is intentionally deleted in the current worktree`);
      continue;
    }
    failures.push(`${file}: tracked file is missing from the working tree`);
    continue;
  }
  if (stats.size > 10 * 1024 * 1024) warnings.push(`${file}: ${(stats.size / 1024 / 1024).toFixed(1)} MiB`);
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const text = readFileSync(absolute, 'utf8');
  if (localPath.test(text)) failures.push(`${file}: local absolute path detected`);
}

for (const manifestPath of ['public/images/products/pexels-selected/manifest.json', 'docs/reference-assets/pexels-review/review-manifest.json']) {
  if (!trackedFiles.includes(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
  const serialized = JSON.stringify(manifest);
  if (/"(?:absolutePath|selectedPath|sourcePath|sourceFolder)"/u.test(serialized)) failures.push(`${manifestPath}: source-local path field detected`);
  if (localPath.test(serialized)) failures.push(`${manifestPath}: local absolute path detected`);
}

if (failures.length) {
  console.error('[share:check] failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[share:check] tracked files=${trackedFiles.length}, warnings=${warnings.length}`);
}
for (const warning of warnings) console.warn(`[share:check] warning: ${warning}`);
