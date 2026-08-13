'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketplaceDomain } from '../domain/marketplace';
import {
  MarketplaceSandbox,
  type ActorType,
  type AgentRun,
  type SandboxState,
} from '../domain/sandbox';
import {
  bootstrapMesaWorld,
  getMesaEngineStatus,
  stepMesaWorld,
  type MesaCommandIntent,
  type MesaEngineStatus,
} from '../services/mesaClient';
import { loadWorldSnapshot, saveWorldSnapshot } from '../services/worldPersistence';

export type SandboxMode = 'user' | 'operator';

export type SandboxRuntimeState = SandboxState & {
  engine: MesaEngineStatus;
};

type UseSandboxRuntimeOptions = {
  domain: MarketplaceDomain;
  domainRevision: number;
  onDomainChange: () => void;
  resetDomain: () => void;
};

type IntentCapableSandbox = MarketplaceSandbox & {
  applyCommandIntent: (intent: MesaCommandIntent) => unknown;
};

const DEFAULT_WORLD_SEED = 12345;
const browserEngine: MesaEngineStatus = {
  name: 'Mesa',
  version: '3.5.1',
  connected: false,
  mode: 'browser-fallback',
  detail: '同じcommand contractの決定論的ブラウザ実行を使用中',
};

const parseBudget = (goal: string) => {
  const tenThousands = goal.match(/([\d.]+)\s*万(?:円)?/u);
  if (tenThousands) return Math.max(300, Math.round(Number(tenThousands[1]) * 10_000));
  const yen = goal.match(/([\d,]+)\s*円/u);
  if (yen) return Math.max(300, Number(yen[1].replaceAll(',', '')));
  return 10_000;
};

const inferQuery = (goal: string) => {
  const knownTerms = ['カメラ', 'パソコン', 'PC', 'ゲーム', '本', 'バッグ', 'ジャケット'];
  return knownTerms.find((term) => goal.toLowerCase().includes(term.toLowerCase())) ?? goal.trim();
};

export const useSandboxRuntime = ({
  domain,
  domainRevision,
  onDomainChange,
  resetDomain,
}: UseSandboxRuntimeOptions) => {
  const [sandbox] = useState(() => new MarketplaceSandbox(domain, DEFAULT_WORLD_SEED));
  const engineRef = useRef<MesaEngineStatus>(browserEngine);
  const onDomainChangeRef = useRef(onDomainChange);
  const resetDomainRef = useRef(resetDomain);
  const steppingRef = useRef(false);
  const initializedRef = useRef(false);
  const stepRef = useRef<() => Promise<SandboxRuntimeState>>(() => Promise.resolve({
    ...sandbox.getState(),
    engine: browserEngine,
  }));
  const [isSandboxConsoleOpen, setIsSandboxConsoleOpen] = useState(false);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('operator');
  const [isWorldHydrated, setIsWorldHydrated] = useState(false);
  const [sandboxState, setSandboxState] = useState<SandboxRuntimeState>(() => ({
    ...sandbox.getState(),
    engine: browserEngine,
  }));

  useEffect(() => {
    onDomainChangeRef.current = onDomainChange;
    resetDomainRef.current = resetDomain;
  }, [onDomainChange, resetDomain]);

  const publishState = useCallback((state = sandbox.getState()) => {
    const runtimeState = { ...state, engine: engineRef.current } satisfies SandboxRuntimeState;
    setSandboxState(runtimeState);
    return runtimeState;
  }, [sandbox]);

  const syncSandbox = useCallback((actorType: ActorType = 'human') => {
    return publishState(sandbox.syncDomainEvents(actorType));
  }, [publishState, sandbox]);

  const recordHumanAction = useCallback((eventType: string, targetId: string, metadata: Record<string, unknown> = {}) => {
    const event = sandbox.recordHumanAction(eventType, targetId, metadata);
    publishState();
    return event;
  }, [publishState, sandbox]);

  useEffect(() => {
    if (initializedRef.current) return undefined;
    initializedRef.current = true;
    let active = true;

    void (async () => {
      try {
        const persisted = await loadWorldSnapshot();
        if (persisted) {
          domain.reset(persisted.marketplaceState);
          sandbox.restoreState(persisted.sandboxState);
          onDomainChangeRef.current();
        }
      } catch {
        // Local development can run before D1 migrations are available.
      }

      let engine = await getMesaEngineStatus();
      if (engine.connected) {
        try {
          await bootstrapMesaWorld(domain.getState(), Number(sandbox.getState().world.seed));
        } catch {
          engine = {
            ...browserEngine,
            detail: 'Mesa bootstrapに失敗したためブラウザ実行を使用中',
          };
        }
      }
      if (!active) return;
      engineRef.current = engine;
      publishState();
      setIsWorldHydrated(true);
    })();

    return () => {
      active = false;
    };
  }, [domain, publishState, sandbox]);

  const stepSimulation = useCallback(async () => {
    if (steppingRef.current) return { ...sandbox.getState(), engine: engineRef.current } satisfies SandboxRuntimeState;
    steppingRef.current = true;
    try {
      const current = sandbox.getState();
      let next: SandboxState;
      if (engineRef.current.connected) {
        try {
          const response = await stepMesaWorld(domain.getState(), 1, current.world.speed);
          for (const intent of response.intents) {
            (sandbox as IntentCapableSandbox).applyCommandIntent(intent);
          }
          next = sandbox.syncDomainEvents('npc');
          next.world.tick = response.tick;
          next.world.simulatedAt = response.simulatedAt;
          (next.world as typeof next.world & { kpis?: Record<string, number> }).kpis = response.metrics;
          sandbox.restoreState(next);
        } catch {
          engineRef.current = {
            ...browserEngine,
            detail: 'Mesa sidecarとの通信が切れたためブラウザ実行へ切替済み',
          };
          next = sandbox.step(1);
        }
      } else {
        next = sandbox.step(1);
      }
      onDomainChangeRef.current();
      return publishState(next);
    } finally {
      steppingRef.current = false;
    }
  }, [domain, publishState, sandbox]);

  useEffect(() => {
    stepRef.current = stepSimulation;
  }, [stepSimulation]);

  useEffect(() => {
    if (sandboxState.world.status !== 'playing') return undefined;
    const intervalId = window.setInterval(() => {
      void stepRef.current();
    }, sandboxState.world.speed === 10 ? 700 : 1_600);
    return () => window.clearInterval(intervalId);
  }, [sandboxState.world.speed, sandboxState.world.status]);

  useEffect(() => {
    if (!isWorldHydrated) return undefined;
    const timeoutId = window.setTimeout(() => {
      const persistableState: SandboxState = {
        world: sandboxState.world,
        events: sandboxState.events,
        wallets: sandboxState.wallets,
        ledger: sandboxState.ledger,
        agentRuns: sandboxState.agentRuns,
      };
      void saveWorldSnapshot(domain.getState(), persistableState).catch(() => {
        // Browser-only previews intentionally keep running when D1 is absent.
      });
    }, 800);
    return () => window.clearTimeout(timeoutId);
  }, [domain, domainRevision, isWorldHydrated, sandboxState]);

  const setSimulationPlaying = useCallback((playing: boolean) => {
    return publishState(sandbox.setPlaying(playing));
  }, [publishState, sandbox]);

  const setSimulationSpeed = useCallback((speed: number) => {
    return publishState(sandbox.setSpeed(speed === 10 ? 10 : 1));
  }, [publishState, sandbox]);

  const runBuyerAgent = useCallback((goal: string): AgentRun => {
    const budget = parseBudget(goal);
    const run = sandbox.runBuyerAgent({
      goal,
      query: inferQuery(goal),
      budget,
      offerPrice: Math.max(300, Math.min(budget, Math.round(budget * 0.85 / 100) * 100)),
    });
    publishState();
    return run;
  }, [publishState, sandbox]);

  const confirmAgentRun = useCallback((runId: string): AgentRun => {
    const run = sandbox.confirmAgentPurchase(runId);
    onDomainChangeRef.current();
    publishState();
    return run;
  }, [publishState, sandbox]);

  const confirmHumanCheckout = useCallback((checkoutId: string) => {
    const actorId = domain.getState().currentUserId;
    const result = sandbox.confirmCheckout(actorId, checkoutId, 'human', `human-checkout-${checkoutId}`);
    onDomainChangeRef.current();
    publishState();
    return result;
  }, [domain, publishState, sandbox]);

  const resetSimulation = useCallback(() => {
    const next = sandbox.reset(DEFAULT_WORLD_SEED);
    resetDomainRef.current();
    publishState(next);
    if (engineRef.current.connected) {
      void bootstrapMesaWorld(domain.getState(), DEFAULT_WORLD_SEED).catch(() => {
        engineRef.current = browserEngine;
        publishState();
      });
    }
    return next;
  }, [domain, publishState, sandbox]);

  return {
    isSandboxConsoleOpen,
    setIsSandboxConsoleOpen,
    sandboxMode,
    setSandboxMode,
    sandboxState,
    isWorldHydrated,
    stepSimulation,
    setSimulationPlaying,
    setSimulationSpeed,
    runBuyerAgent,
    confirmAgentRun,
    confirmHumanCheckout,
    resetSimulation,
    syncSandbox,
    recordHumanAction,
  };
};
