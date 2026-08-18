import type { ActionResult, AgentActionOptions, AgentErrorCode, MercariItem, PreviewCommand, PurchasePricing } from '../types/mercari.ts';
import { SandboxEngine } from './sandboxEngine.ts';

const invalid = <T,>(engine: SandboxEngine, error: AgentErrorCode, message: string): ActionResult<T> => ({
  ok: false,
  error,
  stateVersion: engine.getStateVersion(),
  message,
});

/** Shared preview dispatcher used by the browser and durable HTTP executor. */
export const applyPreviewOperation = (engine: SandboxEngine, command: PreviewCommand, payload: unknown, options: AgentActionOptions = {}): ActionResult<unknown> => {
  const actorId = options.principal?.actorId ?? options.actorId ?? engine.getCurrentActor().id;
  const operationOptions = { ...options, actorId };
  if (command === 'purchase') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof (payload as { itemId?: unknown }).itemId !== 'string') {
      return invalid(engine, 'INVALID_INPUT', '購入previewにはitemIdが必要です');
    }
    const input = payload as { itemId: string; pricing?: PurchasePricing };
    const started = engine.startPurchase(input.itemId, operationOptions);
    return started.ok ? engine.purchaseItemWithPricing(input.itemId, input.pricing, operationOptions) : started;
  }
  if (command === 'listing.create') return engine.listItem(payload as Partial<MercariItem>, operationOptions);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Number.isInteger((payload as { amount?: unknown }).amount)) {
    return invalid(engine, 'INVALID_AMOUNT', 'ウォレットpreviewには整数のamountが必要です');
  }
  const amount = Number((payload as { amount: number }).amount);
  return command === 'wallet.deposit' ? engine.depositWallet(amount, operationOptions) : engine.withdrawWallet(amount, operationOptions);
};
