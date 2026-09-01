import type { GuidedCapturePhase, SessionSlot, SlotProgress } from './contracts';

export const CAPTURE_SLOT_ORDER = ['front', 'back', 'tag', 'measurement'] as const satisfies readonly SessionSlot[];
export const IMAGE_CAPTURE_SLOT_ORDER = ['front', 'back', 'tag'] as const;

export const CAPTURE_SLOT_LABELS: Record<SessionSlot, string> = {
  front: '表面',
  back: '裏面',
  tag: 'タグ',
  measurement: '採寸',
};

export const CAPTURE_SLOT_DETAILS: Record<SessionSlot, string> = {
  front: '全体を正面から',
  back: '裏面をまっすぐ',
  tag: 'ブランド・洗濯表示',
  measurement: '採寸画像と数値',
};

export const CAPTURE_PHASE_LABELS: Record<GuidedCapturePhase, string> = {
  idle: '未開始',
  connecting: '準備中',
  capturing: '撮影中',
  measurement: '採寸確認',
  review: '最終確認',
  ready: '出品へ引き渡し可能',
  fallback: '固定ガイドで継続',
};

export const CAPTURE_CONNECTION_LABELS = {
  connecting: 'AI案内を準備中',
  connected: 'AI案内 接続済み',
  reconnecting: 'AI案内を再接続中',
  disconnected: 'オフライン・固定ガイド',
} as const;

export const getSlotStatusLabel = (progress: SlotProgress): string => {
  switch (progress.status) {
    case 'captured': return '撮影済み';
    case 'approved': return '承認済み';
    case 'active': return progress.mediaId ? '検証中' : '撮影待ち';
    default: return '未撮影';
  }
};

/**
 * Keep the progress rail honest: a future step is not selectable until the
 * preceding image slots have been accepted. Captured image slots remain
 * reachable for a deliberate retake; approved slots are intentionally locked.
 */
export const isCaptureSlotSelectable = (
  slots: Record<SessionSlot, SlotProgress>,
  slot: SessionSlot,
  isActive: boolean,
): boolean => {
  if (!isActive || slots[slot].status === 'approved') return false;
  if (slots[slot].status === 'captured') return true;
  if (slot === 'measurement') {
    return IMAGE_CAPTURE_SLOT_ORDER.every((candidate) => {
      const status = slots[candidate].status;
      return status === 'captured' || status === 'approved';
    });
  }
  const nextImageSlot = IMAGE_CAPTURE_SLOT_ORDER.find((candidate) => {
    const status = slots[candidate].status;
    return status === 'pending' || status === 'active';
  });
  return slot === nextImageSlot;
};
