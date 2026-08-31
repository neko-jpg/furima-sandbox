import assert from 'node:assert/strict';
import test from 'node:test';
import { getApprovedImageForDownload } from './approvedImage.ts';
import { backgroundEditReducer, createInitialBackgroundEditState } from './backgroundEditReducer.ts';

test('download boundary exposes no preview before explicit approval', async () => {
  const preview = new Blob(['preview'], { type: 'image/png' });
  let state = backgroundEditReducer(createInitialBackgroundEditState(), { type: 'PREVIEW_READY', blob: preview });
  assert.equal(await getApprovedImageForDownload(state), null);
  state = backgroundEditReducer(state, { type: 'SELECT_OUTPUT', selection: 'composite', blob: preview });
  assert.equal(await getApprovedImageForDownload(state), null);
  state = backgroundEditReducer(state, { type: 'APPROVE' });
  assert.equal(await getApprovedImageForDownload(state), preview);
});
