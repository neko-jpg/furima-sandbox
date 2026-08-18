'use client';

/* eslint-disable @next/next/no-img-element */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Barcode,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  GripVertical,
  ImagePlus,
  Lightbulb,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { CATALOG_FAMILIES, CATALOG_VARIANTS } from '../../data/catalogMetadata';
import { deleteListingMediaMany, getListingMedia, prepareListingMedia, pruneListingMedia } from '../../media/listingMediaStore';
import { useDialogFocusTrap } from '../ui/useDialogFocusTrap';
import type { ListingImageOrder, ListingMediaRef, MercariItem } from '../../types/mercari';

type ListingStep = 'photos' | 'info' | 'details' | 'review';
type TemplateName = 'book' | 'fashion' | 'device';
type AiField = 'title' | 'description' | 'category' | 'condition' | 'color';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MAX_LISTING_IMAGES = 20;
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
const MIN_LISTING_PRICE = 300;
const MAX_LISTING_PRICE = 9_999_999;
const DRAFT_STORAGE_KEY = 'furima-listing-drafts-v3';
const OPEN_DRAFT_STORAGE_KEY = 'furima-listing-open-draft-id';
const scopedDraftKey = (base: string, actorId: string): string => `${base}:furima-demo:${actorId}`;
const DEFAULT_SHIPPING = {
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: 'ゆうゆう配送',
  origin: '東京都',
  shippingDays: '1〜2日で発送',
  shippingSize: '60サイズ',
  isAnonymousShipping: true,
};

interface ListingMediaItem { ref: ListingMediaRef; previewUrl: string; sourceFile?: File }

interface DraftFormData {
  title: string; price: string; description: string; category: string; subcategory: string; condition: string;
  brand: string; color: string; size: string; modelNumber: string; familyId: string; variantId: string;
  inventoryPolicy: 'SINGLE' | 'MULTI'; inventoryQuantity: string; shippingFee: string; shippingMethod: string;
  origin: string; shippingDays: string; shippingSize: string; isAnonymousShipping: boolean;
}

interface PersistedListingDraft { draftId?: string; name: string; form: DraftFormData; media: ListingMediaRef[]; imageOrder: ListingImageOrder[]; updatedAt: string }
interface AiSuggestions { title: string; description: string; category: string; condition: string; color: string }
interface PolicySignal { label: string; status: 'pass' | 'warning' | 'blocked'; detail: string }

const emptyAiSuggestions: AiSuggestions = { title: '', description: '', category: '', condition: '', color: '' };
const initialForm: DraftFormData = {
  title: '', price: '', description: '', category: '', subcategory: '', condition: '', brand: '', color: '', size: '', modelNumber: '', familyId: '', variantId: '', inventoryPolicy: 'SINGLE', inventoryQuantity: '1', ...DEFAULT_SHIPPING,
};

const readPersistedDrafts = (actorId = 'seller_01'): PersistedListingDraft[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(scopedDraftKey(DRAFT_STORAGE_KEY, actorId)) ?? window.localStorage.getItem(DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((draft): draft is PersistedListingDraft => Boolean(draft && typeof draft === 'object' && 'form' in draft)).map((draft) => ({
      ...draft,
      draftId: typeof draft.draftId === 'string' && draft.draftId.trim() ? draft.draftId : createLocalDraftId(),
      name: typeof draft.name === 'string' && draft.name.trim() ? draft.name : '下書き',
      media: Array.isArray(draft.media) ? draft.media : [],
      imageOrder: Array.isArray(draft.imageOrder) ? draft.imageOrder : (Array.isArray(draft.media) ? draft.media.map((ref, index) => ({ mediaId: ref.id, order: index, isCover: index === 0 })) : []),
      updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : new Date().toISOString(),
    })) : [];
  } catch { return []; }
};

const writePersistedDrafts = (drafts: PersistedListingDraft[], actorId = 'seller_01'): void => {
  try {
    window.localStorage.setItem(scopedDraftKey(DRAFT_STORAGE_KEY, actorId), JSON.stringify(drafts));
    window.dispatchEvent(new Event('furima-listing-drafts-changed'));
  } catch { /* IndexedDB/API is still authoritative. */ }
};

const humanizeImageError = (error: unknown): string => {
  switch (error instanceof Error ? error.message : '') {
    case 'image-too-large': return '1枚10MB以下の画像を選択してください。';
    case 'image-mime-mismatch': return 'ファイルの実体とMIMEタイプが一致しない画像は追加できません。';
    case 'unsupported-image-type': return 'JPEG、PNG、WebP、AVIF、GIFのみ追加できます。SVGや外部URLは使用できません。';
    case 'image-processing-failed': return '画像の変換に失敗しました。別の画像をお試しください。';
    default: return '画像の読み込みに失敗しました。再試行するか、別の画像をお試しください。';
  }
};

const formatDraftDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '日時不明' : date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

let localDraftSequence = 0;
const createLocalDraftId = (): string => `local-draft-${typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now()}-${++localDraftSequence}`}`;

const cleanupUnusedMedia = (candidateIds: string[], drafts: PersistedListingDraft[]): Promise<void> => {
  const referencedIds = new Set(drafts.flatMap((draft) => Array.isArray(draft.media) ? draft.media.map((ref) => ref.id) : []));
  const removableIds = [...new Set(candidateIds)].filter((id) => id.startsWith('media_') && !referencedIds.has(id));
  return removableIds.length ? deleteListingMediaMany(removableIds) : Promise.resolve();
};

const moveMedia = (items: ListingMediaItem[], index: number, offset: number): ListingMediaItem[] => {
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
};

const asListingInput = (form: DraftFormData, media: ListingMediaItem[], selectedFamily: typeof CATALOG_FAMILIES[number] | undefined, selectedVariant: typeof CATALOG_VARIANTS[number] | undefined): Partial<MercariItem> => {
  const numericPrice = Number(form.price);
  const numericInventoryQuantity = Number(form.inventoryQuantity);
  const ready = media.filter((item) => item.ref.status === 'ready');
  return {
    title: form.title.trim(), price: Number.isInteger(numericPrice) ? numericPrice : 0, description: form.description.trim(),
    category: [form.category, form.subcategory].filter(Boolean), condition: form.condition, brand: form.brand.trim() || undefined,
    color: form.color.trim() || undefined, size: form.size.trim() || undefined, sku: form.modelNumber.trim() || undefined,
    // images remains a compatibility projection for the current local renderer. imageRefs is the persistence contract.
    images: ready.map((item) => item.previewUrl), imageRefs: ready.map((item) => item.ref.id),
    shippingFee: form.shippingFee, shippingMethod: form.shippingMethod, origin: form.origin, shippingDays: form.shippingDays,
    shippingSize: form.shippingSize, isAnonymousShipping: form.isAnonymousShipping, productFamilyId: selectedFamily?.id,
    productFamilyName: selectedFamily?.name, variantId: selectedVariant?.id, variantName: selectedVariant?.name,
    productType: selectedFamily?.productType, searchTags: [form.category, form.subcategory, selectedFamily?.name, selectedVariant?.name, selectedFamily?.productType].filter((value): value is string => Boolean(value)),
    attributes: selectedVariant?.attributes, inventoryPolicy: form.inventoryPolicy,
    inventoryQuantity: form.inventoryPolicy === 'MULTI' && Number.isInteger(numericInventoryQuantity) && numericInventoryQuantity > 0 ? numericInventoryQuantity : 1,
  };
};

export const ListingView: React.FC = () => {
  const { isListingModalOpen, setIsListingModalOpen, createListingDraft, updateListingDraft, deleteListingDraft: deleteDomainListingDraft, submitListing, activeActor, isDeviceFrame } = useMercari();
  const [form, setForm] = useState<DraftFormData>(initialForm);
  const [media, setMedia] = useState<ListingMediaItem[]>([]);
  const [step, setStep] = useState<ListingStep>('photos');
  const [isAutoInputOn, setIsAutoInputOn] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestions>(emptyAiSuggestions);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [processingProgress, setProcessingProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasPolicyAccepted, setHasPolicyAccepted] = useState(false);
  const [drafts, setDrafts] = useState<PersistedListingDraft[]>(() => readPersistedDrafts(activeActor.id));
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>();
  const [isDraftsOpen, setIsDraftsOpen] = useState(false);
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [draggedMediaId, setDraggedMediaId] = useState<string | null>(null);
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState('');
  const flowRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const previousScrollYRef = useRef(0);
  const persistDraftRef = useRef<(silent?: boolean) => void>(() => undefined);
  const processingRef = useRef(false);
  const aiTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const closeFlowRef = useRef<(force?: boolean) => void>(() => undefined);

  const stopCameraStream = () => {
    const tracks: MediaStreamTrack[] = cameraStreamRef.current?.getTracks() ?? [];
    tracks.forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  };
  const closeCamera = () => { stopCameraStream(); setIsCameraOpen(false); };

  const selectedFamily = useMemo(() => CATALOG_FAMILIES.find((family) => family.id === form.familyId), [form.familyId]);
  const availableVariants = useMemo(() => CATALOG_VARIANTS.filter((variant) => variant.familyId === form.familyId), [form.familyId]);
  const selectedVariant = useMemo(() => availableVariants.find((variant) => variant.id === form.variantId), [availableVariants, form.variantId]);
  const numericPrice = Number(form.price);
  const sellerFee = Number.isInteger(numericPrice) && numericPrice >= MIN_LISTING_PRICE ? Math.floor(numericPrice * 0.1) : 0;
  const expectedProceeds = Math.max(0, numericPrice - sellerFee);
  const readyMedia = media.filter((item) => item.ref.status === 'ready' && item.previewUrl);
  const formFingerprint = JSON.stringify({ form, media: media.map((item) => item.ref.id) });
  const isDirty = formFingerprint !== lastSavedFingerprint;

  const policySignals = useMemo<PolicySignal[]>(() => {
    const text = `${form.title} ${form.description}`.toLowerCase();
    const prohibited = ['拳銃', '麻薬', '偽ブランド', '爆薬', '違法'].find((keyword) => text.includes(keyword));
    const containsPersonalData = /(?:https?:\/\/|www\.|@|\d{2,4}-\d{2,4}-\d{3,4})/u.test(`${form.title} ${form.description}`);
    return [
      { label: '商品名・説明', status: form.title.trim().length >= 1 && form.title.trim().length <= 40 && form.description.trim().length <= 1000 ? 'pass' : 'blocked', detail: form.title.trim().length >= 1 && form.title.trim().length <= 40 && form.description.trim().length <= 1000 ? '文字数制限を満たしています' : '商品名1〜40文字、説明1,000文字以内で入力してください' },
      { label: '価格', status: numericPrice >= MIN_LISTING_PRICE && numericPrice <= MAX_LISTING_PRICE && Number.isInteger(numericPrice) ? 'pass' : 'blocked', detail: numericPrice >= MIN_LISTING_PRICE && numericPrice <= MAX_LISTING_PRICE && Number.isInteger(numericPrice) ? '300〜9,999,999円の範囲です' : '価格は300〜9,999,999円の整数で入力してください' },
      { label: '画像', status: readyMedia.length > 0 ? 'pass' : 'warning', detail: readyMedia.length > 0 ? `${readyMedia.length}枚を確認できます（最大20枚）` : '購入者が状態を確認できる画像を1枚以上追加してください' },
      { label: '禁止出品物チェック', status: prohibited ? 'blocked' : 'pass', detail: prohibited ? `禁止ワード「${prohibited}」を検出しました` : '危険なワードはありません' },
      { label: '個人情報チェック', status: containsPersonalData ? 'warning' : 'pass', detail: containsPersonalData ? 'URL・連絡先らしき文字列があります。公開前に確認してください' : '連絡先・外部誘導は見つかりませんでした' },
      { label: 'カテゴリー・状態・配送', status: form.category && form.subcategory && form.condition && form.shippingMethod ? 'pass' : 'blocked', detail: form.category && form.subcategory && form.condition && form.shippingMethod ? '必須項目が入力されています' : 'カテゴリー、サブカテゴリー、状態、配送方法を入力してください' },
    ];
  }, [form.category, form.condition, form.description, form.shippingMethod, form.subcategory, form.title, numericPrice, readyMedia.length]);
  const hasBlockingIssue = policySignals.some((signal) => signal.status === 'blocked');

  const showNotice = (message: string) => {
    setNotice(message);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => { noticeTimerRef.current = null; setNotice(null); }, 2600);
  };

  const setCategory = (value: string) => setForm((current) => ({ ...current, category: value }));

  const resetForm = (remainingDrafts = drafts) => {
    void cleanupUnusedMedia(media.map((item) => item.ref.id), remainingDrafts).catch(() => setError('不要な画像のクリーンアップに失敗しました。後で再試行してください。'));
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
    aiTimerRef.current = null;
    processingRef.current = false;
    setForm({ ...initialForm }); setMedia([]); setStep('photos'); setIsAnalyzing(false); setAiSuggestions(emptyAiSuggestions); setAiConfidence(null); setProcessingProgress(null); setError(null); setNotice(null); setHasPolicyAccepted(false); setCurrentDraftId(undefined); setLastSavedFingerprint('');
    setCategory('');
  };

  const closeFlow = useCallback((force = false) => {
    if (!force && isDirty && (form.title.trim() || form.price || media.length)) {
      if (!window.confirm('保存されていない変更があります。出品フローを閉じますか？')) return;
    }
    setIsListingModalOpen(false);
  }, [form.price, form.title, isDirty, media.length, setIsListingModalOpen]);
  useEffect(() => {
    closeFlowRef.current = closeFlow;
  }, [closeFlow]);

  useEffect(() => {
    if (!isListingModalOpen) return undefined;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    previousScrollYRef.current = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFirstControl = () => { scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' }); flowRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus({ preventScroll: true }); };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeFlowRef.current(); return; }
      if (event.key !== 'Tab' || !flowRef.current) return;
      const focusable = Array.from(flowRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    };
    const frame = window.requestAnimationFrame(focusFirstControl);
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', handleKeyDown); document.body.style.overflow = previousOverflow; window.scrollTo({ top: previousScrollYRef.current, behavior: 'auto' }); previousActiveElementRef.current?.focus({ preventScroll: true }); };
    // The flow owns focus while open. Step focus is handled by the separate effect.
  }, [isListingModalOpen]);

  useEffect(() => {
    if (!isListingModalOpen) return;
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    flowRef.current?.querySelector<HTMLElement>(`[data-step="${step}"]`)?.focus({ preventScroll: true });
  }, [isListingModalOpen, step]);

  useEffect(() => {
    if (!isCameraOpen) return undefined;
    let cancelled = false;
    const startCamera = async () => {
      if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('この環境ではカメラを利用できません。端末のカメラ入力へ切り替えてください。');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode }, audio: false });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play().catch(() => undefined);
        }
        setCameraError(null);
      } catch {
        if (!cancelled) setCameraError('カメラを起動できませんでした。権限を確認するか、端末のカメラ入力へ切り替えてください。');
      }
    };
    void startCamera();
    return () => { cancelled = true; stopCameraStream(); };
  }, [cameraFacingMode, isCameraOpen]);

  useEffect(() => () => stopCameraStream(), []);

  const processFiles = async (fileList: FileList | File[], source: 'camera' | 'album') => {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (processingRef.current) return;
    const remaining = MAX_LISTING_IMAGES - media.length;
    if (remaining <= 0) { setError('写真は最大20枚までです。追加するには既存の写真を削除してください。'); return; }
    processingRef.current = true;
    if (files.length > remaining) setError(`写真は最大20枚までです。今回の追加では${remaining}枚まで受け付けます。`);
    const acceptedFiles = files.slice(0, remaining);
    setProcessingProgress({ done: 0, total: acceptedFiles.length });
    try {
      const prepared: ListingMediaItem[] = [];
      for (let index = 0; index < acceptedFiles.length; index += 2) {
        const batch = acceptedFiles.slice(index, index + 2);
        const results = await Promise.all(batch.map(async (file) => {
          if (file.size > MAX_IMAGE_FILE_BYTES) return { file, error: new Error('image-too-large') };
          try { return { file, result: await prepareListingMedia(file, source) }; } catch (prepareError) { return { file, error: prepareError instanceof Error ? prepareError : new Error('image-processing-failed') }; }
        }));
        results.forEach(({ file, result, error: fileError }, resultIndex) => {
          if (result) prepared.push({ ref: result.ref, previewUrl: result.previewUrl, sourceFile: file });
          else prepared.push({ ref: { id: `error_${Date.now()}_${index + resultIndex}`, source, status: 'error', mimeType: 'image/webp', createdAt: new Date().toISOString(), errorCode: fileError?.message ?? 'image-processing-failed' }, previewUrl: '', sourceFile: file });
        });
        setProcessingProgress({ done: Math.min(index + batch.length, acceptedFiles.length), total: acceptedFiles.length });
      }
      setMedia((current) => [...current, ...prepared]);
      if (prepared.some((item) => item.ref.status === 'error')) setError('一部の画像を読み込めませんでした。失敗した画像は「再試行」できます。'); else setError(null);
      if (acceptedFiles.length && isAutoInputOn && prepared.some((item) => item.ref.status === 'ready')) {
        if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
        setIsAnalyzing(true);
        showNotice('画像解析デモ（モック）を生成しています。');
        const sourceName = prepared.find((item) => item.ref.status === 'ready')?.sourceFile?.name?.replace(/\.[^.]+$/u, '').trim();
        aiTimerRef.current = window.setTimeout(() => {
          aiTimerRef.current = null;
          const title = sourceName ? `${sourceName.slice(0, 32)}（デモ候補）` : '画像から作成した商品名（デモ候補）';
          setAiSuggestions({ title, description: '画像から作成したモック候補です。カラーやサイズ、付属品を確認してから公開してください。', category: 'レディース', condition: '目立った傷や汚れなし', color: 'グリーン' });
          setAiConfidence(87);
          setIsAnalyzing(false);
        }, 500);
      }
    } catch (processingError) {
      setError(humanizeImageError(processingError));
    } finally {
      setProcessingProgress(null);
      processingRef.current = false;
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>, source: 'camera' | 'album') => { await processFiles(event.target.files ?? [], source); event.target.value = ''; };

  const openCamera = () => {
    if (media.length >= MAX_LISTING_IMAGES || processingProgress) return;
    if (typeof window === 'undefined' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setNotice('カメラ非対応のため、端末のカメラ入力を開きます。');
      cameraInputRef.current?.click();
      return;
    }
    setCameraError(null);
    setIsCameraOpen(true);
  };

  const captureCameraFrame = () => {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCameraError('カメラ映像の準備中です。少し待ってから撮影してください。');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { setCameraError('カメラ画像を作成できませんでした。'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setCameraError('撮影画像の保存に失敗しました。もう一度お試しください。'); return; }
      const file = new File([blob], `listing-camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      void processFiles([file], 'camera');
      closeCamera();
    }, 'image/jpeg', 0.92);
  };

  const retryMedia = async (item: ListingMediaItem) => {
    if (!item.sourceFile) { setError('元ファイルが見つからないため再試行できません。もう一度アルバムから追加してください。'); return; }
    try { const result = await prepareListingMedia(item.sourceFile, item.ref.source === 'camera' ? 'camera' : 'album'); setMedia((current) => current.map((candidate) => candidate.ref.id === item.ref.id ? { ref: result.ref, previewUrl: result.previewUrl, sourceFile: item.sourceFile } : candidate)); setError(null); } catch (retryError) { setError(humanizeImageError(retryError)); }
  };

  const deleteMedia = (id: string) => {
    const item = media.find((candidate) => candidate.ref.id === id); if (!item) return;
    setMedia((current) => current.filter((candidate) => candidate.ref.id !== id));
    if (!currentDraftId && item.ref.id.startsWith('media_')) void deleteListingMediaMany([item.ref.id]).catch(() => setError('画像の削除に失敗しました。後で再試行してください。'));
    if (!media.some((candidate) => candidate.ref.id !== id && candidate.ref.status === 'ready')) {
      if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
      setIsAnalyzing(false); setAiSuggestions(emptyAiSuggestions); setAiConfidence(null);
    }
    showNotice('写真を削除しました。');
  };

  const setCover = (id: string) => setMedia((current) => { const index = current.findIndex((item) => item.ref.id === id); return index <= 0 ? current : moveMedia(current, index, -index); });
  const reorderMedia = (id: string, offset: -1 | 1) => setMedia((current) => moveMedia(current, current.findIndex((item) => item.ref.id === id), offset));

  const applyAiSuggestion = (field: AiField) => {
    const value = aiSuggestions[field]; if (!value) return;
    setForm((current) => { if (current[field]) return current; return { ...current, [field]: value }; });
    setAiSuggestions((current) => ({ ...current, [field]: '' }));
  };

  const applyTemplate = (template: TemplateName) => {
    const templates: Record<TemplateName, Partial<DraftFormData>> = {
      book: { title: 'やさしく学べる 入門書', description: '書き込みのないきれいな状態です。匿名配送で発送します。', category: '本・マンガ', subcategory: '本', condition: '目立った傷や汚れなし' },
      fashion: { title: 'ミントグリーン ウール混ニットセーター', description: '写真から作成した候補です。カラーやサイズをご確認ください。', category: 'レディース', subcategory: 'トップス', condition: '目立った傷や汚れなし', color: 'グリーン' },
      device: { title: 'スマートフォン 本体 128GB', description: '動作確認済みです。初期化して発送します。付属品は写真に写っているものがすべてです。', category: '家電・スマホ', subcategory: 'スマートフォン', condition: 'やや傷や汚れあり', brand: 'Apple' },
    };
    setForm((current) => ({ ...current, ...templates[template] })); setIsTemplateOpen(false); showNotice('テンプレートを反映しました。候補は自由に修正できます。');
  };

  const draftData = (): PersistedListingDraft => ({ draftId: currentDraftId, name: form.title.trim() || `下書き ${new Date().toLocaleDateString('ja-JP')}`, form: { ...form }, media: media.map((item) => item.ref), imageOrder: media.map((item, index) => ({ mediaId: item.ref.id, order: index, isCover: index === 0 })), updatedAt: new Date().toISOString() });

  const restoreDraft = async (draft: PersistedListingDraft) => {
    const orderedMedia = [...draft.media].sort((left, right) => (draft.imageOrder.find((entry) => entry.mediaId === left.id)?.order ?? Number.MAX_SAFE_INTEGER) - (draft.imageOrder.find((entry) => entry.mediaId === right.id)?.order ?? Number.MAX_SAFE_INTEGER));
    const restored = await Promise.all(orderedMedia.map(async (ref) => { const previewUrl = await getListingMedia(ref.id); return { ref: { ...ref, status: previewUrl ? 'ready' as const : 'error' as const }, previewUrl: previewUrl ?? '' }; }));
    setForm({ ...initialForm, ...draft.form }); setStep('photos'); setCurrentDraftId(draft.draftId); setError(null); setMedia(restored); setLastSavedFingerprint(JSON.stringify({ form: { ...initialForm, ...draft.form }, media: draft.media.map((item) => item.id) })); setIsDraftsOpen(false); setIsListingModalOpen(true); showNotice('下書きを復元しました。');
  };

  useEffect(() => {
    const pendingDraftId = window.localStorage.getItem(scopedDraftKey(OPEN_DRAFT_STORAGE_KEY, activeActor.id));
    if (!pendingDraftId) return;
    window.localStorage.removeItem(scopedDraftKey(OPEN_DRAFT_STORAGE_KEY, activeActor.id));
    const pendingDraft = readPersistedDrafts(activeActor.id).find((draft) => draft.draftId === pendingDraftId);
    if (pendingDraft) window.setTimeout(() => { void restoreDraft(pendingDraft); }, 0);
    // This is a one-shot handoff from My Page to the newly mounted listing route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistDraft = (silent = false) => {
    if (!form.title.trim() && !form.price && media.length === 0) { if (!silent) showNotice('商品名・価格・画像のいずれかを入力してから保存してください'); return; }
    const previousDraft = currentDraftId ? drafts.find((draft) => draft.draftId === currentDraftId) : undefined;
    const input = asListingInput(form, media, selectedFamily, selectedVariant);
    let result = currentDraftId ? updateListingDraft(currentDraftId, input) : createListingDraft(input);
    if (!result.ok && currentDraftId && result.error === 'DRAFT_NOT_FOUND') result = createListingDraft(input);
    if (!result.ok && !currentDraftId && (result.error === 'AUTH_REQUIRED' || result.error === 'FORBIDDEN')) {
      const localDraftId = createLocalDraftId();
      const localDraft: PersistedListingDraft = { ...draftData(), draftId: localDraftId };
      const nextDrafts = [localDraft, ...drafts];
      setCurrentDraftId(localDraftId); setDrafts(nextDrafts); writePersistedDrafts(nextDrafts, activeActor.id); setLastSavedFingerprint(JSON.stringify({ form, media: media.map((item) => item.ref.id) }));
      if (!silent) showNotice('権限が反映されるまで、この下書きを端末に保存しました。');
      return;
    }
    if (!result.ok) { if (!silent) setError(result.message || '下書きを保存できませんでした。seller actorへ切り替えてください。'); return; }
    const nextDraftId = result.data.draftId;
    const nextDraft: PersistedListingDraft = { ...draftData(), draftId: nextDraftId };
    const nextDrafts = [nextDraft, ...drafts.filter((draft) => draft.draftId !== nextDraftId && draft.draftId !== currentDraftId)];
    void cleanupUnusedMedia(previousDraft?.media.map((item) => item.id) ?? [], nextDrafts).catch(() => setError('不要な画像のクリーンアップに失敗しました。後で再試行してください。'));
    setCurrentDraftId(nextDraftId); setDrafts(nextDrafts); writePersistedDrafts(nextDrafts, activeActor.id); setLastSavedFingerprint(JSON.stringify({ form, media: media.map((item) => item.ref.id) })); if (!silent) showNotice('下書きを保存しました。複数の下書きからいつでも再開できます。');
  };
  useEffect(() => {
    persistDraftRef.current = persistDraft;
  });

  useEffect(() => () => {
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current);
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    const referencedMediaIds = drafts.flatMap((draft) => draft.media.map((ref) => ref.id));
    void pruneListingMedia(referencedMediaIds).catch(() => setError('古い画像のクリーンアップに失敗しました。後で再試行してください。'));
  }, [activeActor.id, drafts]);

  useEffect(() => {
    const hasDraftContent = Boolean(form.title.trim() || form.price || media.length);
    if (!isListingModalOpen || !isDirty || !hasDraftContent) return undefined;
    const timer = window.setTimeout(() => persistDraftRef.current(true), 1200);
    return () => window.clearTimeout(timer);
  }, [form, formFingerprint, isDirty, isListingModalOpen, media]);

  const saveDraft = () => persistDraft(false);
  const deleteDraft = (draft: PersistedListingDraft) => {
    if (draft.draftId?.startsWith('draft-')) {
      const result = deleteDomainListingDraft(draft.draftId);
      if (!result.ok && result.error !== 'DRAFT_NOT_FOUND') { setError(result.message || '下書きを削除できませんでした。'); return; }
    }
    const nextDrafts = drafts.filter((candidate) => candidate !== draft && candidate.draftId !== draft.draftId);
    void cleanupUnusedMedia(draft.media.map((item) => item.id), nextDrafts).catch(() => setError('下書き画像の削除に失敗しました。後で再試行してください。'));
    setDrafts(nextDrafts); writePersistedDrafts(nextDrafts, activeActor.id); if (currentDraftId === draft.draftId) setCurrentDraftId(undefined); showNotice('下書きを削除しました。');
  };
  const duplicateDraft = (draft: PersistedListingDraft) => { const duplicate: PersistedListingDraft = { ...draft, draftId: createLocalDraftId(), name: `${draft.name}（コピー）`, updatedAt: new Date().toISOString() }; const nextDrafts = [duplicate, ...drafts]; setDrafts(nextDrafts); writePersistedDrafts(nextDrafts, activeActor.id); showNotice('下書きを複製しました。'); };
  const startNewListing = () => { resetForm(); setIsListingModalOpen(true); };

  const validateAndGo = (nextStep: ListingStep): boolean => {
    if (nextStep === 'info' && !readyMedia.length) { setError('写真を1枚以上追加してください。カメラ撮影またはアルバム選択を利用できます。'); return false; }
    if (nextStep === 'details' && (!form.title.trim() || form.title.trim().length > 40 || form.description.trim().length > 1000)) { setError('商品名は1〜40文字、説明は1,000文字以内で入力してください。'); setStep('info'); return false; }
    if (nextStep === 'review') {
      if (!form.category || !form.subcategory || !form.condition || !form.shippingMethod) { setError('カテゴリー、サブカテゴリー、状態、配送方法を入力してください。'); setStep('details'); return false; }
      if (!Number.isInteger(numericPrice) || numericPrice < MIN_LISTING_PRICE || numericPrice > MAX_LISTING_PRICE) { setError('価格は300〜9,999,999円の整数で入力してください。'); setStep('details'); return false; }
      if (form.inventoryPolicy === 'MULTI' && (!Number.isInteger(Number(form.inventoryQuantity)) || Number(form.inventoryQuantity) < 1)) { setError('複数在庫では1以上の整数を入力してください。'); setStep('details'); return false; }
    }
    setError(null); setStep(nextStep); return true;
  };

  const confirmListing = () => {
    if (hasBlockingIssue) { setError('チェックでブロックされた項目を修正してから出品してください。'); return; }
    if (!hasPolicyAccepted) { setError('出品ポリシーを確認してチェックを入れてください。'); return; }
    const input = asListingInput(form, media, selectedFamily, selectedVariant);
    let created = currentDraftId ? updateListingDraft(currentDraftId, input) : createListingDraft(input);
    if (!created.ok && currentDraftId && created.error === 'DRAFT_NOT_FOUND') created = createListingDraft(input);
    if (!created.ok) { setError(created.message || '下書きを作成できませんでした。seller actorへ切り替えてください。'); return; }
    const result = submitListing(created.data.draftId);
    if (!result.ok) { setError(result.message || '入力内容を確認してください。'); return; }
    const nextDrafts = drafts.filter((draft) => draft.draftId !== created.data.draftId); setDrafts(nextDrafts); writePersistedDrafts(nextDrafts, activeActor.id); resetForm(nextDrafts); setIsListingModalOpen(false); showNotice(`商品をモック出品しました（${activeActor.name}）。ホームの新着商品に追加されています。`);
  };

  const handleSubmit = (event: React.FormEvent) => { event.preventDefault(); if (step !== 'review') { const next: ListingStep = step === 'photos' ? 'info' : step === 'info' ? 'details' : 'review'; validateAndGo(next); } else confirmListing(); };
  const stepIndex = ['photos', 'info', 'details', 'review'].indexOf(step);
  const steps: Array<{ id: ListingStep; label: string; note: string }> = [{ id: 'photos', label: '写真', note: '最大20枚' }, { id: 'info', label: '商品情報', note: '商品名・説明' }, { id: 'details', label: '条件・配送・価格', note: '公開条件' }, { id: 'review', label: '公開前確認', note: '安全チェック' }];

  if (!isListingModalOpen) return <ListingHome isDeviceFrame={isDeviceFrame} drafts={drafts} notice={notice} isDraftsOpen={isDraftsOpen} onStart={startNewListing} onOpenDrafts={() => setIsDraftsOpen(true)} onCloseDrafts={() => setIsDraftsOpen(false)} onResume={(draft) => void restoreDraft(draft)} onDelete={deleteDraft} onDuplicate={duplicateDraft} />;

  return <div ref={flowRef} className={`${isDeviceFrame ? 'absolute' : 'fixed'} inset-0 z-[80] flex min-h-0 flex-col bg-[var(--shop-bg)]`} data-testid="listing-flow" role="dialog" aria-modal="true" aria-labelledby="listing-flow-title">
    <header className="shrink-0 border-b border-[var(--shop-border)] bg-[var(--shop-bg)] px-4 py-3 md:px-7"><div className="mx-auto flex max-w-[1080px] items-center gap-3"><button type="button" onClick={() => closeFlow()} aria-label="出品フローを閉じる" className="rounded-full p-2 text-[var(--shop-muted)] hover:bg-[var(--shop-surface)]"><X className="h-5 w-5" /></button><div className="min-w-0 flex-1"><h1 id="listing-flow-title" className="truncate text-base font-black text-white">出品する</h1><p className="mt-0.5 text-[10px] text-[var(--shop-muted)]">{readyMedia.length}/{MAX_LISTING_IMAGES}枚 ・ {isDirty ? '未保存の変更あり' : '保存済み'}</p></div><button type="button" onClick={saveDraft} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shop-border)] px-3 py-2 text-xs font-bold text-white hover:border-[var(--shop-blue)]"><Save className="h-4 w-4" />保存</button></div><nav className="mx-auto mt-3 grid max-w-[1080px] grid-cols-4 gap-1" aria-label="出品ステップ">{steps.map((item, index) => <button key={item.id} type="button" data-step={item.id} onClick={() => index <= stepIndex ? setStep(item.id) : validateAndGo(item.id)} className={`rounded-lg px-1 py-2 text-center ${step === item.id ? 'bg-[#183b4c]' : 'hover:bg-[var(--shop-surface)]'}`}><span className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${index <= stepIndex ? 'bg-[var(--shop-blue)] text-[#06202e]' : 'bg-[var(--shop-surface-raised)] text-[var(--shop-muted)]'}`}>{index < stepIndex ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className="mt-1 block truncate text-[10px] font-bold text-white">{item.label}</span><span className="hidden text-[9px] text-[var(--shop-muted)] sm:block">{item.note}</span></button>)}</nav></header>
    <div ref={scrollRef} className="shop-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="listing-flow-scroll"><form id="listing-form" onSubmit={handleSubmit} className="mx-auto max-w-[1080px] px-4 py-5 pb-8">{step === 'photos' && <PhotoStep media={media} processingProgress={processingProgress} isAnalyzing={isAnalyzing} aiConfidence={aiConfidence} aiSuggestions={aiSuggestions} isAutoInputOn={isAutoInputOn} onToggleAutoInput={() => setIsAutoInputOn((value) => !value)} onApplyAiSuggestion={applyAiSuggestion} onChooseCamera={openCamera} onChooseAlbum={() => albumInputRef.current?.click()} onDelete={deleteMedia} onRetry={(item) => void retryMedia(item)} onSetCover={setCover} onMove={reorderMedia} onDragStart={setDraggedMediaId} onDrop={(id) => { if (!draggedMediaId || draggedMediaId === id) return; setMedia((current) => { const from = current.findIndex((item) => item.ref.id === draggedMediaId); const to = current.findIndex((item) => item.ref.id === id); if (from < 0 || to < 0) return current; const next = [...current]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; }); setDraggedMediaId(null); }} />}{step === 'info' && <InfoStep form={form} aiSuggestions={aiSuggestions} onApplyAiSuggestion={applyAiSuggestion} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} onTemplate={() => setIsTemplateOpen(true)} />}{step === 'details' && <DetailsStep form={form} availableVariants={availableVariants} selectedVariant={selectedVariant} onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />}{step === 'review' && <ListingReview title={form.title} price={numericPrice} description={form.description} category={[form.category, form.subcategory].filter(Boolean).join(' / ')} condition={form.condition} imagePreview={readyMedia[0]?.previewUrl ?? null} imageCount={readyMedia.length} shippingFee={form.shippingFee} shippingMethod={form.shippingMethod} shippingDays={form.shippingDays} sellerFee={sellerFee} expectedProceeds={expectedProceeds} policySignals={policySignals} hasPolicyAccepted={hasPolicyAccepted} onPolicyChange={setHasPolicyAccepted} />}{error && <p className="mt-5 flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-[var(--shop-accent)]" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}</form>{isTemplateOpen && <TemplateOverlay onSelect={applyTemplate} onClose={() => setIsTemplateOpen(false)} />}</div>
    <div className="shrink-0 border-t border-[var(--shop-border)] bg-[var(--shop-bg)] px-4 py-3 md:px-7"><div className="mx-auto flex max-w-[1080px] items-center gap-2"><button type="button" onClick={() => { const previous = ['photos', 'info', 'details', 'review'][Math.max(0, stepIndex - 1)] as ListingStep; if (stepIndex > 0) setStep(previous); else closeFlow(); }} className="inline-flex items-center gap-1 rounded-lg border border-[var(--shop-border)] px-3 py-3 text-sm font-bold text-white"><ArrowLeft className="h-4 w-4" />戻る</button><button type="button" onClick={saveDraft} className="hidden items-center gap-1 rounded-lg px-3 py-3 text-xs font-bold text-[var(--shop-muted)] hover:text-white sm:inline-flex"><Save className="h-4 w-4" />下書き保存</button><span className="flex-1 text-right text-[10px] text-[var(--shop-muted)]">{notice ?? (processingProgress ? `画像を処理中 ${processingProgress.done}/${processingProgress.total}` : `${stepIndex + 1}/4`)}</span>{step === 'review' ? <button type="submit" form="listing-form" disabled={hasBlockingIssue || !hasPolicyAccepted} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--shop-accent)] px-4 py-3 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)] disabled:cursor-not-allowed disabled:bg-[#55555a]" data-testid="submit-listing-btn">出品する<CheckCircle2 className="h-4 w-4" /></button> : <button type="submit" form="listing-form" className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--shop-blue)] px-4 py-3 text-sm font-black text-[#06202e] hover:brightness-110" data-testid="listing-next-btn">次へ<ArrowRight className="h-4 w-4" /></button>}</div></div><input ref={cameraInputRef} id="listing-camera" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => void handleFileChange(event, 'camera')} /><input ref={albumInputRef} id="listing-images" type="file" accept="image/*" multiple className="sr-only" onChange={(event) => void handleFileChange(event, 'album')} />{isCameraOpen && <CameraCaptureOverlay videoRef={cameraVideoRef} error={cameraError} facingMode={cameraFacingMode} isDeviceFrame={isDeviceFrame} onCapture={captureCameraFrame} onClose={closeCamera} onSwitch={() => setCameraFacingMode((current) => current === 'environment' ? 'user' : 'environment')} onFallback={() => { closeCamera(); cameraInputRef.current?.click(); }} />}
  </div>;
};

interface PhotoStepProps { media: ListingMediaItem[]; processingProgress: { done: number; total: number } | null; isAnalyzing: boolean; aiConfidence: number | null; aiSuggestions: AiSuggestions; isAutoInputOn: boolean; onToggleAutoInput: () => void; onApplyAiSuggestion: (field: AiField) => void; onChooseCamera: () => void; onChooseAlbum: () => void; onDelete: (id: string) => void; onRetry: (item: ListingMediaItem) => void; onSetCover: (id: string) => void; onMove: (id: string, offset: -1 | 1) => void; onDragStart: (id: string) => void; onDrop: (id: string) => void }

const PhotoStep: React.FC<PhotoStepProps> = ({ media, processingProgress, isAnalyzing, aiConfidence, aiSuggestions, isAutoInputOn, onToggleAutoInput, onApplyAiSuggestion, onChooseCamera, onChooseAlbum, onDelete, onRetry, onSetCover, onMove, onDragStart, onDrop }) => {
  const hasSuggestions = Object.values(aiSuggestions).some(Boolean);
  return <section className="space-y-5"><div><p className="text-xs font-bold text-[var(--shop-blue)]">STEP 1</p><h2 className="mt-1 text-xl font-black text-white">商品の写真を追加</h2><p className="mt-1 text-sm leading-6 text-[var(--shop-muted)]">1枚目が表紙になります。最大20枚を追加して、順序と表紙を確認できます。</p></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white">写真 {media.length}/{MAX_LISTING_IMAGES}</h3><p className="mt-1 text-xs text-[var(--shop-muted)]">JPEG・PNG・WebP・AVIF・GIF / 1枚10MB以下 / 自動で1600px以下に変換</p></div><div className="flex items-center gap-2"><button type="button" onClick={onChooseCamera} disabled={media.length >= MAX_LISTING_IMAGES || Boolean(processingProgress)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40"><Camera className="h-4 w-4 text-[var(--shop-blue)]" />カメラで撮影</button><button type="button" onClick={onChooseAlbum} disabled={media.length >= MAX_LISTING_IMAGES || Boolean(processingProgress)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--shop-blue)] px-3 py-2.5 text-xs font-black text-[#06202e] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><ImagePlus className="h-4 w-4" />アルバムから選択</button></div></div><div className="mt-4 grid grid-cols-4 gap-2 xl:grid-cols-5" role="list" aria-label={`追加した写真 ${media.length}枚`} aria-live="polite">{media.map((item, index) => <MediaTile key={item.ref.id} item={item} index={index} total={media.length} onDelete={onDelete} onRetry={onRetry} onSetCover={onSetCover} onMove={onMove} onDragStart={onDragStart} onDrop={onDrop} />)}{Array.from({ length: Math.max(0, Math.min(4, MAX_LISTING_IMAGES - media.length)) }).map((_, index) => <button key={`empty-${index}`} type="button" onClick={onChooseAlbum} disabled={media.length >= MAX_LISTING_IMAGES || Boolean(processingProgress)} className="flex aspect-square min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--shop-border)] bg-[var(--shop-bg)] text-[var(--shop-subtle)] hover:border-[var(--shop-blue)] hover:text-[var(--shop-blue)] disabled:cursor-not-allowed disabled:opacity-40" aria-label={`写真を追加 ${media.length + index + 1}枚目`}><Plus className="h-5 w-5" /><span className="mt-1 text-[10px]">{media.length + index + 1}</span></button>)}</div>{media.length >= MAX_LISTING_IMAGES && <p className="mt-3 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200" role="status">最大20枚に達しました。追加ボタンは無効です。</p>}{processingProgress && <div className="mt-4 rounded-lg bg-[var(--shop-bg)] p-3 text-xs text-[var(--shop-muted)]" role="status"><div className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-[var(--shop-blue)]" />画像を処理中 {processingProgress.done}/{processingProgress.total}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--shop-surface-raised)]"><div className="h-full rounded-full bg-[var(--shop-blue)] transition-all" style={{ width: `${Math.round((processingProgress.done / Math.max(1, processingProgress.total)) * 100)}%` }} /></div></div>}</div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--shop-blue)]" /><div><h3 className="text-sm font-black text-white">画像解析デモ（モック）</h3><p className="mt-1 text-xs text-[var(--shop-muted)]">画像ファイル名を使った固定ルールの候補です。公開前に必ず内容を確認してください。</p></div></div><button type="button" onClick={onToggleAutoInput} className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${isAutoInputOn ? 'justify-end bg-[var(--shop-blue)]' : 'justify-start bg-[var(--shop-border)]'}`} aria-label={isAutoInputOn ? '画像解析デモをオフにする' : '画像解析デモをオンにする'}><span className="h-5 w-5 rounded-full bg-white shadow" /></button></div>{isAnalyzing && <p className="mt-3 flex items-center gap-2 text-xs text-[var(--shop-muted)]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />モック候補を生成しています…</p>}{aiConfidence && !isAnalyzing && <p className="mt-3 text-[10px] text-[var(--shop-muted)]">モック推定信頼度 {aiConfidence}% ・ 公開前に必ず確認してください</p>}{hasSuggestions && !isAnalyzing && <div className="mt-4 grid gap-2 md:grid-cols-2">{([['title', '商品名', aiSuggestions.title], ['description', '説明', aiSuggestions.description], ['category', 'カテゴリー', aiSuggestions.category], ['condition', '状態', aiSuggestions.condition], ['color', '色', aiSuggestions.color]] as const).filter(([, , value]) => value).map(([field, label, value]) => <div key={field} className="rounded-lg bg-[var(--shop-bg)] p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[10px] font-bold text-[var(--shop-muted)]">{label}候補</p><p className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap text-xs text-white">{value}</p></div><button type="button" onClick={() => onApplyAiSuggestion(field)} className="shrink-0 rounded-md bg-[var(--shop-blue)] px-2 py-1.5 text-[10px] font-black text-[#06202e]">採用</button></div></div>)}</div>}</div></section>;
};

interface MediaTileProps { item: ListingMediaItem; index: number; total: number; onDelete: (id: string) => void; onRetry: (item: ListingMediaItem) => void; onSetCover: (id: string) => void; onMove: (id: string, offset: -1 | 1) => void; onDragStart: (id: string) => void; onDrop: (id: string) => void }

interface CameraCaptureOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  facingMode: 'environment' | 'user';
  isDeviceFrame: boolean;
  onCapture: () => void;
  onClose: () => void;
  onSwitch: () => void;
  onFallback: () => void;
}

const CameraCaptureOverlay: React.FC<CameraCaptureOverlayProps> = ({ videoRef, error, facingMode, isDeviceFrame, onCapture, onClose, onSwitch, onFallback }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, true, onClose);
  return (
    <div className={`${isDeviceFrame ? 'absolute' : 'fixed'} inset-0 z-[120] flex items-center justify-center bg-black/90 p-4`} role="dialog" aria-modal="true" aria-label="カメラで撮影">
      <div ref={dialogRef} className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#161618] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><h2 className="font-black text-white">カメラで撮影</h2><p className="mt-0.5 text-[11px] text-white/60">撮影した画像は自動で出品写真に追加されます</p></div><button type="button" onClick={onClose} aria-label="カメラを閉じる" className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button></div>
        <div className="relative aspect-[3/4] min-h-0 bg-black"><video ref={videoRef} playsInline autoPlay muted className="h-full w-full object-cover" aria-label="カメラプレビュー" />{error && <div className="absolute inset-x-4 bottom-4 rounded-xl border border-red-300/30 bg-black/75 p-3 text-xs leading-5 text-red-100" role="alert">{error}</div>}</div>
        <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 px-4 py-4"><button type="button" onClick={onFallback} className="rounded-lg border border-white/15 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/10">端末のカメラ入力</button><button type="button" onClick={onSwitch} className="rounded-full border border-white/15 px-3 py-2.5 text-xs font-bold text-white hover:bg-white/10">カメラ切替（{facingMode === 'environment' ? '背面' : '前面'}）</button><button type="button" onClick={onCapture} className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[var(--shop-accent)] text-white shadow-lg hover:scale-105" aria-label="撮影"><Camera className="h-6 w-6" /></button></div>
      </div>
    </div>
  );
};
const MediaTile: React.FC<MediaTileProps> = ({ item, index, total, onDelete, onRetry, onSetCover, onMove, onDragStart, onDrop }) => (
  <div role="listitem" aria-posinset={index + 1} aria-setsize={total} draggable={item.ref.status === 'ready'} onDragStart={() => onDragStart(item.ref.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(item.ref.id)} className={`group relative aspect-square overflow-hidden rounded-lg border ${index === 0 ? 'border-[var(--shop-blue)]' : 'border-[var(--shop-border)]'} bg-[var(--shop-bg)]`}>
    <div className="absolute left-1.5 top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/75 px-1 text-[10px] font-black text-white">{index + 1}</div>
    {item.ref.status === 'ready' && item.previewUrl ? <img src={item.previewUrl} alt={`出品写真 ${index + 1}枚目`} className="h-full w-full object-cover" /> : item.ref.status === 'processing' ? <div className="flex h-full flex-col items-center justify-center text-[var(--shop-muted)]"><LoaderCircle className="h-6 w-6 animate-spin" /><span className="mt-1 text-[10px]">読み込み中</span></div> : <div className="flex h-full flex-col items-center justify-center p-2 text-center text-[var(--shop-accent)]"><AlertTriangle className="h-5 w-5" /><span className="mt-1 text-[10px]">読み込み失敗</span><button type="button" onClick={() => onRetry(item)} className="mt-2 inline-flex items-center gap-1 rounded bg-[var(--shop-surface-raised)] px-2 py-1 text-[10px] font-bold text-white"><RotateCcw className="h-3 w-3" />再試行</button></div>}
    {index === 0 && item.ref.status === 'ready' && <span className="absolute bottom-1.5 left-1.5 z-20 rounded bg-[var(--shop-blue)] px-1.5 py-1 text-[9px] font-black text-[#06202e]">表紙</span>}
    <div className="absolute right-1 top-1 z-20 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"><button type="button" onClick={() => onDelete(item.ref.id)} aria-label={`${index + 1}枚目の写真を削除`} className="rounded-full bg-black/75 p-1.5 text-white hover:bg-red-500"><Trash2 className="h-3.5 w-3.5" /></button></div>
    <div className="absolute inset-x-1 bottom-1 z-20 flex items-center justify-between gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
      {item.ref.status === 'ready' ? <button type="button" onClick={() => onSetCover(item.ref.id)} disabled={index === 0} className="rounded bg-black/75 px-1.5 py-1 text-[9px] font-bold text-white disabled:opacity-40">表紙にする</button> : <span />}
      <button type="button" disabled={item.ref.status !== 'ready'} onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(item.ref.id, -1); } if (event.key === 'ArrowRight') { event.preventDefault(); onMove(item.ref.id, 1); } }} aria-label={`${index + 1}枚目。左右キーで並べ替え`} title="左右キーで並べ替え" className="rounded bg-black/75 p-1 text-white disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-[var(--shop-blue)]"><GripVertical className="h-3 w-3" /></button>
    </div>
  </div>
);

interface InfoStepProps { form: DraftFormData; aiSuggestions: AiSuggestions; onApplyAiSuggestion: (field: AiField) => void; onChange: (patch: Partial<DraftFormData>) => void; onTemplate: () => void }
const InfoStep: React.FC<InfoStepProps> = ({ form, aiSuggestions, onApplyAiSuggestion, onChange, onTemplate }) => <section className="space-y-5"><div><p className="text-xs font-bold text-[var(--shop-blue)]">STEP 2</p><h2 className="mt-1 text-xl font-black text-white">商品情報を入力</h2><p className="mt-1 text-sm leading-6 text-[var(--shop-muted)]">AI候補はそのまま公開されません。必ず内容を確認・修正してください。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={onTemplate} className="inline-flex items-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white hover:border-[var(--shop-blue)]"><Barcode className="h-4 w-4 text-[var(--shop-blue)]" />テンプレートから入力</button>{aiSuggestions.title && <button type="button" onClick={() => onApplyAiSuggestion('title')} disabled={Boolean(form.title)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--shop-border)] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"><Lightbulb className="h-4 w-4 text-yellow-300" />商品名候補を採用</button>}</div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><div className="grid gap-4"><FormField id="listing-title" label="商品名" hint={`${form.title.length} / 40`}><input id="listing-title" required maxLength={40} value={form.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="商品名を入力してください" data-testid="listing-title-input" /></FormField><FormField id="listing-description" label="商品の説明" hint={`${form.description.length} / 1000`}><textarea id="listing-description" rows={9} maxLength={1000} value={form.description} onChange={(event) => onChange({ description: event.target.value })} placeholder="商品の状態や特徴、付属品を入力してください" data-testid="listing-description-input" /></FormField></div></div></section>;

interface DetailsStepProps { form: DraftFormData; availableVariants: typeof CATALOG_VARIANTS; selectedVariant: typeof CATALOG_VARIANTS[number] | undefined; onChange: (patch: Partial<DraftFormData>) => void }
const DetailsStep: React.FC<DetailsStepProps> = ({ form, availableVariants, selectedVariant, onChange }) => <section className="space-y-5"><div><p className="text-xs font-bold text-[var(--shop-blue)]">STEP 3</p><h2 className="mt-1 text-xl font-black text-white">条件・配送・価格</h2><p className="mt-1 text-sm leading-6 text-[var(--shop-muted)]">購入者が判断しやすい属性と配送条件を設定します。</p></div><section className="space-y-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-category" label="カテゴリー"><select id="listing-category" required value={form.category} onChange={(event) => onChange({ category: event.target.value, subcategory: '', familyId: '', variantId: '' })}><option value="">カテゴリーを選択</option><option>レディース</option><option>メンズ</option><option>家電・スマホ</option><option>本・マンガ</option><option>ゲーム・おもちゃ</option><option>ホビー</option></select></FormField><FormField id="listing-subcategory" label="サブカテゴリー"><select id="listing-subcategory" required value={form.subcategory} onChange={(event) => onChange({ subcategory: event.target.value })}><option value="">サブカテゴリーを選択</option><option>トップス</option><option>ボトムス</option><option>バッグ</option><option>シューズ</option><option>スマートフォン</option><option>本</option><option>ゲーム</option></select></FormField><FormField id="listing-condition" label="商品の状態"><select id="listing-condition" required value={form.condition} onChange={(event) => onChange({ condition: event.target.value })}><option value="">商品の状態を選択</option><option>新品・未使用</option><option>未使用に近い</option><option>目立った傷や汚れなし</option><option>やや傷や汚れあり</option><option>傷や汚れあり</option><option>全体的に状態が悪い</option></select></FormField><FormField id="listing-brand" label="ブランド" hint="任意"><input id="listing-brand" value={form.brand} onChange={(event) => onChange({ brand: event.target.value })} placeholder="例：Apple" /></FormField><FormField id="listing-color" label="色" hint="任意"><input id="listing-color" value={form.color} onChange={(event) => onChange({ color: event.target.value })} placeholder="例：ブラック" /></FormField><FormField id="listing-size" label="サイズ" hint="任意"><input id="listing-size" value={form.size} onChange={(event) => onChange({ size: event.target.value })} placeholder="例：M" /></FormField><FormField id="listing-model-number" label="型番・SKU" hint="任意"><input id="listing-model-number" value={form.modelNumber} onChange={(event) => onChange({ modelNumber: event.target.value })} placeholder="例：ABC-123" /></FormField></div></section><section className="space-y-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><div><h3 className="text-sm font-black text-white">商品ファミリー・バリエーション・在庫</h3><p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">検索で見つけやすく、購入時に在庫を正しく減らすための登録項目です。</p></div><div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-family" label="商品ファミリー" hint="任意"><select id="listing-family" value={form.familyId} onChange={(event) => onChange({ familyId: event.target.value, variantId: '' })}><option value="">未設定（自由入力）</option>{CATALOG_FAMILIES.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></FormField><FormField id="listing-variant" label="バリエーション" hint="任意"><select id="listing-variant" value={form.variantId} disabled={!form.familyId} onChange={(event) => onChange({ variantId: event.target.value })}><option value="">未設定</option>{availableVariants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}</select></FormField></div>{selectedVariant && <div className="flex flex-wrap gap-2 rounded-lg bg-[var(--shop-bg)] p-3 text-xs text-[var(--shop-muted)]">{Object.entries(selectedVariant.attributes).map(([key, value]) => <span key={key} className="rounded-full bg-[var(--shop-surface-raised)] px-2.5 py-1"><strong className="text-white">{key}:</strong> {value}</span>)}</div>}<div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-inventory-policy" label="在庫ポリシー"><select id="listing-inventory-policy" value={form.inventoryPolicy} onChange={(event) => onChange({ inventoryPolicy: event.target.value as 'SINGLE' | 'MULTI' })}><option value="SINGLE">一点在庫（購入でSOLD）</option><option value="MULTI">複数在庫（数量を減算）</option></select></FormField>{form.inventoryPolicy === 'MULTI' ? <FormField id="listing-inventory-quantity" label="初期在庫数" hint="1以上"><input id="listing-inventory-quantity" type="number" min={1} step={1} value={form.inventoryQuantity} onChange={(event) => onChange({ inventoryQuantity: event.target.value })} /></FormField> : <div className="flex items-end rounded-lg border border-dashed border-[var(--shop-border)] px-3.5 py-3.5 text-xs text-[var(--shop-muted)]">購入できる在庫は1点です。</div>}</div></section><section className="space-y-4 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><div className="flex items-center gap-2"><Truck className="h-4 w-4 text-[var(--shop-blue)]" /><h3 className="text-sm font-black text-white">配送設定</h3><span className="ml-auto text-[10px] text-[var(--shop-muted)]">購入者に公開されます</span></div><div className="grid gap-4 sm:grid-cols-2"><FormField id="listing-shipping-fee" label="送料の負担"><select id="listing-shipping-fee" value={form.shippingFee} onChange={(event) => onChange({ shippingFee: event.target.value })}><option>送料込み（出品者負担）</option><option>着払い（購入者負担）</option></select></FormField><FormField id="listing-shipping-method" label="配送方法"><select id="listing-shipping-method" value={form.shippingMethod} onChange={(event) => onChange({ shippingMethod: event.target.value })}><option>ゆうゆう配送</option><option>らくらく配送</option><option>普通郵便</option></select></FormField><FormField id="listing-origin" label="発送元の地域"><select id="listing-origin" value={form.origin} onChange={(event) => onChange({ origin: event.target.value })}><option>東京都</option><option>大阪府</option><option>神奈川県</option><option>愛知県</option><option>福岡県</option></select></FormField><FormField id="listing-shipping-days" label="発送までの日数"><select id="listing-shipping-days" value={form.shippingDays} onChange={(event) => onChange({ shippingDays: event.target.value })}><option>1〜2日で発送</option><option>2〜3日で発送</option><option>4〜7日で発送</option></select></FormField><FormField id="listing-shipping-size" label="荷物サイズ"><select id="listing-shipping-size" value={form.shippingSize} onChange={(event) => onChange({ shippingSize: event.target.value })}><option>60サイズ</option><option>80サイズ</option><option>100サイズ</option><option>未定</option></select></FormField></div><label className="flex cursor-pointer items-center gap-2 text-xs text-white"><input type="checkbox" checked={form.isAnonymousShipping} onChange={(event) => onChange({ isAnonymousShipping: event.target.checked })} className="h-4 w-4 accent-[var(--shop-blue)]" />匿名配送として表示する</label></section><section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4 md:p-5"><FormField id="listing-price" label="販売価格" hint="300〜9,999,999円"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[var(--shop-muted)]">¥</span><input id="listing-price" required min={MIN_LISTING_PRICE} max={MAX_LISTING_PRICE} type="number" value={form.price} onChange={(event) => onChange({ price: event.target.value })} placeholder="300" className="w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] py-3.5 pl-8 pr-3 text-right text-lg font-black text-white outline-none focus:border-[var(--shop-blue)]" data-testid="listing-price-input" /></div></FormField></section></section>;

const FormField: React.FC<{ id: string; label: string; hint?: string; children: React.ReactNode }> = ({ id, label, hint, children }) => <div className="space-y-1.5"><div className="flex items-center justify-between"><label htmlFor={id} className="text-sm font-bold text-white">{label}</label>{hint && <span className="text-xs text-[var(--shop-muted)]">{hint}</span>}</div>{React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<{ className?: string }>, { className: 'w-full rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3.5 py-3.5 text-sm text-white outline-none placeholder:text-[var(--shop-subtle)] focus:border-[var(--shop-blue)]' }) : children}</div>;

interface ListingReviewProps { title: string; price: number; description: string; category: string; condition: string; imagePreview: string | null; imageCount: number; shippingFee: string; shippingMethod: string; shippingDays: string; sellerFee: number; expectedProceeds: number; policySignals: PolicySignal[]; hasPolicyAccepted: boolean; onPolicyChange: (value: boolean) => void }
const ListingReview: React.FC<ListingReviewProps> = ({ title, price, description, category, condition, imagePreview, imageCount, shippingFee, shippingMethod, shippingDays, sellerFee, expectedProceeds, policySignals, hasPolicyAccepted, onPolicyChange }) => <section className="space-y-5"><div><p className="text-xs font-bold text-[var(--shop-blue)]">STEP 4</p><h2 className="mt-1 text-xl font-black text-white">公開前に確認</h2><p className="mt-1 text-sm leading-6 text-[var(--shop-muted)]">禁止物・個人情報・説明不足を確認し、内容に同意して公開します。</p></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-start gap-3"><div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--shop-surface-raised)]">{imagePreview ? <img src={imagePreview} alt="出品プレビュー" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-[var(--shop-subtle)]" />}</div><div className="min-w-0"><p className="text-[10px] font-bold text-[var(--shop-muted)]">公開プレビュー ・ 画像{imageCount}枚</p><h3 className="mt-1 line-clamp-2 text-base font-black text-white">{title || '商品名未入力'}</h3><p className="mt-1 text-lg font-black text-[var(--shop-accent)]">¥{price > 0 ? price.toLocaleString() : '---'}</p><p className="mt-1 text-xs text-[var(--shop-muted)]">{category || 'カテゴリー未選択'} ・ {condition || '状態未選択'}</p></div></div><p className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--shop-bg)] p-3 text-xs leading-5 text-[var(--shop-muted)]">{description || '説明は未入力です'}</p><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white"><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingFee}</span><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingMethod}</span><span className="rounded-full bg-[var(--shop-surface-raised)] px-2 py-1">{shippingDays}</span></div></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><h3 className="text-sm font-black text-white">売上見込み</h3><div className="mt-3 space-y-2 text-xs"><div className="flex justify-between text-[var(--shop-muted)]"><span>販売価格</span><span className="text-white">¥{price.toLocaleString()}</span></div><div className="flex justify-between text-[var(--shop-muted)]"><span>販売手数料（デモ10%）</span><span className="text-white">-¥{sellerFee.toLocaleString()}</span></div><div className="flex justify-between border-t border-[var(--shop-border)] pt-2 text-sm font-black text-white"><span>売上金の見込み</span><span className="text-[var(--shop-success)]">¥{expectedProceeds.toLocaleString()}</span></div></div></div><div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-white">公開前の安全チェック</h3><span className="text-[10px] text-[var(--shop-muted)]">自動チェック</span></div><div className="mt-3 space-y-2">{policySignals.map((signal) => <div key={signal.label} className="flex items-start gap-2 rounded-lg bg-[var(--shop-surface-raised)] p-2.5 text-xs"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${signal.status === 'pass' ? 'bg-emerald-400/20 text-emerald-300' : signal.status === 'blocked' ? 'bg-red-400/20 text-red-300' : 'bg-yellow-400/20 text-yellow-200'}`}>{signal.status === 'pass' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}</span><span><strong className="block text-white">{signal.label}</strong><span className="mt-0.5 block leading-4 text-[var(--shop-muted)]">{signal.detail}</span></span></div>)}</div><label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-[var(--shop-border)] pt-4 text-xs text-white"><input id="listing-policy" aria-label="出品ポリシーを確認しました" type="checkbox" checked={hasPolicyAccepted} onChange={(event) => onPolicyChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--shop-accent)]" /><span><strong>出品ポリシーを確認しました</strong><span className="mt-1 block leading-5 text-[var(--shop-muted)]">禁止出品物・著作権・個人情報・説明責任を確認し、デモ出品に同意します。</span></span></label></div></section>;

const ListingHome: React.FC<{ isDeviceFrame: boolean; drafts: PersistedListingDraft[]; notice: string | null; isDraftsOpen: boolean; onStart: () => void; onOpenDrafts: () => void; onCloseDrafts: () => void; onResume: (draft: PersistedListingDraft) => void; onDelete: (draft: PersistedListingDraft) => void; onDuplicate: (draft: PersistedListingDraft) => void }> = ({ isDeviceFrame, drafts, notice, isDraftsOpen, onStart, onOpenDrafts, onCloseDrafts, onResume, onDelete, onDuplicate }) => <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="listing-view" data-scroll-owner="active"><div className="mx-auto max-w-[1080px] px-4 pb-24 md:px-7"><div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">出品ホーム</h1><p className="mt-1 text-xs text-[var(--shop-muted)]">写真を追加して、4ステップで安全に出品できます。</p></div><div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[1fr_310px]'}`}><section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 md:p-7"><div className="flex items-start gap-4"><div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#183b4c] text-[var(--shop-blue)]"><Camera className="h-7 w-7" /></div><div><h2 className="text-base font-black text-white">商品の写真から始める</h2><p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">カメラで撮影するか、端末のアルバムから最大20枚を選択できます。</p></div></div><button type="button" onClick={onStart} className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--shop-accent)] py-3.5 text-sm font-black text-white hover:bg-[var(--shop-accent-strong)]" data-testid="open-listing-flow"><Plus className="h-5 w-5" />出品をはじめる</button><div className="mt-5 grid gap-3 sm:grid-cols-3"><HomeFeature icon={<Camera className="h-4 w-4" />} title="撮影・アルバム" body="2つの入力経路" /><HomeFeature icon={<ImagePlus className="h-4 w-4" />} title="最大20枚" body="並べ替え・表紙指定" /><HomeFeature icon={<ShieldCheck className="h-4 w-4" />} title="公開前確認" body="禁止物・個人情報" /></div></section><section className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-black text-white">下書き</h2><p className="mt-1 text-xs text-[var(--shop-muted)]">{drafts.length}件保存中</p></div><FileText className="h-5 w-5 text-[var(--shop-blue)]" /></div>{drafts.length ? <div className="mt-4 space-y-2">{drafts.slice(0, 3).map((draft) => <DraftRow key={`${draft.draftId ?? draft.name}-${draft.updatedAt}`} draft={draft} onResume={() => onResume(draft)} onDelete={() => onDelete(draft)} onDuplicate={() => onDuplicate(draft)} />)}</div> : <p className="mt-4 rounded-lg border border-dashed border-[var(--shop-border)] p-5 text-center text-xs text-[var(--shop-muted)]">保存された下書きはありません</p>}{drafts.length > 3 && <button type="button" onClick={onOpenDrafts} className="mt-4 w-full rounded-lg border border-[var(--shop-border)] py-2.5 text-xs font-bold text-white">すべての下書きを見る</button>}</section></div>{notice && <p className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[var(--shop-surface-raised)] px-4 py-2 text-xs font-bold text-white shadow-xl" role="status">{notice}</p>}</div>{isDraftsOpen && <DraftListOverlay drafts={drafts} onClose={onCloseDrafts} onResume={onResume} onDelete={onDelete} onDuplicate={onDuplicate} />}</div>;

const HomeFeature: React.FC<{ icon: React.ReactNode; title: string; body: string }> = ({ icon, title, body }) => <div className="rounded-lg bg-[var(--shop-bg)] p-3"><span className="text-[var(--shop-blue)]">{icon}</span><p className="mt-2 text-xs font-bold text-white">{title}</p><p className="mt-1 text-[10px] text-[var(--shop-muted)]">{body}</p></div>;
const DraftRow: React.FC<{ draft: PersistedListingDraft; onResume: () => void; onDelete: () => void; onDuplicate: () => void }> = ({ draft, onResume, onDelete, onDuplicate }) => <div className="rounded-lg border border-[var(--shop-border)] bg-[var(--shop-bg)] p-3"><button type="button" onClick={onResume} className="flex w-full items-start gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--shop-surface-raised)] text-[var(--shop-blue)]"><FileText className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-white">{draft.name}</span><span className="mt-1 block text-[10px] text-[var(--shop-muted)]">画像{draft.media.length}枚 ・ {formatDraftDate(draft.updatedAt)}</span></span><ChevronRight className="h-4 w-4 text-[var(--shop-subtle)]" /></button><div className="mt-2 flex justify-end gap-1"><button type="button" onClick={onDuplicate} aria-label={`${draft.name}を複製`} className="rounded p-1.5 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)] hover:text-white"><Copy className="h-3.5 w-3.5" /></button><button type="button" onClick={onDelete} aria-label={`${draft.name}を削除`} className="rounded p-1.5 text-[var(--shop-muted)] hover:bg-red-400/20 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button></div></div>;
const DraftListOverlay: React.FC<{ drafts: PersistedListingDraft[]; onClose: () => void; onResume: (draft: PersistedListingDraft) => void; onDelete: (draft: PersistedListingDraft) => void; onDuplicate: (draft: PersistedListingDraft) => void }> = ({ drafts, onClose, onResume, onDelete, onDuplicate }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, true, onClose);
  return <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="下書き一覧"><div ref={dialogRef} className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">下書き一覧</h2><button type="button" onClick={onClose} aria-label="下書き一覧を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">{drafts.map((draft) => <DraftRow key={`${draft.draftId ?? draft.name}-${draft.updatedAt}`} draft={draft} onResume={() => onResume(draft)} onDelete={() => onDelete(draft)} onDuplicate={() => onDuplicate(draft)} />)}</div><button type="button" onClick={onClose} className="mt-5 w-full rounded-lg border border-[var(--shop-border)] py-3 text-sm font-bold text-white">閉じる</button></div></div>;
};
const TemplateOverlay: React.FC<{ onSelect: (template: TemplateName) => void; onClose: () => void }> = ({ onSelect, onClose }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(dialogRef, true, onClose);
  const templates: [TemplateName, string, string][] = [['fashion', 'ファッション', '衣類・バッグ・靴の基本項目を入力'], ['book', '本・マンガ', '本の状態と発送説明を入力'], ['device', '家電・スマホ', '動作確認・付属品の説明を入力']];
  return <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="テンプレートを選ぶ"><div ref={dialogRef} className="w-full max-w-lg rounded-2xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-base font-black text-white">テンプレートから入力</h2><button type="button" onClick={onClose} aria-label="テンプレートを閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><p className="mt-2 text-xs text-[var(--shop-muted)]">候補を入れたあと、内容を自由に修正できます。</p><div className="mt-5 space-y-2">{templates.map(([value, title, body]) => <button type="button" key={value} onClick={() => onSelect(value)} className="flex w-full items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface-raised)] p-3 text-left hover:border-[var(--shop-blue)]"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--shop-bg)] text-[var(--shop-blue)]"><Pencil className="h-5 w-5" /></span><span><span className="block text-sm font-bold text-white">{title}</span><span className="mt-1 block text-xs text-[var(--shop-muted)]">{body}</span></span><ChevronRight className="ml-auto h-4 w-4 text-[var(--shop-subtle)]" /></button>)}</div></div></div>;
};
