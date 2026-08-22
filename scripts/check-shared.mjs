import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const expectedNode = readFileSync('.nvmrc', 'utf8').trim().replace(/^v/u, '');
const expectedNpm = packageJson.packageManager?.match(/^npm@(.+)$/u)?.[1];
const actualNode = process.versions.node;
const actualNpm = process.env.npm_config_user_agent?.match(/(?:^|\s)npm\/([^\s]+)/u)?.[1];
const required = ['.dockerignore', 'Dockerfile', 'compose.yaml'];
const missing = required.filter((file) => {
  try {
    readFileSync(file);
    return false;
  } catch {
    return true;
  }
});

if (actualNode !== expectedNode) {
  console.error(`Expected Node ${expectedNode} but found ${actualNode}`);
  process.exit(1);
}
if (expectedNpm && actualNpm !== expectedNpm) {
  console.error(`Expected npm ${expectedNpm} but found ${actualNpm ?? 'unknown'}`);
  process.exit(1);
}
if (missing.length) {
  console.error(`Missing shared files: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Shared check passed: Node ${actualNode}, npm ${actualNpm ?? expectedNpm ?? 'unknown'}`);
