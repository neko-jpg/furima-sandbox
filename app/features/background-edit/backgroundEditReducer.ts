export type BackgroundEditPhase = 'idle' | 'processing' | 'preview' | 'approved' | 'error';

export interface BackgroundEditState {
  readonly phase: BackgroundEditPhase;
  /** Preview bytes are held in memory only until explicit approval. */
  readonly previewBlob: Blob | null;
  readonly approvedBlob: Blob | null;
  readonly error: string | null;
}
export type BackgroundEditAction =
  | { readonly type: 'START_PROCESSING' }
  | { readonly type: 'PREVIEW_READY'; readonly blob: Blob }
  | { readonly type: 'PROCESSING_FAILED'; readonly message: string }
  | { readonly type: 'APPROVE' }
  | { readonly type: 'REJECT' }
  | { readonly type: 'RESET' };

export const createInitialBackgroundEditState = (): BackgroundEditState => ({
  phase: 'idle',
  previewBlob: null,
  approvedBlob: null,
  error: null,
});

export function backgroundEditReducer(
  state: BackgroundEditState,
  action: BackgroundEditAction,
): BackgroundEditState {
  switch (action.type) {
    case 'START_PROCESSING':
      return { phase: 'processing', previewBlob: null, approvedBlob: null, error: null };
    case 'PREVIEW_READY':
      return { phase: 'preview', previewBlob: action.blob, approvedBlob: null, error: null };
    case 'PROCESSING_FAILED':
      return { phase: 'error', previewBlob: null, approvedBlob: null, error: action.message };
    case 'APPROVE':
      return state.phase === 'preview' && state.previewBlob !== null
        ? { ...state, phase: 'approved', approvedBlob: state.previewBlob, error: null }
        : state;
    case 'REJECT':
      return { phase: 'idle', previewBlob: null, approvedBlob: null, error: null };
    case 'RESET':
      return createInitialBackgroundEditState();
    default:
      return state;
  }
}
