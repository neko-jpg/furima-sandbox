'use client';

import React, { useMemo, useState } from 'react';
import { Activity, ChevronDown, Clock3, RotateCcw, ShieldCheck, UserRound, X } from 'lucide-react';
import { useMercari } from '../context/MercariContext';
import type { ScenarioId } from '../types/mercari';

// The inspector exposes sandbox-control operations and is disabled in
// production unless an explicit build-time flag enables the demo surface.
const INSPECTOR_ENABLED = __FURIMA_ENABLE_SANDBOX_INSPECTOR__;

const scenarioLabels: Record<ScenarioId, string> = {
  catalog_default: 'カタログ初期状態',
  purchase_happy_path: '正常購入',
  already_sold: '売切れ商品',
  multi_inventory: '複数在庫',
  auction_outbid: '入札競合',
  listing_policy_blocked: '禁止出品',
  zero_search_results: '検索0件',
  payment_timeout: '決済失敗',
  delivery_delay: '配送例外',
};

export const SandboxInspector: React.FC = () => {
  const { activeActor, sandboxSnapshot, switchActor, loadScenario, advanceClock, isDeviceFrame } = useMercari();
  const [isOpen, setIsOpen] = useState(false);
  const [scenario, setScenario] = useState<ScenarioId>(sandboxSnapshot.scenarioId);
  const [feedback, setFeedback] = useState<string | null>(null);
  const recentEvents = useMemo(() => sandboxSnapshot.events.slice(-5).reverse(), [sandboxSnapshot.events]);

  if (!INSPECTOR_ENABLED) return null;

  const run = (action: () => { ok: boolean; message?: string }) => {
    const result = action();
    setFeedback(result.ok ? '操作を適用しました' : result.message ?? '操作に失敗しました');
  };
  const bottomOffset = isDeviceFrame ? 'bottom-[calc(58px+env(safe-area-inset-bottom)+0.75rem)]' : 'bottom-[calc(58px+env(safe-area-inset-bottom)+0.75rem)] md:bottom-3';
  const handleLoad = () => run(() => {
    const result = loadScenario(scenario);
    if (result.ok) setScenario(result.data.scenarioId);
    return result;
  });

  return (
    <aside className={`${isDeviceFrame ? 'absolute' : 'fixed'} ${bottomOffset} right-3 z-[90] w-[min(380px,calc(100vw-24px))] text-sm`} aria-label="Sandbox Inspector">
      {!isOpen ? (
        <button type="button" onClick={() => setIsOpen(true)} className="flex items-center gap-2 rounded-full border border-[#2b5367] bg-[#122b3a]/95 px-4 py-2.5 font-bold text-[#c5eaff] shadow-xl backdrop-blur" aria-expanded="false">
          <Activity className="h-4 w-4" /> Sandbox Inspector <span className="text-xs text-[#7bb9d5]">{sandboxSnapshot.scenarioId} / v{sandboxSnapshot.stateVersion}</span>
        </button>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[#2b5367] bg-[#12202a]/98 text-[#d8f2ff] shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-[#2b5367] px-4 py-3">
            <div className="flex items-center gap-2 font-black"><Activity className="h-4 w-4 text-[#77c7f2]" /> Sandbox Inspector</div>
            <button type="button" onClick={() => setIsOpen(false)} aria-label="Sandbox Inspectorを閉じる" className="rounded-full p-1 text-[#8fb6c7] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-black/20 p-2"><span className="block text-[#8fb6c7]">Scenario</span><strong>{scenarioLabels[sandboxSnapshot.scenarioId]}</strong></div>
              <div className="rounded-lg bg-black/20 p-2"><span className="block text-[#8fb6c7]">State version</span><strong>v{sandboxSnapshot.stateVersion}</strong></div>
              <div className="rounded-lg bg-black/20 p-2"><span className="block text-[#8fb6c7]">仮想時計</span><strong>{sandboxSnapshot.now}</strong></div>
              <div className="rounded-lg bg-black/20 p-2"><span className="block text-[#8fb6c7]">Invariant</span><strong className={sandboxSnapshot.invariantViolations.length ? 'text-red-300' : 'text-emerald-300'}>{sandboxSnapshot.invariantViolations.length ? `${sandboxSnapshot.invariantViolations.length}件違反` : '正常'}</strong></div>
            </div>
            <label className="block text-[11px] font-bold"><span className="mb-1 flex items-center gap-1 text-[#8fb6c7]"><UserRound className="h-3.5 w-3.5" /> Actor</span><select value={activeActor.id} onChange={(event) => run(() => switchActor(event.target.value))} className="w-full rounded-lg border border-[#2b5367] bg-[#1a303d] px-2.5 py-2 text-xs text-white outline-none focus:border-[#77c7f2]"><option value={activeActor.id}>{activeActor.name} ({activeActor.role})</option>{sandboxSnapshot.actors.filter((actor) => actor.id !== activeActor.id).map((actor) => <option key={actor.id} value={actor.id}>{actor.name} ({actor.role})</option>)}</select></label>
            <label className="block text-[11px] font-bold"><span className="mb-1 block text-[#8fb6c7]">Scenarioを読み込む</span><select key={sandboxSnapshot.scenarioId} defaultValue={sandboxSnapshot.scenarioId} onChange={(event) => setScenario(event.target.value as ScenarioId)} className="w-full rounded-lg border border-[#2b5367] bg-[#1a303d] px-2.5 py-2 text-xs text-white outline-none focus:border-[#77c7f2]">{(Object.keys(scenarioLabels) as ScenarioId[]).map((id) => <option key={id} value={id}>{scenarioLabels[id]}</option>)}</select></label>
            <div className="grid grid-cols-3 gap-2"><button type="button" onClick={handleLoad} className="flex items-center justify-center gap-1 rounded-lg bg-[#1d5470] px-2 py-2 text-[11px] font-bold text-white hover:bg-[#276c8e]"><RotateCcw className="h-3.5 w-3.5" />Load</button><button type="button" onClick={() => run(() => advanceClock(15 * 60 * 1000))} className="flex items-center justify-center gap-1 rounded-lg border border-[#2b5367] px-2 py-2 text-[11px] font-bold text-[#c5eaff] hover:bg-white/10"><Clock3 className="h-3.5 w-3.5" />+15分</button><button type="button" onClick={() => setIsOpen(false)} className="flex items-center justify-center gap-1 rounded-lg border border-[#2b5367] px-2 py-2 text-[11px] font-bold text-[#c5eaff] hover:bg-white/10"><ChevronDown className="h-3.5 w-3.5" />縮小</button></div>
            <div className="rounded-lg border border-[#2b5367] bg-black/20 p-2.5"><div className="mb-2 flex items-center gap-1 text-[11px] font-bold text-[#8fb6c7]"><ShieldCheck className="h-3.5 w-3.5" /> Domain events</div>{recentEvents.length ? <div className="space-y-1.5">{recentEvents.map((event) => <div key={event.id} className="flex items-center justify-between gap-2 text-[10px]"><span className="truncate text-white">#{event.stateVersion} {event.type}</span><span className="shrink-0 text-[#8fb6c7]">{event.actorId}</span></div>)}</div> : <p className="text-[10px] text-[#8fb6c7]">まだイベントはありません</p>}</div>
            {feedback && <p className="text-[11px] text-[#9dd8f5]" role="status">{feedback}</p>}
          </div>
        </div>
      )}
    </aside>
  );
};
