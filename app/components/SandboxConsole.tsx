'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  Gauge,
  Hash,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShoppingBag,
  SkipForward,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { useMercari } from '../context/MercariContext';

type SandboxMode = 'user' | 'operator';
type ConsoleSection = 'overview' | 'events' | 'wallet' | 'agent';
type ActorType = 'human' | 'npc' | 'ai_agent' | 'operator' | 'system';

interface SandboxWorld {
  id?: string;
  name?: string;
  status?: string;
  seed?: string | number;
  simulatedAt?: string;
  tick?: number;
  isPlaying?: boolean;
  playing?: boolean;
  speed?: number;
  kpis?: Record<string, number>;
}

interface SandboxEvent {
  eventId: string;
  eventType: string;
  actorType: string;
  actorId: string;
  targetId?: string;
  correlationId?: string;
  causedBy?: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

interface SandboxWallet {
  id: string;
  userId?: string;
  label?: string;
  ownerName?: string;
  balance?: number;
  availableBalance?: number;
  credits?: number;
}

interface SandboxLedgerEntry {
  id: string;
  walletId: string;
  type: string;
  amount: number;
  transactionId?: string;
  timestamp: string;
  description: string;
}

interface AgentCandidate {
  itemId: string;
  title: string;
  price: number;
  score: number;
  reason: string;
}

interface AgentStep {
  id: string;
  type: string;
  label: string;
  detail: string;
  actorType: string;
  status: string;
  at: string;
}

interface AgentRun {
  id: string;
  status: string;
  goal: string;
  budget: number;
  candidates: AgentCandidate[];
  steps: AgentStep[];
  selectedItemId?: string;
  transactionId?: string;
}

interface SandboxEngine {
  name?: string;
  version?: string;
  connected?: boolean;
  mode?: string;
}

interface SandboxState {
  world?: SandboxWorld;
  events?: SandboxEvent[];
  wallets?: SandboxWallet[];
  ledger?: SandboxLedgerEntry[];
  agentRuns?: AgentRun[];
  engine?: SandboxEngine;
}

interface SandboxConsoleContext {
  isSandboxConsoleOpen: boolean;
  setIsSandboxConsoleOpen: (open: boolean) => void;
  sandboxMode: SandboxMode;
  setSandboxMode: (mode: SandboxMode) => void;
  sandboxState: SandboxState;
  stepSimulation: () => unknown;
  setSimulationPlaying: (playing: boolean) => unknown;
  setSimulationSpeed: (speed: number) => unknown;
  runBuyerAgent: (goal: string) => unknown | Promise<unknown>;
  confirmAgentRun: (runId: string) => unknown | Promise<unknown>;
  resetSimulation: () => unknown;
}

const DEFAULT_AGENT_GOAL = '1万円以内で状態の良いカメラを探して。少しなら値下げ交渉して';
const EMPTY_EVENTS: SandboxEvent[] = [];
const EMPTY_WALLETS: SandboxWallet[] = [];
const EMPTY_LEDGER: SandboxLedgerEntry[] = [];
const EMPTY_AGENT_RUNS: AgentRun[] = [];

const actorOrder: ActorType[] = ['human', 'npc', 'ai_agent', 'operator', 'system'];

const actorPresentation: Record<ActorType, { label: string; dot: string; chip: string; text: string }> = {
  human: {
    label: '人',
    dot: 'bg-[#66c7ed]',
    chip: 'border-[#3b7185] bg-[#183946] text-[#a8e8ff]',
    text: 'text-[#83dcfa]',
  },
  npc: {
    label: 'NPC',
    dot: 'bg-[#ffcf64]',
    chip: 'border-[#755e31] bg-[#3d321d] text-[#ffe09a]',
    text: 'text-[#ffcf64]',
  },
  ai_agent: {
    label: 'AI',
    dot: 'bg-[#ae8cff]',
    chip: 'border-[#62528b] bg-[#302746] text-[#d5c5ff]',
    text: 'text-[#bca2ff]',
  },
  operator: {
    label: 'Operator',
    dot: 'bg-[#ff7080]',
    chip: 'border-[#75444c] bg-[#3f2429] text-[#ffb5be]',
    text: 'text-[#ff8d99]',
  },
  system: {
    label: 'System',
    dot: 'bg-[#91a8b1]',
    chip: 'border-[#53636a] bg-[#29343a] text-[#c1d0d5]',
    text: 'text-[#a8bbc2]',
  },
};

const normalizeActorType = (value: string): ActorType => {
  const normalized = value.toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'human' || normalized === 'user') return 'human';
  if (normalized === 'npc') return 'npc';
  if (normalized === 'ai' || normalized === 'agent' || normalized === 'ai_agent') return 'ai_agent';
  if (normalized === 'operator') return 'operator';
  return 'system';
};

const formatCurrency = (value: number) => `¥${Math.abs(value).toLocaleString('ja-JP')}`;

const formatDateTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
};

const humanizeEventType = (value: string) => value
  .replace(/[._-]+/g, ' ')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .trim();

const readMetric = (source: Record<string, number>, keys: string[], fallback = 0) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return fallback;
};

export const SandboxConsole: React.FC = () => {
  const context = useMercari() as ReturnType<typeof useMercari> & SandboxConsoleContext;
  const {
    isSandboxConsoleOpen,
    setIsSandboxConsoleOpen,
    sandboxMode,
    setSandboxMode,
    sandboxState,
    stepSimulation,
    setSimulationPlaying,
    setSimulationSpeed,
    runBuyerAgent,
    confirmAgentRun,
    resetSimulation,
  } = context;
  const [section, setSection] = useState<ConsoleSection>(() => sandboxMode === 'user' ? 'agent' : 'overview');
  const [eventFilters, setEventFilters] = useState<Set<ActorType>>(() => new Set(actorOrder));
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [agentGoal, setAgentGoal] = useState(DEFAULT_AGENT_GOAL);
  const [isStartingAgent, setIsStartingAgent] = useState(false);
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const world = sandboxState?.world ?? {};
  const events = sandboxState?.events ?? EMPTY_EVENTS;
  const wallets = sandboxState?.wallets ?? EMPTY_WALLETS;
  const ledger = sandboxState?.ledger ?? EMPTY_LEDGER;
  const agentRuns = sandboxState?.agentRuns ?? EMPTY_AGENT_RUNS;
  const engine = sandboxState?.engine;
  const isPlaying = Boolean(world.isPlaying ?? world.playing ?? ['running', 'playing'].includes(world.status?.toLowerCase() ?? ''));
  const simulationSpeed = world.speed ?? 1;

  useEffect(() => {
    if (!isSandboxConsoleOpen) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSandboxConsoleOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSandboxConsoleOpen, sandboxMode, setIsSandboxConsoleOpen]);

  const effectiveWalletId = selectedWalletId && wallets.some((wallet) => wallet.id === selectedWalletId)
    ? selectedWalletId
    : wallets[0]?.id ?? null;
  const filteredEvents = useMemo(() => events.filter((event) => eventFilters.has(normalizeActorType(event.actorType))), [eventFilters, events]);
  const selectedLedger = useMemo(() => ledger
    .filter((entry) => !effectiveWalletId || entry.walletId === effectiveWalletId)
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp)), [effectiveWalletId, ledger]);
  const activeAgentRun = agentRuns[agentRuns.length - 1];

  const kpis = useMemo(() => {
    const values = world.kpis ?? {};
    const transactionEvents = events.filter((event) => /purchase|transaction.*completed/i.test(event.eventType));
    const listingEvents = events.filter((event) => /listing|product.*listed/i.test(event.eventType));
    const views = events.filter((event) => /view/i.test(event.eventType)).length;
    const purchases = transactionEvents.length;
    const conversion = readMetric(values, ['conversion', 'conversionRate'], views ? purchases / views : 0);
    return [
      {
        label: 'GMV',
        value: formatCurrency(readMetric(values, ['gmv', 'GMV'])),
        detail: 'Market Credits',
        icon: CircleDollarSign,
        color: 'text-[#74d5f3]',
      },
      {
        label: 'Conversion',
        value: `${(conversion <= 1 ? conversion * 100 : conversion).toFixed(1)}%`,
        detail: `${views.toLocaleString()} views`,
        icon: Gauge,
        color: 'text-[#54d98d]',
      },
      {
        label: 'Listings',
        value: Math.round(readMetric(values, ['listings', 'activeListings'], listingEvents.length)).toLocaleString(),
        detail: '公開・新規出品',
        icon: ShoppingBag,
        color: 'text-[#ffcf64]',
      },
      {
        label: 'Transactions',
        value: Math.round(readMetric(values, ['transactions', 'completedTransactions'], purchases)).toLocaleString(),
        detail: `${agentRuns.length} agent runs`,
        icon: Activity,
        color: 'text-[#bca2ff]',
      },
    ];
  }, [agentRuns.length, events, world.kpis]);

  const toggleEventFilter = (actorType: ActorType) => {
    setEventFilters((current) => {
      const next = new Set(current);
      if (next.has(actorType)) next.delete(actorType);
      else next.add(actorType);
      return next;
    });
  };

  const handleRunAgent = async () => {
    const goal = agentGoal.trim();
    if (!goal || isStartingAgent) return;
    setIsStartingAgent(true);
    try {
      await Promise.resolve(runBuyerAgent(goal));
    } finally {
      setIsStartingAgent(false);
    }
  };

  const handleConfirmAgentRun = async (runId: string) => {
    if (confirmingRunId) return;
    setConfirmingRunId(runId);
    try {
      await Promise.resolve(confirmAgentRun(runId));
    } finally {
      setConfirmingRunId(null);
    }
  };

  if (!isSandboxConsoleOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/75 backdrop-blur-sm" data-testid="sandbox-console">
      <button
        type="button"
        aria-label="サンドボックスコンソールを閉じる"
        className="hidden min-w-0 flex-1 cursor-default md:block"
        onClick={() => setIsSandboxConsoleOpen(false)}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sandbox-console-title"
        className="flex h-full w-full flex-col overflow-hidden border-l border-[#3e5964] bg-[#111b20] shadow-2xl md:max-w-[960px]"
      >
        <header className="shrink-0 border-b border-[#34464e] bg-[rgba(18,30,35,.97)] px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#31515f] bg-[#173643] text-[#77d7f5]">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#67c7e5]">Market debugger</p>
              <h2 id="sandbox-console-title" className="truncate text-base font-black text-white sm:text-lg">Furima Sandbox Console</h2>
            </div>
            <ModeSwitch mode={sandboxMode} onChange={setSandboxMode} />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setIsSandboxConsoleOpen(false)}
              aria-label="コンソールを閉じる"
              className="rounded-full border border-[#40535b] p-2 text-[#a8bac1] hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto no-scrollbar" aria-label="コンソール表示">
            {([
              ['overview', 'Overview', Gauge],
              ['events', 'Events', Activity],
              ['wallet', 'Wallet', WalletCards],
              ['agent', 'Agent', Bot],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-current={section === value ? 'page' : undefined}
                onClick={() => setSection(value)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${section === value ? 'bg-[#285467] text-white' : 'text-[#8ea3ac] hover:bg-white/5 hover:text-white'}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
              </button>
            ))}
          </nav>
        </header>

        <div className="shop-scrollbar min-h-0 flex-1 overflow-y-auto">
          {section === 'overview' && (
            <OverviewPanel
              world={world}
              isPlaying={isPlaying}
              simulationSpeed={simulationSpeed}
              kpis={kpis}
              engine={engine}
              events={filteredEvents.slice(-6).reverse()}
              eventFilters={eventFilters}
              onToggleEventFilter={toggleEventFilter}
              onPlayChange={setSimulationPlaying}
              onStep={stepSimulation}
              onSpeedChange={setSimulationSpeed}
              onReset={resetSimulation}
              onShowEvents={() => setSection('events')}
            />
          )}
          {section === 'events' && (
            <EventsPanel
              events={filteredEvents}
              eventFilters={eventFilters}
              onToggleEventFilter={toggleEventFilter}
            />
          )}
          {section === 'wallet' && (
            <WalletPanel
              wallets={wallets}
              ledger={selectedLedger}
              selectedWalletId={effectiveWalletId}
              onSelectWallet={setSelectedWalletId}
            />
          )}
          {section === 'agent' && (
            <AgentPanel
              goal={agentGoal}
              onGoalChange={setAgentGoal}
              onRun={handleRunAgent}
              isStarting={isStartingAgent}
              activeRun={activeAgentRun}
              confirmingRunId={confirmingRunId}
              onConfirm={handleConfirmAgentRun}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const ModeSwitch: React.FC<{ mode: SandboxMode; onChange: (mode: SandboxMode) => void }> = ({ mode, onChange }) => (
  <div className="hidden rounded-lg border border-[#40535b] bg-[#0e181c] p-1 sm:flex" role="group" aria-label="表示モード">
    {([
      ['user', 'USER', UserRound],
      ['operator', 'OPERATOR', Gauge],
    ] as const).map(([value, label, Icon]) => (
      <button
        key={value}
        type="button"
        aria-pressed={mode === value}
        onClick={() => onChange(value)}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-black tracking-[0.08em] ${mode === value ? 'bg-[#76d2ef] text-[#10272f]' : 'text-[#8098a2] hover:text-white'}`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
      </button>
    ))}
  </div>
);

interface KpiViewModel {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  color: string;
}

const OverviewPanel: React.FC<{
  world: SandboxWorld;
  isPlaying: boolean;
  simulationSpeed: number;
  kpis: KpiViewModel[];
  engine?: SandboxEngine;
  events: SandboxEvent[];
  eventFilters: Set<ActorType>;
  onToggleEventFilter: (actorType: ActorType) => void;
  onPlayChange: (playing: boolean) => unknown;
  onStep: () => unknown;
  onSpeedChange: (speed: number) => unknown;
  onReset: () => unknown;
  onShowEvents: () => void;
}> = ({ world, isPlaying, simulationSpeed, kpis, engine, events, eventFilters, onToggleEventFilter, onPlayChange, onStep, onSpeedChange, onReset, onShowEvents }) => (
  <div className="space-y-6 p-4 sm:p-6">
    <WorldControlCard
      world={world}
      isPlaying={isPlaying}
      simulationSpeed={simulationSpeed}
      onPlayChange={onPlayChange}
      onStep={onStep}
      onSpeedChange={onSpeedChange}
      onReset={onReset}
    />

    <EngineCard engine={engine} />

    <section aria-labelledby="kpi-heading">
      <SectionTitle eyebrow="World metrics" title="市場KPI" id="kpi-heading" />
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, detail, icon: Icon, color }) => (
          <article key={label} className="rounded-2xl border border-[#34464d] bg-[#1b282e] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#78939e]">{label}</span>
              <Icon className={`h-4 w-4 ${color}`} aria-hidden="true" />
            </div>
            <p className="mt-3 text-xl font-black tracking-tight text-white sm:text-2xl">{value}</p>
            <p className="mt-1 text-[10px] text-[#78939e]">{detail}</p>
          </article>
        ))}
      </div>
    </section>

    <section aria-labelledby="recent-events-heading">
      <div className="flex items-end justify-between gap-4">
        <SectionTitle eyebrow="Observable market" title="最新イベント" id="recent-events-heading" />
        <button type="button" onClick={onShowEvents} className="flex items-center gap-1 text-xs font-bold text-[#77d7f5] hover:text-white">すべて見る<ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="mt-3">
        <EventFilters selected={eventFilters} onToggle={onToggleEventFilter} />
        <EventTimeline events={events} compact />
      </div>
    </section>
  </div>
);

const EngineCard: React.FC<{ engine?: SandboxEngine }> = ({ engine }) => {
  const connected = Boolean(engine?.connected);
  const engineLabel = `${engine?.name || 'Mesa'} ${engine?.version || '3.5.1'}`;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#34464d] bg-[#1b282e] p-4 sm:flex-row sm:items-center sm:justify-between" aria-labelledby="simulation-engine-heading">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#302746] text-[#bca2ff]"><Users className="h-5 w-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">Simulation engine</p>
          <h3 id="simulation-engine-heading" className="mt-1 text-sm font-black text-white">{engineLabel}</h3>
          <p className="mt-1 max-w-2xl text-[10px] leading-5 text-[#8297a0]">NPCの意図はMesaが生成し、出品・購入・発送などの状態変更はHumanやAI Agentと同じApplication Coreを通ります。</p>
        </div>
      </div>
      <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[9px] font-black ${connected ? 'border-[#3c7860] bg-[#173b2d] text-[#8deab3]' : 'border-[#62528b] bg-[#302746] text-[#d5c5ff]'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse bg-[#54d98d]' : 'bg-[#ae8cff]'}`} />
        {connected ? '接続済み' : 'ブラウザ・フォールバック'}
      </span>
    </section>
  );
};

const WorldControlCard: React.FC<{
  world: SandboxWorld;
  isPlaying: boolean;
  simulationSpeed: number;
  onPlayChange: (playing: boolean) => unknown;
  onStep: () => unknown;
  onSpeedChange: (speed: number) => unknown;
  onReset: () => unknown;
}> = ({ world, isPlaying, simulationSpeed, onPlayChange, onStep, onSpeedChange, onReset }) => {
  const status = world.status ?? (isPlaying ? 'RUNNING' : 'PAUSED');
  return (
    <section className="overflow-hidden rounded-2xl border border-[#31515f] bg-[linear-gradient(135deg,#17323d,#19292f_60%,#162329)]" aria-labelledby="world-status-heading">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="world-status-heading" className="truncate text-lg font-black text-white">{world.name || 'Default World'}</h3>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${isPlaying ? 'border-[#397458] bg-[#173b2d] text-[#80e9ad]' : 'border-[#59676c] bg-[#28343a] text-[#b3c2c8]'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isPlaying ? 'animate-pulse bg-[#54d98d]' : 'bg-[#91a8b1]'}`} />{status}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#8ea8b2]">
            <span className="flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" />seed <strong className="font-bold text-white">{world.seed ?? '12345'}</strong></span>
            <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /><strong className="font-bold text-white">{formatDateTime(world.simulatedAt)}</strong></span>
            <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />tick <strong className="font-bold text-white">{(world.tick ?? 0).toLocaleString()}</strong></span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="シミュレーション操作">
          <ControlButton onClick={() => onPlayChange(!isPlaying)} active={isPlaying} label={isPlaying ? 'Pause' : 'Play'} icon={isPlaying ? Pause : Play} />
          <ControlButton onClick={onStep} label="Step" icon={SkipForward} />
          {[1, 10].map((speed) => (
            <button key={speed} type="button" onClick={() => onSpeedChange(speed)} aria-pressed={simulationSpeed === speed} className={`h-9 min-w-11 rounded-lg border px-2 text-xs font-black ${simulationSpeed === speed ? 'border-[#76d2ef] bg-[#234c5c] text-white' : 'border-[#40535b] bg-[#172329] text-[#91a8b1] hover:text-white'}`}>{speed}x</button>
          ))}
          <ControlButton onClick={onReset} label="Reset" icon={RotateCcw} tone="danger" />
        </div>
      </div>
    </section>
  );
};

const ControlButton: React.FC<{ onClick: () => unknown; label: string; icon: React.ElementType; active?: boolean; tone?: 'default' | 'danger' }> = ({ onClick, label, icon: Icon, active = false, tone = 'default' }) => (
  <button type="button" onClick={onClick} className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-black transition-colors ${tone === 'danger' ? 'border-[#70434a] bg-[#392328] text-[#ff9ca7] hover:bg-[#48282e]' : active ? 'border-[#4d8b6a] bg-[#1d4936] text-[#9bf0bd]' : 'border-[#40535b] bg-[#172329] text-[#c0ced3] hover:border-[#5a737d] hover:text-white'}`}>
    <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
  </button>
);

const EventsPanel: React.FC<{ events: SandboxEvent[]; eventFilters: Set<ActorType>; onToggleEventFilter: (actorType: ActorType) => void }> = ({ events, eventFilters, onToggleEventFilter }) => {
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const visibleEvents = correlationId ? events.filter((event) => event.correlationId === correlationId) : events;
  return (
    <div className="p-4 sm:p-6">
    <div className="flex flex-col gap-4 border-b border-[#34464d] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <SectionTitle eyebrow="Append-only timeline" title="Event Timeline" id="event-timeline-heading" />
      <p className="text-xs text-[#78939e]">表示中 {visibleEvents.length.toLocaleString()} events</p>
    </div>
    <div className="sticky top-0 z-10 -mx-4 border-b border-[#34464d] bg-[rgba(17,27,32,.96)] px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <EventFilters selected={eventFilters} onToggle={onToggleEventFilter} />
      {correlationId && <button type="button" onClick={() => setCorrelationId(null)} className="mt-2 rounded-full border border-[#62528b] bg-[#302746] px-2.5 py-1 text-[9px] font-bold text-[#d5c5ff]">因果フィルタを解除: {correlationId}</button>}
    </div>
    <EventTimeline events={visibleEvents} selectedCorrelationId={correlationId} onSelectCorrelation={setCorrelationId} />
    </div>
  );
};

const EventFilters: React.FC<{ selected: Set<ActorType>; onToggle: (actorType: ActorType) => void }> = ({ selected, onToggle }) => (
  <div className="flex flex-wrap gap-2" role="group" aria-label="イベントの主体で絞り込む">
    {actorOrder.map((actorType) => {
      const presentation = actorPresentation[actorType];
      const active = selected.has(actorType);
      return (
        <button
          key={actorType}
          type="button"
          aria-pressed={active}
          onClick={() => onToggle(actorType)}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold transition-opacity ${presentation.chip} ${active ? 'opacity-100' : 'opacity-35'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />{presentation.label}
        </button>
      );
    })}
  </div>
);

const EventTimeline: React.FC<{ events: SandboxEvent[]; compact?: boolean; selectedCorrelationId?: string | null; onSelectCorrelation?: (correlationId: string) => void }> = ({ events, compact = false, selectedCorrelationId, onSelectCorrelation }) => {
  if (!events.length) {
    return <EmptyState icon={Activity} title="イベントはまだありません" body="市場で操作するか、シミュレーションを進めるとここに記録されます。" />;
  }
  return (
    <ol className={`relative mt-4 ${compact ? 'space-y-2' : 'space-y-3'}`} aria-label="市場イベント">
      {events.map((event) => {
        const actorType = normalizeActorType(event.actorType);
        const presentation = actorPresentation[actorType];
        const metadataEntries = Object.entries(event.metadata ?? {}).slice(0, compact ? 2 : 4);
        return (
          <li key={event.eventId} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-3">
            <div className="relative flex justify-center">
              <span className={`relative z-10 mt-4 h-2.5 w-2.5 rounded-full ring-4 ring-[#111b20] ${presentation.dot}`} />
              <span className="absolute bottom-[-12px] top-5 w-px bg-[#34464d] last:hidden" aria-hidden="true" />
            </div>
            <article className="min-w-0 rounded-xl border border-[#34464d] bg-[#1a262c] p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[9px] font-black uppercase tracking-[0.12em] ${presentation.text}`}>{presentation.label}</span>
                    <h4 className="break-words text-xs font-black text-white">{humanizeEventType(event.eventType)}</h4>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-[#78939e]">actor: {event.actorId}{event.targetId ? ` → ${event.targetId}` : ''}</p>
                  {!compact && event.correlationId && <button type="button" onClick={() => onSelectCorrelation?.(event.correlationId!)} className={`mt-1 max-w-full truncate text-left font-mono text-[9px] ${selectedCorrelationId === event.correlationId ? 'text-[#d5c5ff]' : 'text-[#698690] hover:text-[#bca2ff]'}`}>corr: {event.correlationId}{event.causedBy ? ` · caused by ${event.causedBy}` : ''}</button>}
                </div>
                <time className="shrink-0 text-[9px] text-[#6f8791]" dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
              </div>
              {metadataEntries.length > 0 && (
                <dl className="mt-3 flex flex-wrap gap-1.5">
                  {metadataEntries.map(([key, value]) => (
                    <div key={key} className="flex max-w-full gap-1 rounded-md bg-black/20 px-2 py-1 text-[9px]">
                      <dt className="shrink-0 text-[#68808a]">{key}</dt>
                      <dd className="truncate text-[#aebec4]">{typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
};

const WalletPanel: React.FC<{
  wallets: SandboxWallet[];
  ledger: SandboxLedgerEntry[];
  selectedWalletId: string | null;
  onSelectWallet: (walletId: string) => void;
}> = ({ wallets, ledger, selectedWalletId, onSelectWallet }) => (
  <div className="space-y-6 p-4 sm:p-6">
    <div className="flex items-end justify-between gap-4">
      <SectionTitle eyebrow="Sandbox economy" title="Wallet & Ledger" id="wallet-heading" />
      <span className="rounded-full border border-[#3c7860] bg-[#173b2d] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#8deab3]">Market Credits</span>
    </div>
    {wallets.length ? (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label="ウォレット一覧">
        {wallets.map((wallet) => {
          const selected = wallet.id === selectedWalletId;
          const balance = wallet.balance ?? wallet.availableBalance ?? wallet.credits ?? 0;
          return (
            <button
              key={wallet.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelectWallet(wallet.id)}
              className={`rounded-2xl border p-4 text-left transition-colors ${selected ? 'border-[#76d2ef] bg-[#183743]' : 'border-[#34464d] bg-[#1b282e] hover:border-[#56737e]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/20 text-[#77d7f5]"><WalletCards className="h-4 w-4" /></span>
                {selected && <span className="flex items-center gap-1 text-[9px] font-black text-[#8de3fb]"><Check className="h-3 w-3" />選択中</span>}
              </div>
              <p className="mt-4 truncate text-xs font-bold text-[#94aab3]">{wallet.ownerName || wallet.label || wallet.userId || wallet.id}</p>
              <p className="mt-1 text-2xl font-black tracking-tight text-white">{formatCurrency(balance)}</p>
              <p className="mt-1 truncate text-[9px] text-[#68808a]">{wallet.id}</p>
            </button>
          );
        })}
      </div>
    ) : <EmptyState icon={WalletCards} title="ウォレットはまだありません" body="Worldを初期化すると、参加者ごとのMarket Creditsが作成されます。" />}

    <section aria-labelledby="ledger-heading">
      <div className="flex items-end justify-between gap-4 border-b border-[#34464d] pb-3">
        <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">Append-only</p><h3 id="ledger-heading" className="mt-1 text-base font-black text-white">Ledger</h3></div>
        <p className="text-[10px] text-[#78939e]">{ledger.length} entries</p>
      </div>
      {ledger.length ? (
        <div className="divide-y divide-[#34464d]">
          {ledger.map((entry) => {
            const positive = entry.amount >= 0 && !/debit|hold|fee/i.test(entry.type);
            return (
              <article key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase ${positive ? 'border-[#3c7860] bg-[#173b2d] text-[#8deab3]' : 'border-[#70434a] bg-[#392328] text-[#ff9ca7]'}`}>{entry.type}</span>{entry.transactionId && <span className="truncate text-[9px] text-[#68808a]">tx: {entry.transactionId}</span>}</div>
                  <p className="mt-2 truncate text-xs font-bold text-white">{entry.description}</p>
                  <time className="mt-1 block text-[9px] text-[#68808a]" dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time>
                </div>
                <p className={`self-center text-sm font-black ${positive ? 'text-[#74dda0]' : 'text-[#ff8996]'}`}>{positive ? '+' : '−'}{formatCurrency(entry.amount)}</p>
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon={CircleDollarSign} title="Ledgerは空です" body="購入・返金・エスクローの操作が発生すると、残高を上書きせず取引行として記録します。" />}
    </section>
  </div>
);

const AgentPanel: React.FC<{
  goal: string;
  onGoalChange: (goal: string) => void;
  onRun: () => void;
  isStarting: boolean;
  activeRun?: AgentRun;
  confirmingRunId: string | null;
  onConfirm: (runId: string) => void;
}> = ({ goal, onGoalChange, onRun, isStarting, activeRun, confirmingRunId, onConfirm }) => {
  const normalizedStatus = activeRun?.status.toUpperCase().replace(/[-\s]/g, '_') ?? '';
  const runInProgress = ['QUEUED', 'RUNNING', 'SEARCHING', 'NEGOTIATING'].includes(normalizedStatus);
  const canConfirm = Boolean(activeRun?.selectedItemId && !activeRun.transactionId && !runInProgress && !['FAILED', 'CANCELED'].includes(normalizedStatus));
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <section className="overflow-hidden rounded-2xl border border-[#4e4771] bg-[linear-gradient(135deg,#26233b,#1c2833_60%,#18323c)]" aria-labelledby="agent-run-heading">
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8b6fe0]/20 text-[#c2acff]"><Bot className="h-5 w-5" /></span>
            <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#bca2ff]">Buyer Agent</p><h3 id="agent-run-heading" className="mt-1 text-lg font-black text-white">市場で動くAIへ依頼</h3><p className="mt-1 text-xs leading-5 text-[#98acb5]">検索・比較・値下げ交渉までを、Human/NPCと同じCommand Layerで実行します。</p></div>
          </div>
        </div>
        <div className="p-5">
          <label htmlFor="buyer-agent-goal" className="text-xs font-bold text-white">依頼内容</label>
          <textarea
            id="buyer-agent-goal"
            value={goal}
            onChange={(event) => onGoalChange(event.target.value)}
            rows={3}
            placeholder="予算や探している商品、交渉条件を入力"
            className="mt-2 w-full resize-none rounded-xl border border-[#4c5669] bg-black/20 px-3.5 py-3 text-sm leading-6 text-white outline-none placeholder:text-[#61737c] focus:border-[#a98df5]"
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => onGoalChange(DEFAULT_AGENT_GOAL)} className="text-left text-[10px] font-bold text-[#bca2ff] hover:text-white">プリセットを入力</button>
            <button type="button" disabled={!goal.trim() || isStarting || runInProgress} onClick={onRun} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#a98df5] px-5 text-xs font-black text-[#1d1730] hover:bg-[#c5b3ff] disabled:cursor-not-allowed disabled:opacity-45">
              {isStarting || runInProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{isStarting ? 'Starting…' : runInProgress ? 'Agent running…' : 'Run Buyer Agent'}
            </button>
          </div>
        </div>
      </section>

      {activeRun ? (
        <>
          <AgentRunHeader run={activeRun} />
          <CandidateGrid run={activeRun} />
          <AgentSteps steps={activeRun.steps ?? []} />
          {activeRun.transactionId && (
            <div className="flex items-start gap-3 rounded-2xl border border-[#3c7860] bg-[#173b2d] p-4 text-[#b9f3d1]">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="text-sm font-black">購入処理が完了しました</p><p className="mt-1 break-all text-[10px] text-[#8acba5]">transaction: {activeRun.transactionId}</p></div>
            </div>
          )}
          {canConfirm && (
            <div className="sticky bottom-0 -mx-4 border-t border-[#40505a] bg-[rgba(17,27,32,.96)] px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
              <div className="flex flex-col gap-3 rounded-2xl border border-[#526177] bg-[#202b36] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-black text-white">購入前の確認が必要です</p><p className="mt-1 text-[10px] text-[#91a4ad]">Agentが選んだ候補と価格を確認して実行してください。</p></div>
                <button type="button" disabled={confirmingRunId === activeRun.id} onClick={() => onConfirm(activeRun.id)} className="flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#54d98d] px-5 text-xs font-black text-[#10271b] hover:bg-[#8deab3] disabled:opacity-50">
                  {confirmingRunId === activeRun.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}この候補を購入する
                </button>
              </div>
            </div>
          )}
        </>
      ) : <EmptyState icon={Bot} title="Agent runはまだありません" body="依頼を実行すると、候補3件とSearch → Compare → Offerの行動履歴をここで確認できます。" />}
    </div>
  );
};

const AgentRunHeader: React.FC<{ run: AgentRun }> = ({ run }) => {
  const status = run.status || 'UNKNOWN';
  const successful = /complete|purchased|success/i.test(status);
  const failed = /fail|cancel/i.test(status);
  return (
    <section className="rounded-2xl border border-[#34464d] bg-[#1b282e] p-4" aria-labelledby="active-run-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">Latest run</p><h3 id="active-run-heading" className="mt-1 truncate text-sm font-black text-white">AgentRun {run.id}</h3></div>
        <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] ${successful ? 'border-[#3c7860] bg-[#173b2d] text-[#8deab3]' : failed ? 'border-[#70434a] bg-[#392328] text-[#ff9ca7]' : 'border-[#62528b] bg-[#302746] text-[#d5c5ff]'}`}>{status}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-black/15 p-3"><span className="block text-[9px] text-[#78939e]">Budget</span><strong className="mt-1 block text-sm text-white">{formatCurrency(run.budget || 0)}</strong></div>
        <div className="rounded-lg bg-black/15 p-3"><span className="block text-[9px] text-[#78939e]">Candidates</span><strong className="mt-1 block text-sm text-white">{run.candidates?.length ?? 0}</strong></div>
      </div>
    </section>
  );
};

const CandidateGrid: React.FC<{ run: AgentRun }> = ({ run }) => (
  <section aria-labelledby="candidate-heading">
    <div className="flex items-end justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">Compare</p><h3 id="candidate-heading" className="mt-1 text-base font-black text-white">候補3件</h3></div><span className="text-[10px] text-[#78939e]">score / 100</span></div>
    {run.candidates?.length ? (
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {run.candidates.slice(0, 3).map((candidate, index) => {
          const selected = run.selectedItemId === candidate.itemId;
          return (
            <article key={candidate.itemId} className={`relative overflow-hidden rounded-2xl border p-4 ${selected ? 'border-[#a98df5] bg-[#302746]' : 'border-[#34464d] bg-[#1b282e]'}`}>
              {selected && <span className="absolute right-3 top-3 rounded-full bg-[#a98df5] px-2 py-1 text-[9px] font-black text-[#1d1730]">SELECTED</span>}
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/20 text-[10px] font-black text-[#9bb0b9]">#{index + 1}</span>
              <h4 className="mt-3 line-clamp-2 min-h-10 text-sm font-black leading-5 text-white">{candidate.title}</h4>
              <p className="mt-2 text-xl font-black text-white">{formatCurrency(candidate.price)}</p>
              <div className="mt-3 flex items-center gap-2"><div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/25"><span className="block h-full rounded-full bg-[#a98df5]" style={{ width: `${Math.max(0, Math.min(100, candidate.score))}%` }} /></div><strong className="text-xs text-[#cbb9ff]">{candidate.score}</strong></div>
              <p className="mt-3 text-[10px] leading-5 text-[#91a4ad]">{candidate.reason}</p>
            </article>
          );
        })}
      </div>
    ) : <EmptyState icon={Search} title="候補を検索中です" body="市場の商品を比較すると、上位3件がここに表示されます。" compact />}
  </section>
);

const stepIcons: Record<string, React.ElementType> = {
  search: Search,
  view: Eye,
  compare: Gauge,
  offer: MessageSquare,
  purchase: ShoppingBag,
};

const AgentSteps: React.FC<{ steps: AgentStep[] }> = ({ steps }) => (
  <section aria-labelledby="agent-steps-heading">
    <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">Action trace</p><h3 id="agent-steps-heading" className="mt-1 text-base font-black text-white">Agent steps</h3></div>
    {steps.length ? (
      <ol className="mt-3 space-y-2">
        {steps.map((step, index) => {
          const Icon = stepIcons[step.type.toLowerCase()] ?? Activity;
          const completed = /complete|success|done/i.test(step.status);
          const failed = /fail|error/i.test(step.status);
          const actor = actorPresentation[normalizeActorType(step.actorType)];
          return (
            <li key={step.id} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-[#34464d] bg-[#1a262c] p-3">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${completed ? 'bg-[#173b2d] text-[#74dda0]' : failed ? 'bg-[#392328] text-[#ff8996]' : 'bg-[#302746] text-[#bca2ff]'}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-black text-[#68808a]">{String(index + 1).padStart(2, '0')}</span><h4 className="text-xs font-black text-white">{step.label}</h4><span className={`text-[8px] font-black uppercase ${actor.text}`}>{actor.label}</span></div><p className="mt-1 text-[10px] leading-5 text-[#8297a0]">{step.detail}</p></div>
              <span className="mt-1" title={step.status}>{completed ? <CheckCircle2 className="h-4 w-4 text-[#54d98d]" /> : failed ? <AlertCircle className="h-4 w-4 text-[#ff7080]" /> : <Loader2 className="h-4 w-4 animate-spin text-[#bca2ff]" />}</span>
            </li>
          );
        })}
      </ol>
    ) : <EmptyState icon={Activity} title="行動待ちです" body="AgentがToolを呼ぶたびに、因果関係を保ったstepが追加されます。" compact />}
  </section>
);

const SectionTitle: React.FC<{ eyebrow: string; title: string; id: string }> = ({ eyebrow, title, id }) => (
  <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#6f929f]">{eyebrow}</p><h3 id={id} className="mt-1 text-base font-black text-white">{title}</h3></div>
);

const EmptyState: React.FC<{ icon: React.ElementType; title: string; body: string; compact?: boolean }> = ({ icon: Icon, title, body, compact = false }) => (
  <div className={`mt-4 rounded-2xl border border-dashed border-[#40535b] bg-[#172329] text-center ${compact ? 'p-5' : 'p-8'}`}>
    <Icon className="mx-auto h-6 w-6 text-[#617984]" aria-hidden="true" />
    <p className="mt-3 text-xs font-black text-white">{title}</p>
    <p className="mx-auto mt-1 max-w-md text-[10px] leading-5 text-[#718993]">{body}</p>
  </div>
);
