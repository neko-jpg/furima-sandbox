'use client';

import React, { useEffect, useState } from 'react';
import { Barcode, Camera, ChevronRight, FileText, Lightbulb, Plus, Sparkles, Truck, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { Footer } from '../Footer';

export const ListingView: React.FC = () => {
  const { isListingModalOpen, setIsListingModalOpen, addNewItem, isDeviceFrame } = useMercari();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const imagePreview = imagePreviews[0] ?? null;
  const [isAutoInputOn, setIsAutoInputOn] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'details'>('basic');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<{ title: string; price: string; description: string } | null>(null);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);

  const reset = () => {
    setTitle(''); setPrice(''); setDescription(''); setCategory(''); setCondition(''); setImagePreviews((previous) => { previous.forEach((preview) => URL.revokeObjectURL(preview)); return []; }); setIsAnalyzing(false); setError(null); setNotice(null); setActiveTab('basic'); setIsAutoInputOn(true);
  };

  useEffect(() => {
    if (!isListingModalOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsListingModalOpen(false);
        reset();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isListingModalOpen, setIsListingModalOpen]);

  useEffect(() => {
    if (!isListingModalOpen) return;
    document.getElementById('listing-images')?.setAttribute('multiple', '');
  }, [isListingModalOpen]);

  const chooseImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 20);
    if (!files.length) return;
    setImagePreviews((previous) => { previous.forEach((preview) => URL.revokeObjectURL(preview)); return files.map((file) => URL.createObjectURL(file)); });
    if (isAutoInputOn) {
      setIsAnalyzing(true);
      window.setTimeout(() => {
        setTitle((value) => value || 'ミントグリーン ウール混ニットセーター');
        setDescription((value) => value || '写真からAIが候補を作成しました。カラーやサイズなどを確認してから出品できます。\n\n・カラー：ミントグリーン\n・素材：ウール混\n・サイズ：フリーサイズ');
        setCategory((value) => value || 'レディース');
        setCondition((value) => value || '目立った傷や汚れなし');
        setIsAnalyzing(false);
      }, 500);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = addNewItem({ title, price: Number(price), description, category: category ? [category] : undefined, condition: condition || undefined, images: imagePreviews.length ? imagePreviews : undefined });
    if (!result.ok) { setError(result.message || '商品名と価格を確認してください。'); return; }
    reset();
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  };
  const saveDraft = () => {
    if (!title.trim() && !price) { showNotice('商品名か価格を入力してから保存してください'); return; }
    setSavedDraft({ title, price, description });
    showNotice('下書きを保存しました');
  };
  const applyTemplate = (template: 'book' | 'fashion' | 'device') => {
    const templates = {
      book: { title: 'やさしく学べる 入門書', description: '書き込みのないきれいな状態です。匿名配送で発送します。', category: '本・マンガ', condition: '目立った傷や汚れなし' },
      fashion: { title: 'ミントグリーン ウール混ニットセーター', description: '写真からAIが候補を作成しました。カラーやサイズをご確認ください。', category: 'レディース', condition: '目立った傷や汚れなし' },
      device: { title: 'スマートフォン 本体 128GB', description: '動作確認済みです。初期化して発送します。', category: '家電・スマホ', condition: 'やや傷や汚れあり' },
    }[template];
    setTitle(templates.title); setDescription(templates.description); setCategory(templates.category); setCondition(templates.condition); setIsTemplateOpen(false); showNotice('テンプレートを反映しました');
  };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="listing-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-12 md:px-7"><div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">出品</h1></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[1fr_310px]'}`}><section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 md:p-7"><ListingGuide /><div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold text-[var(--shop-accent)]">かんたん出品</p><h2 className="mt-1 text-xl font-black text-white">写真からAIで入力</h2><p className="mt-2 text-sm text-[var(--shop-muted)]">商品画像を追加すると、商品名や説明の候補を自動で作成します。</p></div><Sparkles className="h-8 w-8 text-[var(--shop-warning)]" /></div><button type="button" onClick={() => setIsListingModalOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)]" data-testid="start-listing-btn"><Camera className="h-5 w-5" />出品をはじめる</button><button type="button" onClick={() => setIsDraftsOpen(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--shop-accent)] py-3.5 text-sm font-bold text-[var(--shop-accent)]"><FileText className="h-5 w-5" />下書き一覧{savedDraft && <span className="rounded-full bg-[var(--shop-accent)] px-1.5 py-0.5 text-[10px] text-white">1</span>}</button></section><aside className="space-y-3"><h2 className="text-sm font-bold text-white">出品のヒント</h2>{[['明るい場所で撮影', '商品の全体がわかる写真を追加', Camera], ['状態を正しく選択', '傷や汚れは説明に書くと安心', Lightbulb], ['発送方法を確認', '購入者にわかりやすく表示', Truck]].map(([tip, body, Icon]) => <button type="button" key={tip as string} onClick={() => showNotice(`${tip as string}：${body as string}`)} className="flex w-full items-center gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-left hover:border-[var(--shop-blue)]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--shop-surface-raised)] text-[var(--shop-blue)]">{React.createElement(Icon as React.ElementType, { className: 'h-4 w-4' })}</span><span className="min-w-0"><span className="block text-sm font-bold text-white">{tip as string}</span><span className="mt-1 block text-xs leading-5 text-[var(--shop-muted)]">{body as string}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--shop-subtle)]" /></button>)}</aside></div>
      </div><Footer />
      {notice && <div className="pointer-events-none absolute bottom-16 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[#111113]/95 px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{notice}</div>}
      {isDraftsOpen && <DraftSheet draft={savedDraft} onClose={() => setIsDraftsOpen(false)} onResume={() => { setIsDraftsOpen(false); setIsListingModalOpen(true); if (savedDraft) { setTitle(savedDraft.title); setPrice(savedDraft.price); setDescription(savedDraft.description); } }} />}
      {isTemplateOpen && <TemplateSheet onSelect={applyTemplate} onClose={() => setIsTemplateOpen(false)} />}

      {isListingModalOpen && <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[var(--shop-bg)] animate-slide-up" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title"><div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.96)] px-4 py-3 backdrop-blur-xl"><button type="button" onClick={() => { setIsListingModalOpen(false); reset(); }} aria-label="出品画面を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface)] hover:text-white" data-testid="close-listing-modal-btn"><X className="h-6 w-6" /></button><h2 id="listing-modal-title" className="font-black text-white">商品の出品</h2><button type="button" onClick={reset} className="text-xs font-bold text-[var(--shop-blue)]">リセット</button></div><div className="flex border-b border-[var(--shop-border)] bg-[var(--shop-surface)]"><button type="button" onClick={() => setActiveTab('basic')} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'basic' ? 'border-b-2 border-[var(--shop-accent)] text-[var(--shop-accent)]' : 'text-[var(--shop-muted)]'}`}>基本</button><button type="button" onClick={() => setActiveTab('details')} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'details' ? 'border-b-2 border-[var(--shop-accent)] text-[var(--shop-accent)]' : 'text-[var(--shop-muted)]'}`}>こだわり条件</button></div><form onSubmit={submit} className="shop-scrollbar flex-1 overflow-y-auto px-4 py-5 md:mx-auto md:w-full md:max-w-[800px] md:px-7">
        {activeTab === 'basic' ? <><section><label htmlFor="listing-images" className="mb-2 block text-sm font-bold text-white">商品画像 <span className="font-normal text-[var(--shop-muted)]">・最大20枚</span></label><input id="listing-images" type="file" accept="image/*" className="sr-only" onChange={chooseImage} /><div className="flex gap-2 overflow-x-auto pb-1">{[0, 1, 2, 3].map((index) => <label key={index} htmlFor="listing-images" className="relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--shop-border)] bg-[var(--shop-surface)] hover:border-[var(--shop-accent)]">{index === 0 && imagePreview ? <img src={imagePreview} alt="選択した商品" className="h-full w-full object-cover" /> : index === 0 ? <><Plus className="h-6 w-6 text-[var(--shop-muted)]" /><span className="absolute bottom-2 text-[10px] text-[var(--shop-muted)]">追加</span></> : <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-xs font-bold text-white">{index + 1}</span>}</label>)}</div>{isAnalyzing && <p className="mt-2 flex items-center gap-2 text-xs text-[var(--shop-blue)]" role="status"><Sparkles className="h-4 w-4 animate-pulse" />AIが画像を解析しています…</p>}</section><div className="my-6 flex items-center justify-between rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div><p className="text-sm font-bold text-white">商品名と説明を自動入力</p><p className="mt-1 text-xs text-[var(--shop-muted)]">写真から候補を作り、あとから編集できます。</p></div><button type="button" aria-pressed={isAutoInputOn} onClick={() => setIsAutoInputOn((value) => !value)} className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${isAutoInputOn ? 'justify-end bg-[var(--shop-blue)]' : 'justify-start bg-[var(--shop-border)]'}`}><span className="h-5 w-5 rounded-full bg-white shadow" /></button></div><button type="button" onClick={() => setIsTemplateOpen(true)} className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]"><Barcode className="h-5 w-5 text-[var(--shop-blue)]" />バーコード・テンプレートから入力</button><FormField id="listing-title" label="商品名" hint={`${title.length} / 40`}><input id="listing-title" required maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="商品名を入力してください" data-testid="listing-title-input" /></FormField><FormField id="listing-description" label="商品の説明" hint="任意"><textarea id="listing-description" rows={6} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="商品の状態や特徴を入力してください" data-testid="listing-description-input" /></FormField></> : <><FormField id="listing-category" label="カテゴリー"><select id="listing-category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">カテゴリーを選択</option><option>レディース</option><option>メンズ</option><option>家電・スマホ</option><option>本・マンガ</option><option>ゲーム・おもちゃ</option></select></FormField><FormField id="listing-condition" label="商品の状態"><select id="listing-condition" value={condition} onChange={(event) => setCondition(event.target.value)}><option value="">商品の状態を選択</option><option>新品・未使用</option><option>未使用に近い</option><option>目立った傷や汚れなし</option><option>やや傷や汚れあり</option><option>傷や汚れあり</option></select></FormField><div className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-sm text-[var(--shop-muted)]"><p className="font-bold text-white">配送について</p><p className="mt-2">送料込み（出品者負担） ・ ゆうゆう配送</p><p className="mt-1 text-xs">購入後、1〜2日で発送する想定です。</p></div></>}
        <div className="mt-6 space-y-1"><label htmlFor="listing-price" className="block text-sm font-bold text-white">販売価格 <span className="font-normal text-[var(--shop-muted)]">（300円以上）</span></label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--shop-muted)]">¥</span><input id="listing-price" required min={300} type="number" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="300" className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3.5 pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-[var(--shop-blue)]" data-testid="listing-price-input" /></div></div>{error && <p className="mt-3 text-sm text-[var(--shop-accent)]" role="alert">{error}</p>}<div className="my-7 grid grid-cols-2 gap-2"><button type="button" onClick={saveDraft} className="rounded-lg border border-[var(--shop-border)] py-3.5 text-sm font-bold text-white hover:border-[var(--shop-blue)]">下書きに保存</button><button type="submit" className="rounded-lg bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)]" data-testid="submit-listing-btn">出品する（モック）</button></div>
      </form><Footer /></div>}
    </div>
  );
};

const FormField: React.FC<{ id: string; label: string; hint?: string; children: React.ReactNode }> = ({ id, label, hint, children }) => <div className="mb-5 space-y-1.5"><div className="flex items-center justify-between"><label htmlFor={id} className="text-sm font-bold text-white">{label}</label>{hint && <span className="text-xs text-[var(--shop-muted)]">{hint}</span>}</div>{React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ className?: string }>, { className: 'w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3.5 py-3.5 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]' }) : children}</div>;

const ListingGuide: React.FC = () => <div className="mb-6 overflow-hidden rounded-xl shadow-[0_10px_24px_rgba(255,205,40,.12)]"><img src="/images/marketing/shop-listing-guide.png" alt="出品はじめかたガイド" className="block h-auto w-full" /></div>;

const DraftSheet: React.FC<{ draft: { title: string; price: string; description: string } | null; onClose: () => void; onResume: () => void }> = ({ draft, onClose, onResume }) => (
  <div className="absolute inset-0 z-[70] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="下書き一覧">
    <div className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up">
      <div className="flex items-center justify-between"><h2 className="text-base font-black text-white">下書き一覧</h2><button type="button" onClick={onClose} aria-label="下書き一覧を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div>
      {draft ? <><button type="button" onClick={onResume} className="mt-5 flex w-full items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left hover:border-[var(--shop-blue)]"><span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--shop-bg)] text-[var(--shop-blue)]"><FileText className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-white">{draft.title || 'タイトル未入力'}</span><span className="mt-1 block text-xs text-[var(--shop-muted)]">{draft.price ? `¥${Number(draft.price).toLocaleString()}` : '価格未入力'} ・ 編集を再開</span></span><ChevronRight className="h-4 w-4 text-[var(--shop-subtle)]" /></button></> : <p className="mt-5 rounded-xl border border-dashed border-[var(--shop-border)] p-8 text-center text-sm text-[var(--shop-muted)]">保存された下書きはありません</p>}
      <button type="button" onClick={onClose} className="mt-5 w-full rounded-lg border border-[var(--shop-border)] py-3 text-sm font-bold text-white">閉じる</button>
    </div>
  </div>
);

const TemplateSheet: React.FC<{ onSelect: (template: 'book' | 'fashion' | 'device') => void; onClose: () => void }> = ({ onSelect, onClose }) => {
  const templates = [
    ['fashion', 'ファッション', '衣類・バッグ・靴の基本項目を入力'],
    ['book', '本・マンガ', '本の状態と発送説明を入力'],
    ['device', '家電・スマホ', '動作確認・付属品の説明を入力'],
  ] as const;
  return <div className="absolute inset-0 z-[75] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="テンプレートを選ぶ">
    <div className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up">
      <div className="flex items-center justify-between"><h2 className="text-base font-black text-white">テンプレートから入力</h2><button type="button" onClick={onClose} aria-label="テンプレートを閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div>
      <div className="mt-5 space-y-2">{templates.map(([value, title, body]) => <button type="button" key={value} onClick={() => onSelect(value)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left hover:border-[var(--shop-blue)]"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--shop-bg)] text-[var(--shop-blue)]"><FileText className="h-5 w-5" /></span><span><span className="block text-sm font-bold text-white">{title}</span><span className="mt-1 block text-xs text-[var(--shop-muted)]">{body}</span></span><ChevronRight className="ml-auto h-4 w-4 text-[var(--shop-subtle)]" /></button>)}</div>
    </div>
  </div>;
};
