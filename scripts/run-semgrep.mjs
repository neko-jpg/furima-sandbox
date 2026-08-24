import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const findWindowsSemgrep = () => {
  if (process.platform !== 'win32') return null;
  const roots = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Python') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Python') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : null,
  ].filter(Boolean);
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(root, entry.name, 'Scripts', 'semgrep.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
};

const executable = process.platform === 'win32' ? findWindowsSemgrep() ?? 'semgrep.exe' : 'semgrep';
const executableDirectory = path.dirname(executable);
const env = executableDirectory !== '.'
  ? { ...process.env, PATH: `${executableDirectory}${path.delimiter}${process.env.PATH ?? ''}` }
  : process.env;
const config = path.resolve('semgrep/furima.yml');
const result = spawnSync(executable, ['--config', config, '--no-git-ignore', '--error', 'app'], { stdio: 'inherit', windowsHide: true, env });
if (result.error?.code === 'ENOENT') {
  const message = '[semgrep] semgrep is not installed; install Semgrep before running the static security gate.';
  if (process.env.CI === 'true') {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Local runs may use the contract test instead.`);
  process.exit(0);
}
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

// Prove the gate itself is live. Semgrep normally exits zero when it merely
// reports findings unless --error is set; this canary prevents that option or
// the critical browser-boundary rules from being removed unnoticed.
const canaryRoot = await mkdtemp(path.join(tmpdir(), 'furima-semgrep-canary-'));
try {
  const canaryDirectory = path.join(canaryRoot, 'app', 'context');
  await mkdir(canaryDirectory, { recursive: true });
  await writeFile(path.join(canaryDirectory, 'MercariContext.tsx'), `
declare const SANDBOX_CONTROL_OPTIONS: unknown;
declare global { interface Window { __SHOP_API__?: unknown } }
export const Canary = () => <div dangerouslySetInnerHTML={{ __html: '<b>unsafe</b>' }} />;
const controlToken = 'FURIMA_D1_CONTROL_TOKEN';
window.__SHOP_API__ = SANDBOX_CONTROL_OPTIONS;
void controlToken;
`);
  const canary = spawnSync(executable, ['--config', config, '--project-root', canaryRoot, '--no-git-ignore', '--error', '--json', 'app'], {
    cwd: canaryRoot,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
  if (canary.error) throw canary.error;
  let output;
  try {
    output = JSON.parse(canary.stdout || '{}');
  } catch {
    console.error('[semgrep] canary returned invalid JSON.');
    process.exit(1);
  }
  const detected = new Set((output.results ?? []).map((finding) => finding.check_id));
  const required = [
    'furima-no-dangerous-html-in-app',
    'furima-no-browser-control-token',
    'furima-agent-surface-no-control-bridge',
  ];
  const missing = required.filter((rule) => ![...detected].some((detectedRule) => detectedRule === rule || detectedRule.endsWith(`.${rule}`)));
  if (canary.status === 0 || missing.length) {
    console.error(`[semgrep] security canary failed; missing rules: ${missing.join(', ') || 'none (scanner did not fail)'}`);
    console.error(`[semgrep] canary detected: ${[...detected].join(', ') || 'none'}`);
    if (canary.stderr) console.error(canary.stderr.trim());
    if (Array.isArray(output.errors) && output.errors.length) console.error(JSON.stringify(output.errors));
    process.exit(1);
  }
  console.log(`[semgrep] security canary detected ${required.length} critical boundary violations.`);
} finally {
  await rm(canaryRoot, { recursive: true, force: true });
}
