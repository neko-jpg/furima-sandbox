export type BackgroundEditPhase = 'idle' | 'processing' | 'preview' | 'approved' | 'error';
export type BackgroundEditSelection = 'original' | 'composite';

export interface BackgroundEditState {
  readonly phase: BackgroundEditPhase;
  /** Composite preview bytes are held in memory only until explicit approval. */
  readonly previewBlob: Blob | null;
  /** The output explicitly selected by the user, but not approved yet. */
  readonly selectedBlob: Blob | null;
  readonly selectedOutput: BackgroundEditSelection | null;
  readonly approvedBlob: Blob | null;
  readonly approvedOutput: BackgroundEditSelection | null;
  readonly error: string | null;
}

export type BackgroundEditAction =
  | { readonly type: 'START_PROCESSING' }
  | { readonly type: 'PREVIEW_READY'; readonly blob: Blob }
  | { readonly type: 'PROCESSING_FAILED'; readonly message: string }
  | { readonly type: 'SELECT_OUTPUT'; readonly selection: BackgroundEditSelection; readonly blob: Blob }
  | { readonly type: 'APPROVE' }
  | { readonly type: 'APPROVAL_FAILED'; readonly message: string }
  | { readonly type: 'REVOKE_APPROVAL' }
  | { readonly type: 'REJECT' }
  | { readonly type: 'RESET' };

export const createInitialBackgroundEditState = (): BackgroundEditState => ({
  phase: 'idle',
  previewBlob: null,
  selectedBlob: null,
  selectedOutput: null,
  approvedBlob: null,
  approvedOutput: null,
  error: null,
});

const idleState = (message?: string): BackgroundEditState => ({
  phase: message ? 'error' : 'idle',
  previewBlob: null,
  selectedBlob: null,
  selectedOutput: null,
  approvedBlob: null,
  approvedOutput: null,
  error: message ?? null,
});

export function backgroundEditReducer(
  state: BackgroundEditState,
  action: BackgroundEditAction,
): BackgroundEditState {
  switch (action.type) {
    case 'START_PROCESSING':
      return { ...createInitialBackgroundEditState(), phase: 'processing' };
    case 'PREVIEW_READY':
      return {
        phase: 'preview',
        previewBlob: action.blob,
        selectedBlob: null,
        selectedOutput: null,
        approvedBlob: null,
        approvedOutput: null,
        error: null,
      };
    case 'PROCESSING_FAILED':
      return idleState(action.message);
    case 'SELECT_OUTPUT':
      if (state.phase === 'processing' || state.phase === 'approved') return state;
      if (action.selection === 'composite' && (state.phase !== 'preview' || state.previewBlob !== action.blob)) return state;
      return {
        ...state,
        phase: 'preview',
        selectedBlob: action.blob,
        selectedOutput: action.selection,
        approvedBlob: null,
        approvedOutput: null,
        error: null,
      };
    case 'APPROVE':
      if (
        state.phase !== 'preview'
        || state.selectedBlob === null
        || state.selectedOutput === null
        || (state.selectedOutput === 'composite' && state.selectedBlob !== state.previewBlob)
      ) return state;
      return {
        ...state,
        phase: 'approved',
        approvedBlob: state.selectedBlob,
        approvedOutput: state.selectedOutput,
        error: null,
      };
    case 'APPROVAL_FAILED':
      return { ...state, error: action.message };
    case 'REVOKE_APPROVAL':
      if (state.phase !== 'approved') return state;
      return {
        ...state,
        phase: state.previewBlob ? 'preview' : 'idle',
        selectedBlob: null,
        selectedOutput: null,
        approvedBlob: null,
        approvedOutput: null,
        error: null,
      };
    case 'REJECT':
      return createInitialBackgroundEditState();
    case 'RESET':
      return createInitialBackgroundEditState();
    default:
      return state;
  }
}
