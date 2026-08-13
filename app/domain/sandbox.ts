import type { MarketplaceState, Transaction } from './marketplace.ts';
import { MarketplaceDomain } from './marketplace.ts';

export type ActorType = 'human' | 'npc' | 'ai_agent' | 'operator' | 'system';
export type SandboxWorldStatus = 'playing' | 'paused';
export type LedgerEntryType = 'credit' | 'debit' | 'escrow_hold' | 'escrow_release' | 'fee' | 'refund';

export interface SandboxWorld {
  id: string;
  name: string;
  seed: number;
  status: SandboxWorldStatus;
  speed: 1 | 10;
  simulatedAt: string;
  tick: number;
  kpis: Record<string, number>;
}

export interface SandboxEvent {
  eventId: string;
  eventType: string;
  worldId: string;
  actorId: string;
  actorType: ActorType;
  targetId?: string;
  timestamp: string;
  causedBy?: string;
  correlationId: string;
  metadata: Record<string, unknown>;
}

export interface SandboxWallet {
  id: string;
  userId: string;
  ownerId: string;
  label: string;
  ownerName: string;
  balance: number;
  availableBalance: number;
  credits: number;
}

export interface LedgerEntry {
  id: string;
  worldId: string;
  walletId: string;
  type: LedgerEntryType;
  amount: number;
  transactionId?: string;
  correlationId: string;
  timestamp: string;
  description: string;
  balanceAfter: number;
}

export interface AgentCandidate {
  itemId: string;
  listingId: string;
  title: string;
  price: number;
  score: number;
  reason: string;
}

export interface AgentStep {
  id: string;
  type: string;
  label: string;
  detail: string;
  actorType: ActorType;
  status: 'completed' | 'awaiting_confirmation' | 'failed';
  at: string;
}

export type AgentRunStatus = 'planning' | 'awaiting_confirmation' | 'purchased' | 'failed';

export interface AgentRun {
  id: string;
  goal: string;
  query: string;
  budget: number;
  status: AgentRunStatus;
  actorId: string;
  candidates: AgentCandidate[];
  selectedItemId?: string;
  selectedListingId?: string;
  offerPrice?: number;
  counterPrice?: number;
  checkoutId?: string;
  transactionId?: string;
  steps: AgentStep[];
  createdAt: string;
  updatedAt: string;
}

export interface SandboxState {
  world: SandboxWorld;
  events: SandboxEvent[];
  wallets: SandboxWallet[];
  ledger: LedgerEntry[];
  agentRuns: AgentRun[];
}

export interface CommandIntent {
  id: string;
  action: 'browse' | 'like' | 'offer' | 'buy' | 'ship' | 'deliver' | 'review' | 'list';
  actorId: string;
  actorType: 'npc' | 'ai_agent';
  targetId?: string;
  correlationId: string;
  payload: Record<string, unknown>;
  simulatedAt: string;
}

export type PurchaseResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; error: string };

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const normalizeSeed = (seed: number | string) => {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.abs(Math.trunc(seed)) || 1;
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) || 1;
};

const stableHash = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const transactionEventName: Record<string, string> = {
  PURCHASED: 'order.purchased',
  PAYMENT_COMPLETED: 'payment.completed',
  SHIPPED: 'shipment.shipped',
  DELIVERED: 'shipment.delivered',
  BUYER_RATED: 'review.buyer_submitted',
  SELLER_RATED: 'review.seller_submitted',
  COMPLETED: 'order.completed',
  CANCELED: 'order.canceled',
};

export class MarketplaceSandbox {
  private readonly domain: MarketplaceDomain;
  private readonly initialMarketplaceState: MarketplaceState;
  private state!: SandboxState;
  private sequence = 0;
  private readonly processedDomainEvents = new Set<string>();
  private readonly processedPurchases = new Set<string>();
  private readonly processedCompletions = new Set<string>();
  private readonly processedIntents = new Set<string>();
  private readonly transactionCorrelations = new Map<string, string>();

  constructor(domain: MarketplaceDomain, seed: number | string = 12345) {
    this.domain = domain;
    this.initialMarketplaceState = domain.getState();
    this.reset(seed);
  }

  getState(): SandboxState {
    return clone(this.state);
  }

  reset(seed: number | string = this.state?.world.seed ?? 12345): SandboxState {
    const normalizedSeed = normalizeSeed(seed);
    this.domain.reset(this.initialMarketplaceState);
    this.sequence = 0;
    this.processedDomainEvents.clear();
    this.processedPurchases.clear();
    this.processedCompletions.clear();
    this.processedIntents.clear();
    this.transactionCorrelations.clear();
    const marketplace = this.domain.getState();
    const simulatedAt = '2026-01-01T09:00:00.000Z';
    const startingBalances = new Map<string, number>();
    const wallets: SandboxWallet[] = marketplace.users.map((user) => {
      const startingBalance = 30_000 + (stableHash(`${normalizedSeed}:${user.id}`) % 40_001) + user.salesBalance;
      startingBalances.set(user.id, startingBalance);
      return {
        id: `wallet-${user.id}`,
        userId: user.id,
        ownerId: user.id,
        label: user.displayName,
        ownerName: user.displayName,
        balance: 0,
        availableBalance: 0,
        credits: 0,
      };
    });
    wallets.push(
      { id: 'wallet-escrow', userId: 'escrow', ownerId: 'escrow', label: 'Escrow', ownerName: 'Escrow', balance: 0, availableBalance: 0, credits: 0 },
      { id: 'wallet-platform', userId: 'platform', ownerId: 'platform', label: 'Platform', ownerName: 'Platform', balance: 0, availableBalance: 0, credits: 0 },
    );
    this.state = {
      world: {
        id: 'world-default',
        name: 'Default World',
        seed: normalizedSeed,
        status: 'paused',
        speed: 1,
        simulatedAt,
        tick: 0,
        kpis: {},
      },
      events: [],
      wallets,
      ledger: [],
      agentRuns: [],
    };
    for (const wallet of wallets.filter((candidate) => startingBalances.has(candidate.ownerId))) {
      this.appendLedger(wallet.id, 'credit', startingBalances.get(wallet.ownerId) ?? 0, `seed-${normalizedSeed}`, '初期Market Credits');
    }
    this.appendEvent('world.initialized', 'system', 'system', this.state.world.id, `seed-${normalizedSeed}`, {
      seed: normalizedSeed,
      participants: marketplace.users.length,
      listings: marketplace.listings.length,
    });
    this.syncDomainEvents('human');
    this.refreshKpis();
    return this.getState();
  }

  restoreState(state: SandboxState): void {
    if (!state || !state.world || !Array.isArray(state.events) || !Array.isArray(state.wallets) || !Array.isArray(state.ledger) || !Array.isArray(state.agentRuns)) {
      throw new Error('Invalid sandbox state');
    }
    if (state.world.id !== 'world-default' || !Number.isFinite(state.world.tick) || ![1, 10].includes(state.world.speed)) {
      throw new Error('Invalid sandbox world');
    }
    this.state = clone(state);
    this.processedDomainEvents.clear();
    this.processedPurchases.clear();
    this.processedCompletions.clear();
    this.processedIntents.clear();
    this.transactionCorrelations.clear();
    for (const event of this.state.events) {
      const domainEventId = event.metadata.domainEventId;
      const intentId = event.metadata.intentId;
      if (typeof domainEventId === 'string') this.processedDomainEvents.add(domainEventId);
      if (typeof intentId === 'string') this.processedIntents.add(intentId);
    }
    for (const entry of this.state.ledger) {
      if (entry.transactionId && entry.type === 'debit') this.processedPurchases.add(entry.transactionId);
      if (entry.transactionId && entry.walletId === 'wallet-escrow' && entry.type === 'escrow_release') this.processedCompletions.add(entry.transactionId);
      if (entry.transactionId) this.transactionCorrelations.set(entry.transactionId, entry.correlationId);
    }
    this.sequence = this.state.events.length + this.state.ledger.length + this.state.agentRuns.reduce((total, run) => total + run.steps.length + 1, 0);
  }

  setPlaying(playing: boolean): SandboxState {
    this.state.world.status = playing ? 'playing' : 'paused';
    this.appendEvent(playing ? 'world.played' : 'world.paused', 'operator', 'operator', this.state.world.id, `world-${this.state.world.tick}`);
    return this.getState();
  }

  setSpeed(speed: 1 | 10): SandboxState {
    this.state.world.speed = speed;
    this.appendEvent('world.speed_changed', 'operator', 'operator', this.state.world.id, `world-${this.state.world.tick}`, { speed });
    return this.getState();
  }

  step(minutes = 1): SandboxState {
    const elapsed = Math.max(1, Math.trunc(minutes)) * this.state.world.speed;
    this.state.world.tick += elapsed;
    this.state.world.simulatedAt = new Date(new Date(this.state.world.simulatedAt).getTime() + elapsed * 60_000).toISOString();
    this.runFallbackTick();
    this.syncDomainEvents('npc');
    this.refreshKpis();
    return this.getState();
  }

  recordHumanAction(eventType: string, targetId: string, metadata: Record<string, unknown> = {}): SandboxEvent {
    const currentUserId = this.domain.getState().currentUserId;
    return clone(this.appendEvent(eventType, currentUserId, 'human', targetId, `human-${this.state.world.tick}`, metadata));
  }

  syncDomainEvents(actorType: ActorType = 'human'): SandboxState {
    const marketplace = this.domain.getState();
    for (const event of marketplace.transactionEvents) {
      if (this.processedDomainEvents.has(event.id)) continue;
      this.processedDomainEvents.add(event.id);
      const correlationId = this.transactionCorrelations.get(event.transactionId) ?? event.transactionId;
      const previous = [...this.state.events].reverse().find((candidate) => candidate.correlationId === correlationId);
      this.appendEvent(
        transactionEventName[event.type] ?? `transaction.${event.type.toLowerCase()}`,
        event.actorId,
        actorType,
        event.transactionId,
        correlationId,
        { ...event.payload, domainEventId: event.id },
        previous?.eventId,
      );
      const transaction = marketplace.transactions.find((candidate) => candidate.id === event.transactionId);
      if (event.type === 'PURCHASED' && transaction) this.capturePurchase(transaction);
      if (event.type === 'COMPLETED' && transaction) this.captureCompletion(transaction);
    }
    this.refreshKpis();
    return this.getState();
  }

  executePurchase(actorId: string, listingId: string, actorType: ActorType = 'human', correlationId = this.nextId('purchase')): PurchaseResult {
    const before = this.domain.getState();
    const listing = before.listings.find((candidate) => candidate.id === listingId);
    const wallet = this.walletFor(actorId);
    const expectedTotal = listing ? listing.price + (listing.shippingPayer === 'BUYER' ? 750 : 0) : Number.POSITIVE_INFINITY;
    if (!listing || !wallet || wallet.balance < expectedTotal) {
      const error = !listing ? 'LISTING_NOT_FOUND' : !wallet ? 'WALLET_NOT_FOUND' : 'INSUFFICIENT_FUNDS';
      this.appendEvent('command.rejected', actorId, actorType, listingId, correlationId, { command: 'purchase', error, expectedTotal, balance: wallet?.balance ?? 0 });
      return { ok: false, error };
    }
    if (!this.state.events.some((event) => event.correlationId === correlationId)) {
      this.appendEvent('command.purchase.requested', actorId, actorType, listingId, correlationId, { command: 'purchase' });
    }
    const originalUserId = before.currentUserId;
    try {
      const switched = this.domain.switchCurrentUser(actorId);
      if (!switched.ok) return { ok: false, error: switched.error };
      const checkout = this.domain.createCheckout({ buyerId: actorId, listingId });
      if (!checkout.ok) {
        this.appendEvent('command.rejected', actorId, actorType, listingId, correlationId, { command: 'purchase', error: checkout.error });
        return { ok: false, error: checkout.error };
      }
      return this.confirmCheckout(actorId, checkout.data.id, actorType, correlationId);
    } finally {
      this.domain.switchCurrentUser(originalUserId);
    }
  }

  confirmCheckout(actorId: string, checkoutId: string, actorType: ActorType = 'human', correlationId = this.nextId('purchase')): PurchaseResult {
    const before = this.domain.getState();
    const checkout = before.checkouts.find((candidate) => candidate.id === checkoutId);
    const wallet = this.walletFor(actorId);
    if (!checkout || checkout.buyerId !== actorId || !wallet || wallet.balance < checkout.total) {
      const error = !checkout ? 'CHECKOUT_NOT_FOUND' : checkout.buyerId !== actorId ? 'PERMISSION_DENIED' : !wallet ? 'WALLET_NOT_FOUND' : 'INSUFFICIENT_FUNDS';
      this.appendEvent('command.rejected', actorId, actorType, checkout?.listingId, correlationId, { command: 'purchase', error, required: checkout?.total, balance: wallet?.balance ?? 0 });
      return { ok: false, error };
    }
    const originalUserId = before.currentUserId;
    try {
      const switched = this.domain.switchCurrentUser(actorId);
      if (!switched.ok) return { ok: false, error: switched.error };
      const confirmed = this.domain.confirmPurchase(checkoutId);
      if (!confirmed.ok) {
        this.appendEvent('command.rejected', actorId, actorType, checkout.listingId, correlationId, { command: 'purchase', error: confirmed.error });
        return { ok: false, error: confirmed.error };
      }
      this.transactionCorrelations.set(confirmed.data.id, correlationId);
      this.syncDomainEvents(actorType);
      return { ok: true, transaction: confirmed.data };
    } finally {
      this.domain.switchCurrentUser(originalUserId);
    }
  }

  runBuyerAgent(input: { goal: string; query: string; budget: number; offerPrice?: number }): AgentRun {
    const timestamp = this.state.world.simulatedAt;
    const marketplace = this.domain.getState();
    const query = input.query.trim().toLowerCase();
    const candidates = marketplace.listings
      .filter((listing) => listing.status === 'PUBLISHED' && listing.saleType === 'FIXED_PRICE' && listing.sellerId !== marketplace.currentUserId)
      .map((listing) => {
        const item = marketplace.items.find((candidate) => candidate.id === listing.itemId);
        const searchable = `${item?.title ?? ''} ${item?.description ?? ''} ${listing.categoryId}`.toLowerCase();
        const cameraQuery = query.includes('カメラ');
        const cameraListing = /camera|canon|olympus|fujifilm|finepix|ミラーレス|コンデジ/iu.test(`${listing.id} ${searchable}`);
        if (query && !searchable.includes(query) && !(cameraQuery && cameraListing)) return null;
        const withinBudget = listing.price <= input.budget;
        const quality = item?.condition === 'NEW' ? 18 : item?.condition === 'LIKE_NEW' ? 16 : item?.condition === 'GOOD' ? 13 : 8;
        const score = Math.max(1, Math.min(100, 58 + quality + (withinBudget ? 18 : -18) + Math.round(Math.min(listing.price, input.budget) / Math.max(1, input.budget) * 8)));
        return {
          itemId: listing.itemId,
          listingId: listing.id,
          title: item?.title ?? '商品',
          price: listing.price,
          score,
          reason: withinBudget ? `予算内・状態${item?.condition ?? 'GOOD'}・価格適合度が高い` : `予算超過だが比較対象として品質を確認`,
        } satisfies AgentCandidate;
      })
      .filter((candidate): candidate is AgentCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score || right.price - left.price)
      .slice(0, 3);
    const selected = candidates.find((candidate) => candidate.price <= input.budget) ?? candidates[0];
    const runId = this.nextId('agent-run');
    const correlationId = runId;
    const steps: AgentStep[] = [
      this.agentStep(runId, 'search', '検索', `「${input.query}」で公開商品を検索`, 'ai_agent', 'completed'),
      this.agentStep(runId, 'compare', '候補比較', `${candidates.length}件を価格・状態・予算適合度で比較`, 'ai_agent', candidates.length ? 'completed' : 'failed'),
    ];
    const run: AgentRun = {
      id: runId,
      goal: input.goal,
      query: input.query,
      budget: input.budget,
      status: selected ? 'awaiting_confirmation' : 'failed',
      actorId: marketplace.currentUserId,
      candidates,
      selectedItemId: selected?.itemId,
      selectedListingId: selected?.listingId,
      offerPrice: input.offerPrice,
      steps,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.appendEvent('agent.search_completed', `buyer-agent-${marketplace.currentUserId}`, 'ai_agent', this.state.world.id, correlationId, { query: input.query, budget: input.budget, candidates: candidates.map((candidate) => candidate.listingId) });
    if (!selected) {
      steps.push(this.agentStep(runId, 'failed', '候補なし', '条件に合う公開商品がありません', 'ai_agent', 'failed'));
      this.state.agentRuns.push(run);
      return clone(run);
    }
    const offerPrice = Math.min(selected.price - 100, input.offerPrice ?? selected.price);
    if (offerPrice >= 300 && offerPrice < selected.price) {
      const offer = this.domain.requestPriceChange(selected.listingId, marketplace.currentUserId, offerPrice);
      if (offer.ok) {
        steps.push(this.agentStep(runId, 'offer', '値下げ交渉', `¥${offerPrice.toLocaleString()}を提示`, 'ai_agent', 'completed'));
        this.appendEvent('offer.created', `buyer-agent-${marketplace.currentUserId}`, 'ai_agent', selected.listingId, correlationId, { offerPrice });
        const counterPrice = Math.min(selected.price, Math.round((offerPrice + 500) / 100) * 100);
        const sellerId = marketplace.listings.find((listing) => listing.id === selected.listingId)?.sellerId;
        const originalUserId = this.domain.getState().currentUserId;
        if (sellerId) {
          this.domain.switchCurrentUser(sellerId);
          this.domain.respondPriceRequest(offer.data.id, false);
          const latest = this.domain.getState().listings.find((listing) => listing.id === selected.listingId);
          if (latest) this.domain.updateListing(latest.id, { price: counterPrice }, latest.version);
          this.domain.switchCurrentUser(originalUserId);
          run.counterPrice = counterPrice;
          steps.push(this.agentStep(runId, 'counter', 'NPC counter', `出品者が¥${counterPrice.toLocaleString()}を提示`, 'npc', 'completed'));
          this.appendEvent('offer.countered', sellerId, 'npc', selected.listingId, correlationId, { offerPrice, counterPrice });
        }
      }
    }
    steps.push(this.agentStep(runId, 'confirmation', '購入確認', 'Human の最終確認を待っています', 'human', 'awaiting_confirmation'));
    this.appendEvent('agent.awaiting_confirmation', `buyer-agent-${marketplace.currentUserId}`, 'ai_agent', selected.listingId, correlationId, { selectedItemId: selected.itemId, finalPrice: run.counterPrice ?? selected.price });
    this.state.agentRuns.push(run);
    this.refreshKpis();
    return clone(run);
  }

  confirmAgentPurchase(runId: string): AgentRun {
    const run = this.state.agentRuns.find((candidate) => candidate.id === runId);
    if (!run) throw new Error('Agent run not found');
    if (run.status !== 'awaiting_confirmation' || !run.selectedListingId) return clone(run);
    run.steps = run.steps.map((step) => step.type === 'confirmation' ? { ...step, detail: 'Human が購入を承認', status: 'completed', at: this.state.world.simulatedAt } : step);
    this.appendEvent('agent.purchase_confirmed', run.actorId, 'human', run.selectedListingId, run.id);
    const result = this.executePurchase(run.actorId, run.selectedListingId, 'ai_agent', run.id);
    if (result.ok) {
      run.status = 'purchased';
      run.transactionId = result.transaction.id;
      run.checkoutId = result.transaction.checkoutId;
      run.steps.push(this.agentStep(run.id, 'purchase', '購入', `取引 ${result.transaction.id} を作成し、代金をEscrowへ移動`, 'ai_agent', 'completed'));
      this.appendEvent('agent.purchase_completed', `buyer-agent-${run.actorId}`, 'ai_agent', result.transaction.id, run.id, { listingId: run.selectedListingId });
    } else {
      run.status = 'failed';
      run.steps.push(this.agentStep(run.id, 'purchase', '購入失敗', result.error, 'ai_agent', 'failed'));
    }
    run.updatedAt = this.state.world.simulatedAt;
    this.refreshKpis();
    return clone(run);
  }

  applyCommandIntent(intent: CommandIntent): SandboxState {
    if (this.processedIntents.has(intent.id)) return this.getState();
    this.processedIntents.add(intent.id);
    const targetId = intent.targetId ?? String(intent.payload.listing_id ?? intent.payload.transaction_id ?? this.state.world.id);
    const metadata = { ...intent.payload, intentId: intent.id, source: 'mesa' };
    const marketplace = this.domain.getState();
    const originalUserId = marketplace.currentUserId;
    try {
      if (intent.action === 'browse') {
        this.appendEvent('product.viewed', intent.actorId, intent.actorType, targetId, intent.correlationId, metadata);
      } else if (intent.action === 'like') {
        const result = this.domain.likeListing(targetId, intent.actorId, true);
        this.appendCommandResult(intent, targetId, result.ok, result.ok ? undefined : result.error);
      } else if (intent.action === 'offer') {
        const requestedPrice = Number(intent.payload.amount ?? intent.payload.requested_price ?? intent.payload.requestedPrice ?? intent.payload.offer_price ?? 0);
        const result = this.domain.requestPriceChange(targetId, intent.actorId, requestedPrice);
        this.appendCommandResult(intent, targetId, result.ok, result.ok ? undefined : result.error, { requestedPrice });
      } else if (intent.action === 'buy') {
        this.appendEvent('command.buy.requested', intent.actorId, intent.actorType, targetId, intent.correlationId, metadata);
        this.executePurchase(intent.actorId, targetId, intent.actorType, intent.correlationId);
      } else if (intent.action === 'ship') {
        this.domain.switchCurrentUser(intent.actorId);
        const result = this.domain.markAsShipped(targetId);
        this.appendCommandResult(intent, targetId, result.ok, result.ok ? undefined : result.error);
        this.syncDomainEvents('npc');
      } else if (intent.action === 'deliver') {
        const result = this.domain.updateShipmentStatus(targetId, 'DELIVERED');
        this.appendCommandResult(intent, targetId, result.ok, result.ok ? undefined : result.error);
        this.syncDomainEvents('system');
      } else if (intent.action === 'review') {
        this.domain.switchCurrentUser(intent.actorId);
        const result = this.domain.rateTransaction(targetId, intent.actorId, Number(intent.payload.rating ?? 5), 'Mesa NPC review');
        this.appendCommandResult(intent, targetId, result.ok, result.ok ? undefined : result.error);
        this.syncDomainEvents('npc');
      } else if (intent.action === 'list') {
        this.domain.switchCurrentUser(intent.actorId);
        const draft = this.domain.addListingDraft(intent.actorId, {
          item: { title: String(intent.payload.title ?? 'NPCの出品'), description: String(intent.payload.description ?? 'Mesa NPCが出品した商品'), condition: 'GOOD' },
          categoryId: String(intent.payload.category ?? 'その他'),
          price: Math.max(300, Number(intent.payload.price ?? 1_500)),
          saleType: 'FIXED_PRICE', shippingPayer: 'SELLER', shippingMethod: 'MERCARI_STANDARD', shippingOrigin: '東京都', shippingDays: 2, packageSize: 'MEDIUM', isAnonymous: true,
          images: ['/images/products/device.jpg'],
        });
        const published = draft.ok ? this.domain.publishListing(draft.data.id) : draft;
        this.appendCommandResult(intent, draft.ok ? draft.data.id : targetId, published.ok, published.ok ? undefined : published.error);
        if (published.ok) this.appendEvent('listing.published', intent.actorId, 'npc', published.data.id, intent.correlationId, metadata);
      }
    } finally {
      this.domain.switchCurrentUser(originalUserId);
    }
    this.refreshKpis();
    return this.getState();
  }

  private runFallbackTick() {
    const marketplace = this.domain.getState();
    const active = marketplace.transactions.find((transaction) => transaction.transactionStatus === 'ACTIVE');
    if (active) {
      const shipment = marketplace.shipments.find((candidate) => candidate.id === active.shipmentId);
      if (active.paymentStatus === 'PAID' && shipment?.status === 'NOT_SHIPPED' && active.sellerId !== marketplace.currentUserId) {
        this.applyCommandIntent(this.fallbackIntent('ship', active.sellerId, active.id));
        return;
      }
      if (shipment?.status === 'SHIPPED') {
        this.domain.updateShipmentStatus(active.id, 'IN_TRANSIT');
        this.appendEvent('shipment.in_transit', 'delivery-system', 'system', active.id, active.id);
        return;
      }
      if (shipment?.status === 'IN_TRANSIT') {
        this.domain.updateShipmentStatus(active.id, 'OUT_FOR_DELIVERY');
        this.appendEvent('shipment.out_for_delivery', 'delivery-system', 'system', active.id, active.id);
        return;
      }
      if (shipment?.status === 'OUT_FOR_DELIVERY') {
        this.applyCommandIntent(this.fallbackIntent('deliver', active.buyerId, active.id));
        return;
      }
      if (active.fulfillmentStatus === 'DELIVERED' && active.buyerRatingStatus === 'PENDING' && active.buyerId !== marketplace.currentUserId) {
        this.applyCommandIntent(this.fallbackIntent('review', active.buyerId, active.id, { rating: 5 }));
        return;
      }
      if (active.fulfillmentStatus === 'DELIVERED' && active.sellerRatingStatus === 'PENDING' && active.sellerId !== marketplace.currentUserId) {
        this.applyCommandIntent(this.fallbackIntent('review', active.sellerId, active.id, { rating: 5 }));
        return;
      }
    }
    const npcs = marketplace.users.filter((user) => user.id !== marketplace.currentUserId);
    const actor = npcs[stableHash(`${this.state.world.seed}:actor:${this.state.world.tick}`) % Math.max(1, npcs.length)];
    if (!actor) return;
    const listings = marketplace.listings.filter((listing) => listing.status === 'PUBLISHED' && listing.sellerId !== actor.id);
    const listing = listings[stableHash(`${this.state.world.seed}:listing:${this.state.world.tick}`) % Math.max(1, listings.length)];
    if (!listing || this.state.world.tick % 13 === 0) {
      this.applyCommandIntent(this.fallbackIntent('list', actor.id, this.state.world.id, { title: `NPCセレクト #${this.state.world.tick}`, price: 900 + (this.state.world.tick % 20) * 100 }));
      return;
    }
    const roll = stableHash(`${this.state.world.seed}:action:${this.state.world.tick}`) % 100;
    const action = roll < 45 ? 'browse' : roll < 72 ? 'like' : roll < 90 ? 'offer' : 'buy';
    const payload = action === 'offer' ? { requested_price: Math.max(300, Math.round(listing.price * 0.9 / 100) * 100) } : {};
    this.applyCommandIntent(this.fallbackIntent(action, actor.id, listing.id, payload));
  }

  private fallbackIntent(action: CommandIntent['action'], actorId: string, targetId: string, payload: Record<string, unknown> = {}): CommandIntent {
    const id = `fallback-${this.state.world.seed}-${this.state.world.tick}-${action}-${actorId}-${targetId}`;
    return { id, action, actorId, actorType: 'npc', targetId, correlationId: id, payload, simulatedAt: this.state.world.simulatedAt };
  }

  private capturePurchase(transaction: Transaction) {
    if (this.processedPurchases.has(transaction.id)) return;
    this.processedPurchases.add(transaction.id);
    const buyerWallet = this.walletFor(transaction.buyerId);
    if (!buyerWallet || buyerWallet.balance < transaction.total) {
      this.appendEvent('wallet.invariant_violation', 'system', 'system', transaction.id, transaction.id, { reason: 'INSUFFICIENT_FUNDS_AFTER_DOMAIN_PURCHASE', required: transaction.total, balance: buyerWallet?.balance ?? 0 });
      return;
    }
    const correlationId = this.transactionCorrelations.get(transaction.id) ?? transaction.id;
    this.appendLedger(buyerWallet.id, 'debit', -transaction.total, correlationId, '購入代金をEscrowへ移動', transaction.id);
    this.appendLedger('wallet-escrow', 'escrow_hold', transaction.total, correlationId, '購入代金を保全', transaction.id);
  }

  private captureCompletion(transaction: Transaction) {
    if (this.processedCompletions.has(transaction.id)) return;
    this.processedCompletions.add(transaction.id);
    const escrow = this.walletById('wallet-escrow');
    const seller = this.walletFor(transaction.sellerId);
    const proceeds = this.domain.getState().proceeds.find((candidate) => candidate.transactionId === transaction.id);
    const sellerNet = Math.min(transaction.total, Math.max(0, proceeds?.net ?? transaction.itemPrice - transaction.platformFee - transaction.shippingFee));
    const platformShare = transaction.total - sellerNet;
    if (!escrow || !seller || escrow.balance < transaction.total) {
      this.appendEvent('wallet.invariant_violation', 'system', 'system', transaction.id, transaction.id, { reason: 'ESCROW_MISMATCH', required: transaction.total, balance: escrow?.balance ?? 0 });
      return;
    }
    const correlationId = this.transactionCorrelations.get(transaction.id) ?? transaction.id;
    this.appendLedger(escrow.id, 'escrow_release', -transaction.total, correlationId, '取引完了によりEscrowを解放', transaction.id);
    this.appendLedger(seller.id, 'escrow_release', sellerNet, correlationId, '売上金をSellerへ反映', transaction.id);
    if (platformShare > 0) this.appendLedger('wallet-platform', 'fee', platformShare, correlationId, '販売手数料・配送費を計上', transaction.id);
  }

  private appendLedger(walletId: string, type: LedgerEntryType, amount: number, correlationId: string, description: string, transactionId?: string) {
    const wallet = this.walletById(walletId);
    if (!wallet) throw new Error(`Wallet not found: ${walletId}`);
    wallet.balance += amount;
    wallet.availableBalance = wallet.balance;
    wallet.credits = wallet.balance;
    this.state.ledger.push({
      id: this.nextId('ledger'),
      worldId: this.state.world.id,
      walletId,
      type,
      amount,
      transactionId,
      correlationId,
      timestamp: this.state.world.simulatedAt,
      description,
      balanceAfter: wallet.balance,
    });
  }

  private appendEvent(eventType: string, actorId: string, actorType: ActorType, targetId: string | undefined, correlationId: string, metadata: Record<string, unknown> = {}, causedBy?: string) {
    const previous = causedBy ?? [...this.state.events].reverse().find((event) => event.correlationId === correlationId)?.eventId;
    const event: SandboxEvent = {
      eventId: this.nextId('event'),
      eventType,
      worldId: this.state.world.id,
      actorId,
      actorType,
      targetId,
      timestamp: this.state.world.simulatedAt,
      causedBy: previous,
      correlationId,
      metadata,
    };
    this.state.events.push(event);
    return event;
  }

  private appendCommandResult(intent: CommandIntent, targetId: string, ok: boolean, error?: string, metadata: Record<string, unknown> = {}) {
    this.appendEvent(ok ? `command.${intent.action}.accepted` : 'command.rejected', intent.actorId, intent.actorType, targetId, intent.correlationId, { ...metadata, intentId: intent.id, command: intent.action, error });
  }

  private agentStep(runId: string, type: string, label: string, detail: string, actorType: ActorType, status: AgentStep['status']): AgentStep {
    return { id: `${runId}-${type}-${this.sequence + 1}`, type, label, detail, actorType, status, at: this.state.world.simulatedAt };
  }

  private refreshKpis() {
    const marketplace = this.domain.getState();
    const views = this.state.events.filter((event) => event.eventType === 'product.viewed').length;
    const transactions = marketplace.transactions.length;
    this.state.world.kpis = {
      gmv: marketplace.transactions.filter((transaction) => transaction.transactionStatus !== 'CANCELED').reduce((total, transaction) => total + transaction.itemPrice, 0),
      conversion: views ? transactions / views : 0,
      listings: marketplace.listings.filter((listing) => listing.status === 'PUBLISHED').length,
      transactions,
      completedTransactions: marketplace.transactions.filter((transaction) => transaction.transactionStatus === 'COMPLETED').length,
      likes: marketplace.likes.length,
      participants: marketplace.users.length,
    };
  }

  private walletFor(ownerId: string) {
    return this.state.wallets.find((wallet) => wallet.ownerId === ownerId);
  }

  private walletById(walletId: string) {
    return this.state.wallets.find((wallet) => wallet.id === walletId);
  }

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}-${this.state?.world?.seed ?? 'seed'}-${this.sequence}`;
  }
}
