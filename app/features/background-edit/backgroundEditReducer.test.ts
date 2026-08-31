import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundEditReducer, createInitialBackgroundEditState } from './backgroundEditReducer.ts';

test('preview cannot become approved without an explicit approval action', () => {
  const blob = new Blob(['preview'], { type: 'image/jpeg' });
  let state = backgroundEditReducer(createInitialBackgroundEditState(), { type: 'PREVIEW_READY', blob });
  assert.equal(state.phase, 'preview');
  assert.equal(state.approvedBlob, null);
  state = backgroundEditReducer(state, { type: 'APPROVE' });
  assert.equal(state.phase, 'approved');
  assert.equal(state.approvedBlob, blob);
  state = backgroundEditReducer(state, { type: 'REJECT' });
  assert.equal(state.approvedBlob, null);
});
