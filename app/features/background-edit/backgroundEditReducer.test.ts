import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundEditReducer, createInitialBackgroundEditState } from './backgroundEditReducer.ts';

test('preview cannot become approved without an explicit image selection', () => {
  const blob = new Blob(['preview'], { type: 'image/jpeg' });
  let state = backgroundEditReducer(createInitialBackgroundEditState(), { type: 'PREVIEW_READY', blob });
  assert.equal(state.phase, 'preview');
  assert.equal(state.approvedBlob, null);
  state = backgroundEditReducer(state, { type: 'APPROVE' });
  assert.equal(state.phase, 'preview');
  state = backgroundEditReducer(state, { type: 'SELECT_OUTPUT', selection: 'composite', blob });
  state = backgroundEditReducer(state, { type: 'APPROVE' });
  assert.equal(state.phase, 'approved');
  assert.equal(state.approvedBlob, blob);
  assert.equal(state.approvedOutput, 'composite');
  state = backgroundEditReducer(state, { type: 'REVOKE_APPROVAL' });
  assert.equal(state.phase, 'preview');
  assert.equal(state.approvedBlob, null);
});

test('the original can be selected after processing fails and approval can be undone', () => {
  const original = new Blob(['original'], { type: 'image/png' });
  let state = backgroundEditReducer(createInitialBackgroundEditState(), { type: 'PROCESSING_FAILED', message: 'unavailable' });
  state = backgroundEditReducer(state, { type: 'SELECT_OUTPUT', selection: 'original', blob: original });
  state = backgroundEditReducer(state, { type: 'APPROVE' });
  assert.equal(state.approvedOutput, 'original');
  assert.equal(state.approvedBlob, original);
  state = backgroundEditReducer(state, { type: 'REVOKE_APPROVAL' });
  assert.equal(state.phase, 'idle');
  assert.equal(state.approvedBlob, null);
});

test('regeneration clears a previous selection and approval failure keeps the candidate', () => {
  const preview = new Blob(['preview'], { type: 'image/png' });
  let state = backgroundEditReducer(createInitialBackgroundEditState(), { type: 'PREVIEW_READY', blob: preview });
  state = backgroundEditReducer(state, { type: 'SELECT_OUTPUT', selection: 'composite', blob: preview });
  state = backgroundEditReducer(state, { type: 'APPROVAL_FAILED', message: 'save failed' });
  assert.equal(state.phase, 'preview');
  assert.equal(state.previewBlob, preview);
  assert.equal(state.selectedOutput, 'composite');
  state = backgroundEditReducer(state, { type: 'START_PROCESSING' });
  assert.equal(state.phase, 'processing');
  assert.equal(state.previewBlob, null);
  assert.equal(state.selectedOutput, null);
});
