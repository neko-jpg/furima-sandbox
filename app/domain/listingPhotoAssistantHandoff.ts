import type { GarmentMeasurements, ListingMediaRef, MercariItem } from '../types/mercari';

/** The only assistant image slots that may become listing images. */
export const LISTING_PHOTO_ASSISTANT_SHOT_SLOTS = ['front', 'back', 'tag'] as const;
export type ListingPhotoAssistantShotSlot = (typeof LISTING_PHOTO_ASSISTANT_SHOT_SLOTS)[number];

export interface ListingPhotoAssistantApprovedImages {
  front: ListingMediaRef;
  back: ListingMediaRef;
  tag: ListingMediaRef;
}

/**
 * Explicit boundary from a transient capture session to an existing draft.
 * The literal `true` makes the caller acknowledge the user action at the
 * type level; the runtime check below protects the JavaScript boundary too.
 */
export interface ListingPhotoAssistantHandoffInput {
  proceedToListing: true;
  approvedImages: ListingPhotoAssistantApprovedImages;
  garmentMeasurements: GarmentMeasurements;
}

/** Only these fields are allowed to enter the listing domain from capture. */
export interface ListingPhotoAssistantDraftPatch {
  imageRefs: string[];
  garmentMeasurements: GarmentMeasurements;
}

export type ListingPhotoAssistantHandoffErrorCode =
  | 'NOT_EXPLICITLY_APPROVED'
  | 'INVALID_APPROVED_IMAGE'
  | 'DUPLICATE_APPROVED_IMAGE'
  | 'INVALID_MEASUREMENTS'
  | 'IMAGE_LIMIT_EXCEEDED';

export type ListingPhotoAssistantDraftPatchResult =
  | { ok: true; patch: ListingPhotoAssistantDraftPatch }
  | { ok: false; code: ListingPhotoAssistantHandoffErrorCode; message: string };

const LOCAL_MEDIA_REF_PATTERN = /^media_[A-Za-z0-9_-]+$/u;
const MAX_LISTING_IMAGES = 20;
const LENGTH_CM_RANGE = { min: 20, max: 100 } as const;
const WIDTH_CM_RANGE = { min: 20, max: 80 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const failure = (
  code: ListingPhotoAssistantHandoffErrorCode,
  message: string,
): ListingPhotoAssistantDraftPatchResult => ({ ok: false, code, message });

const isLocalMediaRef = (value: unknown): value is string => (
  typeof value === 'string' && LOCAL_MEDIA_REF_PATTERN.test(value)
);

const readApprovedImageId = (
  images: Record<string, unknown>,
  slot: ListingPhotoAssistantShotSlot,
): string | ListingPhotoAssistantDraftPatchResult => {
  const image = images[slot];
  if (!isRecord(image) || image.status !== 'ready' || !isLocalMediaRef(image.id)) {
    return failure('INVALID_APPROVED_IMAGE', `${slot}画像はready状態のローカルmedia参照である必要があります。`);
  }
  return image.id;
};

const readGarmentMeasurements = (value: unknown): GarmentMeasurements | ListingPhotoAssistantDraftPatchResult => {
  if (!isRecord(value)) return failure('INVALID_MEASUREMENTS', '承認済み採寸値が指定されていません。');
  const { lengthCm, widthCm, source } = value;
  if (
    typeof lengthCm !== 'number' || !Number.isFinite(lengthCm)
    || lengthCm < LENGTH_CM_RANGE.min || lengthCm > LENGTH_CM_RANGE.max
    || typeof widthCm !== 'number' || !Number.isFinite(widthCm)
    || widthCm < WIDTH_CM_RANGE.min || widthCm > WIDTH_CM_RANGE.max
    || (source !== 'approved_cv' && source !== 'approved_manual')
  ) {
    return failure('INVALID_MEASUREMENTS', '採寸値は有効な範囲のlengthCm、widthCmと承認済みsourceが必要です。');
  }
  return { lengthCm, widthCm, source };
};

/**
 * Projects transient assistant output into a draft-safe patch.
 * It deliberately accepts an existing draft only to preserve its valid
 * imageRefs; no capture object, blob, endpoint, scale, event, or background
 * field is copied or returned.
 */
export const createListingPhotoAssistantDraftPatch = (
  input: ListingPhotoAssistantHandoffInput,
  existingDraft?: Pick<Partial<MercariItem>, 'imageRefs'> | null,
): ListingPhotoAssistantDraftPatchResult => {
  if (!isRecord(input) || input.proceedToListing !== true) {
    return failure('NOT_EXPLICITLY_APPROVED', '利用者が出品へ進むことを明示的に承認していません。');
  }
  if (!isRecord(input.approvedImages)) {
    return failure('INVALID_APPROVED_IMAGE', 'front、back、tagの承認済み画像が必要です。');
  }

  const approvedIds: string[] = [];
  for (const slot of LISTING_PHOTO_ASSISTANT_SHOT_SLOTS) {
    const result = readApprovedImageId(input.approvedImages, slot);
    if (typeof result !== 'string') return result;
    if (approvedIds.includes(result)) return failure('DUPLICATE_APPROVED_IMAGE', 'front、back、tagには別々の画像が必要です。');
    approvedIds.push(result);
  }

  const measurements = readGarmentMeasurements(input.garmentMeasurements);
  if ('ok' in measurements) return measurements;

  const existingRefs = Array.isArray(existingDraft?.imageRefs)
    ? existingDraft.imageRefs.filter(isLocalMediaRef)
    : [];
  const imageRefs = [...existingRefs];
  approvedIds.forEach((id) => {
    if (!imageRefs.includes(id)) imageRefs.push(id);
  });
  if (imageRefs.length > MAX_LISTING_IMAGES) {
    return failure('IMAGE_LIMIT_EXCEEDED', `出品画像は${MAX_LISTING_IMAGES}枚以内にしてください。`);
  }

  return {
    ok: true,
    patch: {
      imageRefs,
      garmentMeasurements: { ...measurements },
    },
  };
};

/** Backward-compatible descriptive alias for callers that prefer “build”. */
export const buildListingPhotoAssistantDraftPatch = createListingPhotoAssistantDraftPatch;
