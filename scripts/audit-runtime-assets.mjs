import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = join(root, 'public');
const ignored = new Set(['public/images/products/pexels-candidates', 'public/images/products/pexels-candidates-1000']);
const maxRuntimeBytes = 80 * 1024 * 1024;
const selectedManifestPath = join(publicRoot, 'images/products/pexels-selected/manifest.json');
const reviewManifestPath = join(root, 'docs/reference-assets/pexels-review/review-manifest.json');
const selectedManifestFields = new Set([
  'pexelsId', 'category', 'subcategory', 'alt', 'photographer', 'photographerUrl',
  'pexelsUrl', 'width', 'height', 'filename', 'localPath', 'sha256', 'bytes',
]);
const reviewManifestFields = new Set([
  'candidateIndex', 'pexelsId', 'query', 'category', 'subcategory', 'alt',
  'photographer', 'photographerUrl', 'pexelsUrl', 'width', 'height', 'filename',
  'localPath', 'sha256', 'bytes', 'metrics', 'score', 'keep', 'reasons', 'phash',
]);
const forbiddenManifestFields = new Set(['absolutePath', 'selectedPath', 'sourcePath', 'sourceFolder']);
const absolutePathPattern = /(?:^[A-Za-z]:[\\/]|^\\\\|(?:^|["'\s])\/(?:Users|home|mnt|private|var|tmp|development)(?:[\\/"'\s]|$))/iu;
const secretPattern = /(?:PEXELS_API_KEY|(?:api[_-]?key|access[_-]?token|authorization|private[_-]?key)\s*["']?\s*[:=]|-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const publicAssetPathPattern = /^\/images\/products\/pexels-(?:selected|candidates(?:-1000)?)\/[^/\\]+\.jpg$/u;

async function readJson(path, label) {
  let payload;
  try {
    payload = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(payload) || payload.length === 0) throw new Error(`${label} must be a non-empty JSON array`);
  return payload;
}

function assertManifestSafety(entries, allowedFields, label) {
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} entry ${index + 1} must be an object`);
    const keys = Object.keys(entry);
    const unexpected = keys.filter((key) => !allowedFields.has(key));
    const forbidden = keys.filter((key) => forbiddenManifestFields.has(key));
    if (unexpected.length || forbidden.length) {
      throw new Error(`${label} entry ${index + 1} has disallowed fields: ${[...new Set([...unexpected, ...forbidden])].sort().join(', ')}`);
    }
    const serialized = JSON.stringify(entry);
    if (absolutePathPattern.test(serialized)) throw new Error(`${label} entry ${index + 1} contains a local absolute path`);
    if (secretPattern.test(serialized)) throw new Error(`${label} entry ${index + 1} contains a secret-like value`);
    if (typeof entry.filename !== 'string' || !/^[^/\\]+\.jpg$/u.test(entry.filename)) {
      throw new Error(`${label} entry ${index + 1} has an invalid filename`);
    }
    if (typeof entry.localPath !== 'string' || !publicAssetPathPattern.test(entry.localPath) || !entry.localPath.endsWith(`/${entry.filename}`)) {
      throw new Error(`${label} entry ${index + 1} has an invalid public asset path`);
    }
    if (typeof entry.pexelsUrl !== 'string' || !/^https:\/\/www\.pexels\.com\//u.test(entry.pexelsUrl)) {
      throw new Error(`${label} entry ${index + 1} has an invalid Pexels source URL`);
    }
    if (entry.photographerUrl !== undefined && (!entry.photographerUrl || !/^https:\/\/www\.pexels\.com\//u.test(entry.photographerUrl))) {
      throw new Error(`${label} entry ${index + 1} has an invalid photographer URL`);
    }
    if (typeof entry.sha256 !== 'string' || !sha256Pattern.test(entry.sha256)) {
      throw new Error(`${label} entry ${index + 1} has an invalid SHA-256 digest`);
    }
  }
}

async function auditSelectedManifest(entries) {
  for (const [index, entry] of entries.entries()) {
    const assetPath = join(publicRoot, ...entry.localPath.slice('/'.length).split('/'));
    let bytes;
    try {
      bytes = await readFile(assetPath);
    } catch (error) {
      throw new Error(`selected manifest entry ${index + 1} points to a missing asset: ${entry.localPath} (${error.message})`);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256) throw new Error(`selected manifest entry ${index + 1} SHA-256 does not match ${entry.filename}`);
    if (entry.bytes !== undefined && entry.bytes !== bytes.length) throw new Error(`selected manifest entry ${index + 1} byte count does not match ${entry.filename}`);
  }
}

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

const selectedManifest = await readJson(selectedManifestPath, 'selected Pexels manifest');
const reviewManifest = await readJson(reviewManifestPath, 'Pexels review manifest');
assertManifestSafety(selectedManifest, selectedManifestFields, 'selected Pexels manifest');
assertManifestSafety(reviewManifest, reviewManifestFields, 'Pexels review manifest');
await auditSelectedManifest(selectedManifest);
console.log(JSON.stringify({
  selectedManifestEntries: selectedManifest.length,
  reviewManifestEntries: reviewManifest.length,
  selectedManifestSha256: 'verified',
}, null, 2));
