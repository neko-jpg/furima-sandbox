import { rm } from 'node:fs/promises';

for (const directory of ['dist', '.next']) {
  await rm(directory, { recursive: true, force: true });
}
