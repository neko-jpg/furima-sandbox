import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Semgrep rules cover raw HTML, history, and UI-to-D1 boundary risks', async () => {
  const rules = await readFile(new URL('../semgrep/furima.yml', import.meta.url), 'utf8');
  assert.match(rules, /furima-no-dangerous-html-in-app/);
  assert.match(rules, /furima-no-history-back-outside-route-controller/);
  assert.match(rules, /furima-no-d1-binding-in-components/);
  assert.match(rules, /furima-agent-surface-no-control-capabilities/);
  assert.match(rules, /furima-agent-surface-no-platform-privilege/);
  assert.match(rules, /furima-no-browser-control-token/);
  assert.match(rules, /furima-agent-surface-no-control-bridge/);
  assert.match(rules, /severity: ERROR/);
});
