import type { ActionResult, AgentActionOptions, MercariItem, PurchasePricing, ScenarioId, SupportTicket, ActorProfile, FollowDirection } from '../types/mercari.ts';
import { SandboxEngine } from './sandboxEngine.ts';

const invalid = <T,>(message: string): ActionResult<T> => ({ ok: false, error: 'INVALID_INPUT', stateVersion: 0, message });
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stringValue = (payload: Record<string, unknown>, key: string): string | null => typeof payload[key] === 'string' && payload[key] ? String(payload[key]) : null;

export function dispatchSandboxCommand(engine: SandboxEngine, command: string, input: unknown, options: AgentActionOptions = {}): ActionResult<unknown> {
  const payload = record(input) ? input : {};
  switch (command) {
    case 'listItem': return engine.listItem(input as Partial<MercariItem>, options);
    case 'createListingDraft': return engine.createListingDraft(input as Partial<MercariItem>, options);
    case 'updateListingDraft': {
      const draftId = stringValue(payload, 'draftId');
      if (!draftId) return invalid('draftIdが必要です');
      return engine.updateListingDraft(draftId, (payload.item ?? payload.draft ?? {}) as Partial<MercariItem>, options);
    }
    case 'deleteListingDraft': {
      const draftId = stringValue(payload, 'draftId');
      return draftId ? engine.deleteListingDraft(draftId, options) : invalid('draftIdが必要です');
    }
    case 'submitListing': {
      const draftId = stringValue(payload, 'draftId');
      return draftId ? engine.submitListing(draftId, options) : invalid('draftIdが必要です');
    }
    case 'startPurchase': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.startPurchase(itemId, options) : invalid('itemIdが必要です');
    }
    case 'confirmPurchase': {
      const purchaseIntentId = stringValue(payload, 'purchaseIntentId');
      return purchaseIntentId ? engine.confirmPurchase(purchaseIntentId, options) : invalid('purchaseIntentIdが必要です');
    }
    case 'purchaseItem': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.purchaseItemWithPricing(itemId, payload.pricing as PurchasePricing | undefined, options) : invalid('itemIdが必要です');
    }
    case 'buyItem': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.startPurchase(itemId, options) : invalid('itemIdが必要です');
    }
    case 'placeBid': {
      const itemId = stringValue(payload, 'itemId');
      return itemId && typeof payload.amount === 'number' ? engine.placeBid(itemId, payload.amount, options) : invalid('itemIdとamountが必要です');
    }
    case 'closeAuction': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.closeAuction(itemId, options) : invalid('itemIdが必要です');
    }
    case 'shipOrder': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId ? engine.shipOrder(transactionId, options) : invalid('transactionIdが必要です');
    }
    case 'markDelivered': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId ? engine.markDelivered(transactionId, options) : invalid('transactionIdが必要です');
    }
    case 'reviewOrder': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.rating === 'number' ? engine.reviewOrder(transactionId, payload.rating as 1 | 2 | 3 | 4 | 5, typeof payload.comment === 'string' ? payload.comment : '', options) : invalid('transactionIdとratingが必要です');
    }
    case 'cancelOrder': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.reason === 'string' ? engine.cancelOrder(transactionId, payload.reason, options) : invalid('transactionIdとreasonが必要です');
    }
    case 'resolveCancellation': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.approve === 'boolean' ? engine.resolveCancellation(transactionId, payload.approve, options) : invalid('transactionIdとapproveが必要です');
    }
    case 'reviewListing': {
      const itemId = stringValue(payload, 'itemId');
      return itemId && typeof payload.approve === 'boolean' ? engine.reviewListing(itemId, payload.approve, options) : invalid('itemIdとapproveが必要です');
    }
    case 'requestReturn': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.reason === 'string' ? engine.requestReturn(transactionId, payload.reason, options) : invalid('transactionIdとreasonが必要です');
    }
    case 'confirmReturnReceived': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId ? engine.confirmReturnReceived(transactionId, options) : invalid('transactionIdが必要です');
    }
    case 'sendTransactionMessage': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.body === 'string' ? engine.sendTransactionMessage(transactionId, payload.body, options) : invalid('transactionIdとbodyが必要です');
    }
    case 'createSupportTicket': return engine.createSupportTicket(input as Partial<SupportTicket>, options);
    case 'reportTransaction': {
      const transactionId = stringValue(payload, 'transactionId');
      return transactionId && typeof payload.body === 'string' ? engine.reportTransaction(transactionId, payload.body, options) : invalid('transactionIdとbodyが必要です');
    }
    case 'updateListing': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.updateListing(itemId, (payload.input ?? {}) as Partial<MercariItem>, options) : invalid('itemIdが必要です');
    }
    case 'pauseListing': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.pauseListing(itemId, options) : invalid('itemIdが必要です');
    }
    case 'resumeListing': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.resumeListing(itemId, options) : invalid('itemIdが必要です');
    }
    case 'relistItem': {
      const itemId = stringValue(payload, 'itemId');
      return itemId ? engine.relistItem(itemId, options) : invalid('itemIdが必要です');
    }
    case 'updateProfile': return engine.updateProfile(input as Partial<ActorProfile>, options);
    case 'getFollowList': return payload.direction === 'following' || payload.direction === 'followers' ? engine.getFollowList(payload.direction as FollowDirection, options) : invalid('directionが必要です');
    case 'getFollowSummary': return engine.getFollowSummary(typeof payload.actorId === 'string' ? payload.actorId : undefined, options);
    case 'followUser': {
      const actorId = stringValue(payload, 'actorId');
      return actorId ? engine.followUser(actorId, options) : invalid('actorIdが必要です');
    }
    case 'unfollowUser': {
      const actorId = stringValue(payload, 'actorId');
      return actorId ? engine.unfollowUser(actorId, options) : invalid('actorIdが必要です');
    }
    case 'depositWallet': return typeof payload.amount === 'number' ? engine.depositWallet(payload.amount, options) : invalid('amountが必要です');
    case 'withdrawWallet': return typeof payload.amount === 'number' ? engine.withdrawWallet(payload.amount, options) : invalid('amountが必要です');
    case 'switchActor': {
      const actorId = stringValue(payload, 'actorId');
      return actorId ? engine.switchActor(actorId, options) : invalid('actorIdが必要です');
    }
    case 'loadScenario': {
      const scenarioId = stringValue(payload, 'scenarioId');
      return scenarioId ? engine.loadScenario(scenarioId as ScenarioId, { ...options, seed: typeof payload.seed === 'string' ? payload.seed : options.seed }) : invalid('scenarioIdが必要です');
    }
    case 'resetScenario': return engine.resetScenario({ ...options, scenarioId: typeof payload.scenarioId === 'string' ? payload.scenarioId as ScenarioId : undefined, seed: typeof payload.seed === 'string' ? payload.seed : options.seed });
    case 'advanceClock': return typeof payload.milliseconds === 'number' ? engine.advanceClock(payload.milliseconds, options) : invalid('millisecondsが必要です');
    case 'injectFailure': return typeof payload.failure === 'string' ? engine.injectFailure(payload.failure, options) : invalid('failureが必要です');
    case 'importState': return typeof payload.serialized === 'string' ? engine.importState(payload.serialized, options) : invalid('serializedが必要です');
    default: return invalid(`未対応のSandbox commandです: ${command}`);
  }
}
