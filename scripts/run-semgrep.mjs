import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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
const result = spawnSync(executable, ['--config', 'semgrep/furima.yml', '--no-git-ignore', 'app'], { stdio: 'inherit', windowsHide: true, env });
if (result.error?.code === 'ENOENT') {
  const message = '[semgrep] semgrep is not installed; install Semgrep before running the static security gate.';
  if (process.env.CI === 'true') {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message} Local runs may use the contract test instead.`);
  process.exit(0);
}
process.exit(result.status ?? 1);
