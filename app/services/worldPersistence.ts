import type { MarketplaceState } from '../domain/marketplace';
import type { SandboxState } from '../domain/sandbox';

export type PersistedWorldSnapshot = {
  worldId: string;
  stateVersion: number;
  marketplaceState: MarketplaceState;
  sandboxState: SandboxState;
  updatedAt: string;
};

export const loadWorldSnapshot = async (): Promise<PersistedWorldSnapshot | null> => {
  const response = await fetch('/api/world', { cache: 'no-store' });
  if (!response.ok) return null;
  const payload = await response.json() as { snapshot?: PersistedWorldSnapshot | null };
  const snapshot = payload.snapshot;
  if (!snapshot) return null;
  const marketplaceState = typeof snapshot.marketplaceState === 'string'
    ? JSON.parse(snapshot.marketplaceState) as MarketplaceState
    : snapshot.marketplaceState;
  const sandboxState = typeof snapshot.sandboxState === 'string'
    ? JSON.parse(snapshot.sandboxState) as SandboxState
    : snapshot.sandboxState;
  return { ...snapshot, marketplaceState, sandboxState };
};

export const saveWorldSnapshot = async (
  marketplaceState: MarketplaceState,
  sandboxState: SandboxState,
) => {
  const response = await fetch('/api/world', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      stateVersion: marketplaceState.stateVersion,
      marketplaceState,
      sandboxState,
    }),
  });
  if (!response.ok) throw new Error(`World persistence returned ${response.status}`);
};
