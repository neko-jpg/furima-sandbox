import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageVersion = '4.12.0-release.1';
const expectedSha256 = 'bd0c3e6448043de04f6a64a12cb7b759f78c3ab8f7c35c9f2e0f71c88bb17103';
const runtimePath = fileURLToPath(new URL('../node_modules/@techstark/opencv-js/dist/opencv.js', import.meta.url));
const packageJsonPath = fileURLToPath(new URL('../node_modules/@techstark/opencv-js/package.json', import.meta.url));

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
if (packageJson.version !== packageVersion) {
  throw new Error(`OpenCV.js package version mismatch: expected ${packageVersion}, got ${packageJson.version ?? 'unknown'}`);
}
const digest = createHash('sha256').update(await readFile(runtimePath)).digest('hex');
if (digest !== expectedSha256) {
  throw new Error(`OpenCV.js runtime checksum mismatch: expected ${expectedSha256}, got ${digest}`);
}

console.log(JSON.stringify({ package: '@techstark/opencv-js', version: packageVersion, runtime: 'dist/opencv.js', sha256: 'verified' }));
