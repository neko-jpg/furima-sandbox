'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Barcode, Camera, CheckCircle2, ChevronRight, FileText, ImagePlus, Lightbulb, ShieldCheck, Sparkles, Truck, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { CATALOG_FAMILIES, CATALOG_VARIANTS } from '../../data/catalogData';
import { Footer } from '../Footer';

type ListingTab = 'basic' | 'details' | 'review';
type TemplateName = 'book' | 'fashion' | 'device';

interface ListingDraft {
  title: string;
  price: string;
  description: string;
  category: string;
  condition: string;
  brand: string;
  color: string;
  size: string;
  familyId: string;
  variantId: string;
  inventoryPolicy: 'SINGLE' | 'MULTI';
  inventoryQuantity: string;
  shippingFee: string;
  shippingMethod: string;
  origin: string;
  shippingDays: string;
  shippingSize: string;
  isAnonymousShipping: boolean;
  imagePreviews: string[];
}

const DEFAULT_SHIPPING = {
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'ゆうゆう配送',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
  shippingSize: '60サイズ',
  isAnonymousShipping: true,
};

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

export const ListingView: React.FC = () => {
  const { isListingModalOpen, setIsListingModalOpen, addNewItem, isDeviceFrame } = useMercari();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [familyId, setFamilyId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [inventoryPolicy, setInventoryPolicy] = useState<'SINGLE' | 'MULTI'>('SINGLE');
  const [inventoryQuantity, setInventoryQuantity] = useState('1');
  const [shippingFee, setShippingFee] = useState(DEFAULT_SHIPPING.shippingFee);
  const [shippingMethod, setShippingMethod] = useState(DEFAULT_SHIPPING.shippingMethod);
  const [origin, setOrigin] = useState(DEFAULT_SHIPPING.origin);
  const [shippingDays, setShippingDays] = useState(DEFAULT_SHIPPING.shippingDays);
  const [shippingSize, setShippingSize] = useState(DEFAULT_SHIPPING.shippingSize);
  const [isAnonymousShipping, setIsAnonymousShipping] = useState(DEFAULT_SHIPPING.isAnonymousShipping);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isAutoInputOn, setIsAutoInputOn] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<ListingTab>('basic');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedDraft, setSavedDraft] = useState<ListingDraft | null>(null);
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [hasPolicyAccepted, setHasPolicyAccepted] = useState(false);

  const imagePreview = imagePreviews[0] ?? null;
  const numericPrice = Number(price);
  const numericInventoryQuantity = Number(inventoryQuantity);
  const normalizedInventoryQuantity = inventoryPolicy === 'MULTI' && Number.isInteger(numericInventoryQuantity) && numericInventoryQuantity > 0
    ? numericInventoryQuantity
    : 1;
  const selectedFamily = useMemo(() => CATALOG_FAMILIES.find((family) => family.id === familyId), [familyId]);
  const availableVariants = useMemo(() => CATALOG_VARIANTS.filter((variant) => variant.familyId === familyId), [familyId]);
  const selectedVariant = useMemo(() => availableVariants.find((variant) => variant.id === variantId), [availableVariants, variantId]);
  const selectedSearchTags = useMemo(() => [category, selectedFamily?.name, selectedVariant?.name, selectedFamily?.productType]
    .filter((value): value is string => Boolean(value)), [category, selectedFamily?.name, selectedFamily?.productType, selectedVariant?.name]);
  const sellerFee = Number.isInteger(numericPrice) && numericPrice >= 300 ? Math.floor(numericPrice * 0.1) : 0;
  const expectedProceeds = Math.max(0, numericPrice - sellerFee);

  const policySignals = useMemo(() => {
    const text = `${title} ${description}`.toLowerCase();
    const prohibited = ['拳銃', '麻薬', '偽ブランド', '爆薬', '違法'].find((keyword) => text.includes(keyword));
    const containsPersonalData = /(?:https?:\/\/|www\.|@|\d{2,4}-\d{2,4}-\d{3,4})/u.test(`${title} ${description}`);
    return [
      { label: '価格は300円以上', status: numericPrice >= 300 ? 'pass' : 'blocked', detail: numericPrice >= 300 ? '販売価格の下限を満たしています' : '300円以上で入力してください' },
      { label: '画像品質', status: imagePreviews.length > 0 ? 'pass' : 'warning', detail: imagePreviews.length > 0 ? `${imagePreviews.length}枚を確認できます` : '画像なしでもデモできますが、1枚以上がおすすめです' },
      { label: '禁止出品物チェック', status: prohibited ? 'blocked' : 'pass', detail: prohibited ? `禁止ワード「${prohibited}」を検出しました` : 'タイトル・説明に危険なワードはありません' },
      { label: '個人情報チェック', status: containsPersonalData ? 'warning' : 'pass', detail: containsPersonalData ? 'URL・連絡先らしき文字列があります。公開前に確認してください' : '連絡先・外部誘導は見つかりませんでした' },
      { label: '説明と状態の確認', status: category && condition ? 'pass' : 'warning', detail: category && condition ? 'カテゴリーと商品の状態が入力されています' : 'カテゴリーと状態を入力すると購入者が判断しやすくなります' },
    ] as const;
  }, [category, condition, description, imagePreviews.length, numericPrice, title]);

  const hasBlockingIssue = policySignals.some((signal) => signal.status === 'blocked');

  const reset = () => {
    setTitle(''); setPrice(''); setDescription(''); setCategory(''); setCondition(''); setBrand(''); setColor(''); setSize(''); setFamilyId(''); setVariantId(''); setInventoryPolicy('SINGLE'); setInventoryQuantity('1');
    setShippingFee(DEFAULT_SHIPPING.shippingFee); setShippingMethod(DEFAULT_SHIPPING.shippingMethod); setOrigin(DEFAULT_SHIPPING.origin); setShippingDays(DEFAULT_SHIPPING.shippingDays); setShippingSize(DEFAULT_SHIPPING.shippingSize); setIsAnonymousShipping(DEFAULT_SHIPPING.isAnonymousShipping);
    setImagePreviews([]); setIsAnalyzing(false); setAiConfidence(null); setError(null); setNotice(null); setActiveTab('basic'); setIsAutoInputOn(true); setHasPolicyAccepted(false);
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

  const chooseImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 20);
    if (!files.length) return;
    const oversized = files.find((file) => file.size > 10 * 1024 * 1024);
    if (oversized) {
      setError('1枚10MB以下の画像を選択してください。');
      return;
    }
    try {
      const previews = await Promise.all(files.map(fileToDataUrl));
      setImagePreviews(previews);
      setError(null);
      if (isAutoInputOn) {
        setIsAnalyzing(true);
        window.setTimeout(() => {
          setTitle((value) => value || 'ミントグリーン ウール混ニットセーター');
          setDescription((value) => value || '写真からAIが候補を作成しました。カラーやサイズなどを確認してから出品できます。\n\n・カラー：ミントグリーン\n・素材：ウール混\n・サイズ：フリーサイズ');
          setCategory((value) => value || 'レディース');
          setCondition((value) => value || '目立った傷や汚れなし');
          setColor((value) => value || 'グリーン');
          setAiConfidence(87);
          setIsAnalyzing(false);
        }, 500);
      }
    } catch {
      setError('画像の読み込みに失敗しました。別の画像をお試しください。');
    }
  };

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const currentDraft = (): ListingDraft => ({ title, price, description, category, condition, brand, color, size, familyId, variantId, inventoryPolicy, inventoryQuantity, shippingFee, shippingMethod, origin, shippingDays, shippingSize, isAnonymousShipping, imagePreviews });

  const saveDraft = () => {
    if (!title.trim() && !price && imagePreviews.length === 0) { showNotice('商品名・価格・画像のいずれかを入力してから保存してください'); return; }
    setSavedDraft(currentDraft());
    showNotice('下書きを保存しました。あとで同じ状態から再開できます。');
  };

  const resumeDraft = () => {
    if (!savedDraft) return;
    setTitle(savedDraft.title); setPrice(savedDraft.price); setDescription(savedDraft.description); setCategory(savedDraft.category); setCondition(savedDraft.condition); setBrand(savedDraft.brand); setColor(savedDraft.color); setSize(savedDraft.size); setFamilyId(savedDraft.familyId); setVariantId(savedDraft.variantId); setInventoryPolicy(savedDraft.inventoryPolicy); setInventoryQuantity(savedDraft.inventoryQuantity); setShippingFee(savedDraft.shippingFee); setShippingMethod(savedDraft.shippingMethod); setOrigin(savedDraft.origin); setShippingDays(savedDraft.shippingDays); setShippingSize(savedDraft.shippingSize); setIsAnonymousShipping(savedDraft.isAnonymousShipping); setImagePreviews(savedDraft.imagePreviews); setIsDraftsOpen(false); setIsListingModalOpen(true); showNotice('下書きを復元しました');
  };

  const applyTemplate = (template: TemplateName) => {
    const templates: Record<TemplateName, { title: string; description: string; category: string; condition: string; brand: string; color: string }> = {
      book: { title: 'やさしく学べる 入門書', description: '書き込みのないきれいな状態です。匿名配送で発送します。', category: '本・マンガ', condition: '目立った傷や汚れなし', brand: '', color: '' },
      fashion: { title: 'ミントグリーン ウール混ニットセーター', description: '写真からAIが候補を作成しました。カラーやサイズをご確認ください。', category: 'レディース', condition: '目立った傷や汚れなし', brand: '', color: 'グリーン' },
      device: { title: 'スマートフォン 本体 128GB', description: '動作確認済みです。初期化して発送します。付属品は写真に写っているものがすべてです。', category: '家電・スマホ', condition: 'やや傷や汚れあり', brand: 'Apple', color: '', },
    };
    const selected = templates[template];
    setTitle(selected.title); setDescription(selected.description); setCategory(selected.category); setCondition(selected.condition); setBrand(selected.brand); setColor(selected.color); setIsTemplateOpen(false); showNotice('テンプレートを反映しました。候補は自由に修正できます。');
  };

  const validateAndReview = () => {
    if (!title.trim() || !price || !Number.isInteger(numericPrice) || numericPrice < 300) { setError('商品名と、300円以上の販売価格を入力してください。'); setActiveTab('basic'); return false; }
    if (!category || !condition) { setError('カテゴリーと商品の状態を入力してください。'); setActiveTab('details'); return false; }
    if (inventoryPolicy === 'MULTI' && (!Number.isInteger(numericInventoryQuantity) || numericInventoryQuantity < 1)) { setError('複数在庫では1以上の整数を入力してください。'); setActiveTab('details'); return false; }
    setError(null);
    setActiveTab('review');
    return true;
  };

  const confirmListing = () => {
    if (hasBlockingIssue) { setError('チェックでブロックされた項目を修正してから出品してください。'); return; }
    if (!hasPolicyAccepted) { setError('出品ポリシーを確認してチェックを入れてください。'); return; }
    const result = addNewItem({ title, price: numericPrice, description, category: category ? [category] : undefined, condition: condition || undefined, brand: brand || undefined, color: color || undefined, size: size || undefined, images: imagePreviews.length ? imagePreviews : undefined, shippingFee, shippingMethod, origin, shippingDays, shippingSize, isAnonymousShipping, productFamilyId: selectedFamily?.id, productFamilyName: selectedFamily?.name, variantId: selectedVariant?.id, variantName: selectedVariant?.name, productType: selectedFamily?.productType, searchTags: selectedSearchTags, attributes: selectedVariant?.attributes, inventoryPolicy, inventoryQuantity: normalizedInventoryQuantity });
    if (!result.ok) { setError(result.message || '入力内容を確認してください。'); return; }
    setSavedDraft(null);
    reset();
    showNotice('商品をモック出品しました。ホームの新着商品に追加されています。');
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (activeTab !== 'review') validateAndReview();
    else confirmListing();
  };

  const tabs: { id: ListingTab; label: string; note: string }[] = [
    { id: 'basic', label: '1 基本情報', note: '画像・商品名・説明' },
    { id: 'details', label: '2 条件・配送', note: '状態・発送・価格' },
    { id: 'review', label: '3 提出前チェック', note: '内訳・ポリシー' },
  ];

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="listing-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-12 md:px-7">
        <div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">出品シミュレーター</h1><p className="mt-1 text-xs text-[var(--shop-muted)]">AI候補を編集し、審査・送料・売上見込みまで確認できます。</p></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[1fr_310px]'}`}>
          <section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 md:p-7">
            <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs font-bold text-[var(--shop-accent)]">出品者を支援するサンドボックス</p><h2 className="mt-1 text-xl font-black text-white">写真からAIで入力 → 自分で確認</h2><p className="mt-2 text-sm text-[var(--shop-muted)]">生成候補の根拠・信頼度・安全チェックを見ながら、提出前に修正できます。</p></div><Sparkles className="h-8 w-8 shrink-0 text-[var(--shop-warning)]" /></div>
            <div className="mb-5 grid gap-2 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3 text-xs sm:grid-cols-3"><StepPill step="01" label="写真を追加" /><StepPill step="02" label="候補を編集" /><StepPill step="03" label="確認して公開" /></div>
            <button type="button" onClick={() => setIsListingModalOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)]" data-testid="start-listing-btn"><Camera className="h-5 w-5" />出品をはじめる</button>
            <button type="button" onClick={() => setIsDraftsOpen(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--shop-accent)] py-3.5 text-sm font-bold text-[var(--shop-accent)]"><FileText className="h-5 w-5" />下書き一覧{savedDraft && <span className="rounded-full bg-[var(--shop-accent)] px-1.5 py-0.5 text-[10px] text-white">1</span>}</button>
          </section>
          <aside className="space-y-3"><h2 className="text-sm font-bold text-white">提出前に見られる項目</h2>{[['明るい場所で撮影', '画像品質のチェックと最大20枚の登録', Camera], ['状態を正しく選択', '購入者が判断しやすい属性を入力', Lightbulb], ['発送方法を確認', '送料負担・サイズ・発送目安を明示', Truck], ['禁止出品物を検知', '危険ワードと個人情報を公開前に確認', ShieldCheck]].map(([tip, body, Icon]) => <button type="button" key={tip as string} onClick={() => showNotice(`${tip as string}：${body as string}`)} className="flex w-full items-center gap-3 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 text-left hover:border-[var(--shop-blue)]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--shop-surface-raised)] text-[var(--shop-blue)]">{React.createElement(Icon as React.ElementType, { className: 'h-4 w-4' })}</span><span className="min-w-0"><span className="block text-sm font-bold text-white">{tip as string}</span><span className="mt-1 block text-xs leading-5 text-[var(--shop-muted)]">{body as string}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--shop-subtle)]" /></button>)}</aside>
        </div>
      </div>
      <Footer />

      {notice && <div className="pointer-events-none absolute bottom-16 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[#111113]/95 px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{notice}</div>}
      {isDraftsOpen && <DraftSheet draft={savedDraft} onClose={() => setIsDraftsOpen(false)} onResume={resumeDraft} />}
      {isTemplateOpen && <TemplateSheet onSelect={applyTemplate} onClose={() => setIsTemplateOpen(false)} />}

      {isListingModalOpen && <div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[var(--shop-bg)] animate-slide-up" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title"><div className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.96)] px-4 py-3 backdrop-blur-xl"><button type="button" onClick={() => { setIsListingModalOpen(false); reset(); }} aria-label="出品画面を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface)] hover:text-white" data-testid="close-listing-modal-btn"><X className="h-6 w-6" /></button><div className="text-center"><h2 id="listing-modal-title" className="font-black text-white">商品の出品</h2><p className="text-[10px] text-[var(--shop-muted)]">入力内容はすべてデモ状態です</p></div><button type="button" onClick={reset} className="text-xs font-bold text-[var(--shop-blue)]">リセット</button></div>
        <div className="border-b border-[var(--shop-border)] bg-[var(--shop-surface)] px-4 py-2"><div className="mx-auto grid max-w-[800px] grid-cols-3 gap-1">{tabs.map((tab) => <button type="button" key={tab.id} onClick={() => setActiveTab(tab.id)} className={`rounded-lg px-2 py-2 text-left ${activeTab === tab.id ? 'bg-[#16394d] text-[var(--shop-blue)]' : 'text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]'}`}><span className="block text-[11px] font-black">{tab.label}</span><span className="mt-0.5 block truncate text-[9px]">{tab.note}</span></button>)}</div></div>
        <form onSubmit={submit} className="shop-scrollbar flex-1 overflow-y-auto px-4 py-5 md:mx-auto md:w-full md:max-w-[800px] md:px-7">
          {activeTab === 'basic' && <>
            <section><div className="mb-2 flex items-center justify-between"><label htmlFor="listing-images" className="block text-sm font-bold text-white">商品画像 <span className="font-normal text-[var(--shop-muted)]">・最大20枚</span></label><span className="text-xs text-[var(--shop-muted)]">{imagePreviews.length} / 20</span></div><input id="listing-images" type="file" accept="image/*" multiple className="sr-only" onChange={chooseImage} /><div className="flex gap-2 overflow-x-auto pb-1">{[0, 1, 2, 3].map((index) => <label key={index} htmlFor="listing-images" className="relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--shop-border)] bg-[var(--shop-surface)] hover:border-[var(--shop-accent)]">{imagePreviews[index] ? <img src={imagePreviews[index]} alt={`選択した商品画像${index + 1}`} className="h-full w-full object-cover" /> : index === 0 ? <><ImagePlus className="h-6 w-6 text-[var(--shop-muted)]" /><span className="absolute bottom-2 text-[10px] text-[var(--shop-muted)]">追加</span></> : <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-xs font-bold text-white">{index + 1}</span>}</label>)}</div>{isAnalyzing && <p className="mt-2 flex items-center gap-2 text-xs text-[var(--shop-blue)]" role="status"><Sparkles className="h-4 w-4 animate-pulse" />AIが画像を解析しています…</p>}{aiConfidence !== null && !isAnalyzing && <div className="mt-3 rounded-lg border border-[#2b5367] bg-[#153247] p-3 text-xs text-[#c5eaff]"><div className="flex items-center justify-between"><span className="flex items-center gap-2 font-bold"><Sparkles className="h-4 w-4" />AI候補を生成しました</span><span className="font-black">信頼度 {aiConfidence}%</span></div><p className="mt-1.5 leading-5">写真の色・形・カテゴリ候補をもとに作成。候補は必ず編集・確認してから提出してください。</p></div>}</section>
            <div className="my-6 flex items-center justify-between rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div><p className="text-sm font-bold text-white">商品名と説明を自動入力</p><p className="mt-1 text-xs text-[var(--shop-muted)]">写真から候補を作り、あとから編集できます。</p></div><button type="button" aria-pressed={isAutoInputOn} onClick={() => setIsAutoInputOn((value) => !value)} className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${isAutoInputOn ? 'justify-end bg-[var(--shop-blue)]' : 'justify-start bg-[var(--shop-border)]'}`}><span className="h-5 w-5 rounded-full bg-white shadow" /></button></div>
            <button type="button" onClick={() => setIsTemplateOpen(true)} className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3 text-sm font-bold text-white hover:border-[var(--shop-blue)]"><Barcode className="h-5 w-5 text-[var(--shop-blue)]" />バーコード・テンプレートから入力</button>
            <FormField id="listing-title" label="商品名" hint={`${title.length} / 40`}><input id="listing-title" required maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="商品名を入力してください" data-testid="listing-title-input" /></FormField>
            <FormField id="listing-description" label="商品の説明" hint={`${description.length} / 1000`}><textarea id="listing-description" rows={7} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="商品の状態や特徴、付属品を入力してください" data-testid="listing-description-input" /></FormField>
          </>}

          {activeTab === 'details' && <>
            <div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-category" label="カテゴリー"><select id="listing-category" required value={category} onChange={(event) => setCategory(event.target.value)}><option value="">カテゴリーを選択</option><option>レディース</option><option>メンズ</option><option>家電・スマホ</option><option>本・マンガ</option><option>ゲーム・おもちゃ</option><option>ホビー</option></select></FormField><FormField id="listing-condition" label="商品の状態"><select id="listing-condition" required value={condition} onChange={(event) => setCondition(event.target.value)}><option value="">商品の状態を選択</option><option>新品・未使用</option><option>未使用に近い</option><option>目立った傷や汚れなし</option><option>やや傷や汚れあり</option><option>傷や汚れあり</option></select></FormField></div>
            <div className="grid gap-4 sm:grid-cols-3"><FormField id="listing-brand" label="ブランド" hint="任意"><input id="listing-brand" value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="例：Apple" /></FormField><FormField id="listing-color" label="色" hint="任意"><input id="listing-color" value={color} onChange={(event) => setColor(event.target.value)} placeholder="例：ブラック" /></FormField><FormField id="listing-size" label="サイズ" hint="任意"><input id="listing-size" value={size} onChange={(event) => setSize(event.target.value)} placeholder="例：M" /></FormField></div>
            <section className="space-y-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4">
              <div><h3 className="text-sm font-black text-white">商品ファミリー・バリエーション・在庫</h3><p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">検索で見つけやすく、購入時に在庫を正しく減らすための登録項目です。画像から自動判定された候補もここで修正できます。</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="listing-family" label="商品ファミリー" hint="任意"><select id="listing-family" value={familyId} onChange={(event) => { setFamilyId(event.target.value); setVariantId(''); }}><option value="">未設定（自由入力）</option>{CATALOG_FAMILIES.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></FormField>
                <FormField id="listing-variant" label="バリエーション" hint="任意"><select id="listing-variant" value={variantId} disabled={!familyId} onChange={(event) => setVariantId(event.target.value)}><option value="">未設定</option>{availableVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select></FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="listing-inventory-policy" label="在庫ポリシー"><select id="listing-inventory-policy" value={inventoryPolicy} onChange={(event) => setInventoryPolicy(event.target.value as 'SINGLE' | 'MULTI')}><option value="SINGLE">一点在庫（購入でSOLD）</option><option value="MULTI">複数在庫（数量を減算）</option></select></FormField>
                {inventoryPolicy === 'MULTI' ? <FormField id="listing-inventory-quantity" label="初期在庫数" hint="1以上"><input id="listing-inventory-quantity" type="number" min={1} step={1} value={inventoryQuantity} onChange={(event) => setInventoryQuantity(event.target.value)} /></FormField> : <div className="flex items-end rounded-lg border border-dashed border-[var(--shop-border)] px-3.5 py-3.5 text-xs text-[var(--shop-muted)]">購入できる在庫は1点です。購入完了後にSOLDへ変わります。</div>}
              </div>
              {selectedVariant && <div className="flex flex-wrap gap-2 rounded-lg bg-[var(--shop-bg)] p-3 text-xs text-[var(--shop-muted)]">{Object.entries(selectedVariant.attributes).map(([key, value]) => <span key={key} className="rounded-full bg-[var(--shop-surface-raised)] px-2.5 py-1"><strong className="text-white">{key}:</strong> {value}</span>)}</div>}
            </section>
            <section className="space-y-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-center gap-2"><Truck className="h-4 w-4 text-[var(--shop-blue)]" /><h3 className="text-sm font-black text-white">配送設定</h3><span className="ml-auto text-[10px] text-[var(--shop-muted)]">購入者に公開されます</span></div><div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-shipping-fee" label="送料の負担"><select id="listing-shipping-fee" value={shippingFee} onChange={(event) => setShippingFee(event.target.value)}><option>送料込み（出品者負担）</option><option>着払い（購入者負担）</option></select></FormField><FormField id="listing-shipping-method" label="配送方法"><select id="listing-shipping-method" value={shippingMethod} onChange={(event) => setShippingMethod(event.target.value)}><option>ゆうゆう配送</option><option>らくらく配送</option><option>普通郵便</option></select></FormField><FormField id="listing-origin" label="発送元の地域"><select id="listing-origin" value={origin} onChange={(event) => setOrigin(event.target.value)}><option>東京都</option><option>大阪府</option><option>神奈川県</option><option>愛知県</option><option>福岡県</option></select></FormField><FormField id="listing-shipping-days" label="発送までの日数"><select id="listing-shipping-days" value={shippingDays} onChange={(event) => setShippingDays(event.target.value)}><option>1〜2日で発送</option><option>2〜3日で発送</option><option>4〜7日で発送</option></select></FormField><FormField id="listing-shipping-size" label="荷物サイズ"><select id="listing-shipping-size" value={shippingSize} onChange={(event) => setShippingSize(event.target.value)}><option>60サイズ</option><option>80サイズ</option><option>100サイズ</option><option>未定</option></select></FormField></div><label className="flex cursor-pointer items-center gap-2 text-xs text-white"><input type="checkbox" checked={isAnonymousShipping} onChange={(event) => setIsAnonymousShipping(event.target.checked)} className="h-4 w-4 accent-[var(--shop-blue)]" />匿名配送として表示する<span className="text-[var(--shop-muted)]">（デモ）</span></label></section>
          </>}

          {activeTab === 'review' && <ListingReview title={title} price={numericPrice} description={description} category={category} condition={condition} imagePreview={imagePreview} imageCount={imagePreviews.length} shippingFee={shippingFee} shippingMethod={shippingMethod} shippingDays={shippingDays} sellerFee={sellerFee} expectedProceeds={expectedProceeds} policySignals={policySignals} hasPolicyAccepted={hasPolicyAccepted} onPolicyChange={setHasPolicyAccepted} />}

          <div className="mt-6 space-y-1"><label htmlFor="listing-price" className="block text-sm font-bold text-white">販売価格 <span className="font-normal text-[var(--shop-muted)]">（300円以上）</span></label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--shop-muted)]">¥</span><input id="listing-price" required min={300} type="number" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="300" className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3.5 pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-[var(--shop-blue)]" data-testid="listing-price-input" /></div>{price && <p className="mt-2 text-right text-xs text-[var(--shop-muted)]">販売手数料（デモ10%）：¥{sellerFee.toLocaleString()} ・ 売上見込み：<span className="font-bold text-white">¥{expectedProceeds.toLocaleString()}</span></p>}</div>
          {error && <p className="mt-3 flex items-start gap-2 text-sm text-[var(--shop-accent)]" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
          <div className="my-7 grid grid-cols-2 gap-2"><button type="button" onClick={saveDraft} className="rounded-lg border border-[var(--shop-border)] py-3.5 text-sm font-bold text-white hover:border-[var(--shop-blue)]">下書きに保存</button><button type="submit" disabled={activeTab === 'review' && (hasBlockingIssue || !hasPolicyAccepted)} className="rounded-lg bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)] disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="submit-listing-btn">{activeTab === 'review' ? '出品する（モック）' : '入力内容を確認する'}</button></div>
        </form><Footer /></div>}
    </div>
  );
};

const StepPill: React.FC<{ step: string; label: string }> = ({ step, label }) => <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#16394d] text-[10px] font-black text-[var(--shop-blue)]">{step}</span><span className="font-bold text-white">{label}</span></div>;

const FormField: React.FC<{ id: string; label: string; hint?: string; children: React.ReactNode }> = ({ id, label, hint, children }) => <div className="space-y-1.5"><div className="flex items-center justify-between"><label htmlFor={id} className="text-sm font-bold text-white">{label}</label>{hint && <span className="text-xs text-[var(--shop-muted)]">{hint}</span>}</div>{React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ className?: string }>, { className: 'w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3.5 py-3.5 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]' }) : children}</div>;

const ListingReview: React.FC<{ title: string; price: number; description: string; category: string; condition: string; imagePreview: string | null; imageCount: number; shippingFee: string; shippingMethod: string; shippingDays: string; sellerFee: number; expectedProceeds: number; policySignals: readonly { label: string; status: 'pass' | 'warning' | 'blocked'; detail: string }[]; hasPolicyAccepted: boolean; onPolicyChange: (value: boolean) => void }> = ({ title, price, description, category, condition, imagePreview, imageCount, shippingFee, shippingMethod, shippingDays, sellerFee, expectedProceeds, policySignals, hasPolicyAccepted, onPolicyChange }) => <section className="space-y-4"><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-start gap-3"><div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--shop-surface-raised)]">{imagePreview ? <img src={imagePreview} alt="出品プレビュー" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-[var(--shop-subtle)]" />}</div><div className="min-w-0"><p className="text-[10px] font-bold text-[var(--shop-muted)]">公開プレビュー ・ 画像{imageCount}枚</p><h3 className="mt-1 line-clamp-2 text-base font-black text-white">{title || '商品名未入力'}</h3><p className="mt-1 text-lg font-black text-[var(--shop-accent)]">¥{price > 0 ? price.toLocaleString() : '---'}</p><p className="mt-1 text-xs text-[var(--shop-muted)]">{category || 'カテゴリー未選択'} ・ {condition || '状態未選択'}</p></div></div><p className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--shop-bg)] p-3 text-xs leading-5 text-[var(--shop-muted)]">{description || '説明は未入力です'}</p><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white"><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingFee}</span><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingMethod}</span><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingDays}</span></div></div>
  <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><h3 className="text-sm font-black text-white">売上見込み</h3><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between text-[var(--shop-muted)]"><span>販売価格</span><span className="text-white">¥{price.toLocaleString()}</span></div><div className="flex justify-between text-[var(--shop-muted)]"><span>販売手数料（デモ10%）</span><span className="text-white">-¥{sellerFee.toLocaleString()}</span></div><div className="flex justify-between border-t border-[var(--shop-border)] pt-2 text-sm font-black text-white"><span>売上金の見込み</span><span className="text-[var(--shop-success)]">¥{expectedProceeds.toLocaleString()}</span></div></div><p className="mt-2 text-[10px] text-[var(--shop-subtle)]">実際の手数料・売上金は発生しません。購入者には送料条件を上のプレビューで表示します。</p></div>
  <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-white">公開前の安全チェック</h3><span className="text-[10px] text-[var(--shop-muted)]">自動チェック</span></div><div className="mt-3 space-y-2">{policySignals.map((signal) => <div key={signal.label} className="flex items-start gap-2 rounded-lg bg-[var(--shop-surface-raised)] p-2.5 text-xs"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${signal.status === 'pass' ? 'bg-emerald-400/20 text-emerald-300' : signal.status === 'blocked' ? 'bg-red-400/20 text-red-300' : 'bg-yellow-400/20 text-yellow-200'}`}>{signal.status === 'pass' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}</span><span><strong className="block text-white">{signal.label}</strong><span className="mt-0.5 block leading-4 text-[var(--shop-muted)]">{signal.detail}</span></span></div>)}</div><div className="mt-4 flex items-start gap-2.5 border-t border-[var(--shop-border)] pt-4 text-xs text-white"><input id="listing-policy" aria-label="出品ポリシーを確認しました" type="checkbox" checked={hasPolicyAccepted} onChange={(event) => onPolicyChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--shop-accent)]" /><span><strong>出品ポリシーを確認しました</strong><span className="mt-1 block leading-5 text-[var(--shop-muted)]">禁止出品物・著作権・個人情報・説明責任を確認し、デモ出品に同意します。</span></span></div></div></section>;

const DraftSheet: React.FC<{ draft: ListingDraft | null; onClose: () => void; onResume: () => void }> = ({ draft, onClose, onResume }) => <div className="absolute inset-0 z-[70] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="下書き一覧"><div className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">下書き一覧</h2><button type="button" onClick={onClose} aria-label="下書き一覧を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div>{draft ? <><button type="button" onClick={onResume} className="mt-5 flex w-full items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left hover:border-[var(--shop-blue)]"><span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--shop-bg)] text-[var(--shop-blue)]"><FileText className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-white">{draft.title || 'タイトル未入力'}</span><span className="mt-1 block text-xs text-[var(--shop-muted)]">{draft.price ? `¥${Number(draft.price).toLocaleString()}` : '価格未入力'} ・ 画像{draft.imagePreviews.length}枚 ・ 編集を再開</span></span><ChevronRight className="h-4 w-4 text-[var(--shop-subtle)]" /></button></> : <p className="mt-5 rounded-xl border border-dashed border-[var(--shop-border)] p-8 text-center text-sm text-[var(--shop-muted)]">保存された下書きはありません</p>}<button type="button" onClick={onClose} className="mt-5 w-full rounded-lg border border-[var(--shop-border)] py-3 text-sm font-bold text-white">閉じる</button></div></div>;

const TemplateSheet: React.FC<{ onSelect: (template: TemplateName) => void; onClose: () => void }> = ({ onSelect, onClose }) => {
  const templates: [TemplateName, string, string][] = [['fashion', 'ファッション', '衣類・バッグ・靴の基本項目を入力'], ['book', '本・マンガ', '本の状態と発送説明を入力'], ['device', '家電・スマホ', '動作確認・付属品の説明を入力']];
  return <div className="absolute inset-0 z-[75] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="テンプレートを選ぶ"><div className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl animate-slide-up"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">テンプレートから入力</h2><button type="button" onClick={onClose} aria-label="テンプレートを閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-[var(--shop-muted)]">候補を入れたあと、内容を自由に修正できます。</p><div className="mt-5 space-y-2">{templates.map(([value, title, body]) => <button type="button" key={value} onClick={() => onSelect(value)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left hover:border-[var(--shop-blue)]"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--shop-bg)] text-[var(--shop-blue)]"><FileText className="h-5 w-5" /></span><span><span className="block text-sm font-bold text-white">{title}</span><span className="mt-1 block text-xs text-[var(--shop-muted)]">{body}</span></span><ChevronRight className="ml-auto h-4 w-4 text-[var(--shop-subtle)]" /></button>)}</div></div></div>;
};
