import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = join(root, 'public');
const ignored = new Set(['public/images/products/pexels-candidates', 'public/images/products/pexels-candidates-1000']);
const maxRuntimeBytes = 80 * 1024 * 1024;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    const relativePath = relative(root, full).replaceAll('\\', '/');
    if ([...ignored].some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))) continue;
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const files = await walk(publicRoot);
let total = 0;
const large = [];
for (const file of files) {
  const size = (await stat(file)).size;
  total += size;
  if (size >= 2 * 1024 * 1024) large.push({ file: relative(root, file).replaceAll('\\', '/'), size });
}
console.log(JSON.stringify({ totalBytes: total, totalMiB: Number((total / 1024 / 1024).toFixed(2)), largeFiles: large }, null, 2));
if (total > maxRuntimeBytes) process.exitCode = 1;
