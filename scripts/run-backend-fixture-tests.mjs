import { spawnSync } from 'node:child_process';

const executable = process.platform === 'win32' ? 'uv.exe' : 'uv';
const env = { ...process.env, PROVIDER_MODE: 'fixture' };
for (const name of ['OPENAI_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'BACKGROUND_GENERATOR_URL', 'REMBG_URL']) {
  env[name] = '';
}

const result = spawnSync(executable, [
  'run', '--frozen', '--no-sync', 'pytest', '-q',
  'services/listing_photo_assistant/tests',
  'tests/test_measurement_provider.py',
], { env, stdio: 'inherit', shell: false });

if (result.error) {
  console.error(`[backend:fixture] failed to start uv: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
