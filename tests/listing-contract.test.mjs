import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createListingPhotoAssistantDraftPatch } from '../app/domain/listingPhotoAssistantHandoff.ts';
import { createListingHandoff } from '../app/features/guided-capture/ui/contracts.ts';
import { MeasurementPointSuggestionSchema } from '../app/types/measurement.ts';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('listing flow exposes both photo inputs and the 20-image contract', async () => {
  const source = await read('app/components/views/ListingView.tsx');
  assert.match(source, /id="listing-camera" type="file" accept="image\/\*" capture="environment"/);
  assert.match(source, /id="listing-images" type="file" accept="image\/\*" multiple/);
  assert.match(source, /MAX_LISTING_IMAGES = 20/);
  assert.match(source, /aria-posinset/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /onDragStart/);
  assert.doesNotMatch(source, /<Footer\s*\/>/);
  assert.match(source, /hasDraftContent/);
  assert.match(source, /権限が反映されるまで/);
  assert.match(source, /imageRefs/);
  assert.match(source, /imageOrder/);
  assert.match(source, /getUserMedia/);
  assert.match(source, /MediaStreamTrack/);
  assert.match(source, /captureCameraFrame/);
  assert.match(source, /fixed.*inset-0/);
  assert.match(source, /handleGuidedStreamReady/);
  assert.match(source, /publishCameraStream: handleGuidedStreamReady/);
  assert.match(source, /stopGuidedCaptureSession/);
  assert.match(source, /guidedCameraStreamRef/);
  assert.match(source, /readyState !== 'ended'/);
  assert.match(source, /transient connection race/);
});

test('mobile home tabs and sandbox account contracts are shared and documented', async () => {
  const tabs = await read('app/components/homeTabs.ts');
  const types = await read('app/types/mercari.ts');
  const context = await read('app/context/MercariContext.tsx');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(tabs, /recommend.*おすすめ/s);
  assert.match(tabs, /mylist.*マイリスト/s);
  assert.match(tabs, /auction.*オークション/s);
  assert.match(types, /DEPOSIT.*WITHDRAWAL.*HOLD/s);
  assert.match(context, /depositWallet/);
  assert.match(context, /updateProfile/);
  assert.match(myPage, /利用可能/);
  assert.match(myPage, /プロフィール編集/);
});

test('desktop account menu routes to user destinations without changing the trusted actor', async () => {
  const header = await read('app/components/Header.tsx');
  const context = await read('app/context/MercariContext.tsx');
  const types = await read('app/types/mercari.ts');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(header, /data-testid="account-menu-trigger"/);
  assert.match(header, /role="menu"/);
  assert.match(header, /マイページ/);
  assert.match(header, /プロフィール/);
  assert.match(header, /フォローリスト/);
  assert.match(header, /購入した商品/);
  assert.match(header, /actorは信頼済みハーネスで固定/);
  assert.doesNotMatch(header, /switchActor\(/);
  assert.match(context, /openMyPagePanel/);
  assert.match(context, /myPagePanel/);
  assert.match(types, /export type MyPagePanel/);
  assert.match(myPage, /setMyPagePanel/);
});

test('listing domain enforces official price and condition bounds', async () => {
  const source = await read('app/domain/sandboxEngine.ts');
  assert.match(source, /MAX_LISTING_PRICE = 9_999_999/);
  assert.match(source, /全体的に状態が悪い/);
  assert.match(source, /imageReferenceError/);
});

test('listing photo assistant handoff keeps only approved media refs and measurements', () => {
  const result = createListingPhotoAssistantDraftPatch({
    proceedToListing: true,
    approvedImages: {
      front: { id: 'media_front', status: 'ready', measurementImage: 'media_measurement' },
      back: { id: 'media_back', status: 'ready', points: { x: 0.5, y: 0.5 } },
      tag: { id: 'media_tag', status: 'ready', scale: 12 },
    },
    garmentMeasurements: { lengthCm: 70.5, widthCm: 52, source: 'approved_cv' },
    guidanceEvent: { sessionId: 'transient', sequence: 4 },
    background: { status: 'unapproved', image: 'data:image/png;base64,secret' },
  }, { imageRefs: ['media_existing'] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.patch.imageRefs, ['media_existing', 'media_front', 'media_back', 'media_tag']);
  assert.deepEqual(result.patch.garmentMeasurements, { lengthCm: 70.5, widthCm: 52, source: 'approved_cv' });
  assert.deepEqual(Object.keys(result.patch).sort(), ['garmentMeasurements', 'imageRefs']);
  assert.equal('measurementImage' in result.patch, false);
  assert.equal('points' in result.patch, false);
  assert.equal('scale' in result.patch, false);
  assert.equal('guidanceEvent' in result.patch, false);
  assert.equal('background' in result.patch, false);
});

test('listing photo assistant handoff requires explicit progression and ready unique images', () => {
  const base = {
    approvedImages: {
      front: { id: 'media_front', status: 'ready' },
      back: { id: 'media_back', status: 'ready' },
      tag: { id: 'media_tag', status: 'ready' },
    },
    garmentMeasurements: { lengthCm: 70, widthCm: 50, source: 'approved_manual' },
  };
  const notApproved = createListingPhotoAssistantDraftPatch({ ...base, proceedToListing: false });
  assert.equal(notApproved.ok, false);
  if (!notApproved.ok) assert.equal(notApproved.code, 'NOT_EXPLICITLY_APPROVED');

  const notReady = createListingPhotoAssistantDraftPatch({
    ...base,
    proceedToListing: true,
    approvedImages: { ...base.approvedImages, back: { id: 'media_back', status: 'processing' } },
  });
  assert.equal(notReady.ok, false);
  if (!notReady.ok) assert.equal(notReady.code, 'INVALID_APPROVED_IMAGE');

  const duplicate = createListingPhotoAssistantDraftPatch({
    ...base,
    proceedToListing: true,
    approvedImages: { ...base.approvedImages, tag: { id: 'media_front', status: 'ready' } },
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, 'DUPLICATE_APPROVED_IMAGE');

  const invalidMeasurement = createListingPhotoAssistantDraftPatch({
    ...base,
    proceedToListing: true,
    garmentMeasurements: { lengthCm: 0, widthCm: 50, source: 'approved_manual' },
  });
  assert.equal(invalidMeasurement.ok, false);
  if (!invalidMeasurement.ok) assert.equal(invalidMeasurement.code, 'INVALID_MEASUREMENTS');
});

test('guided browser handoff exports only explicitly reviewed local media ids', () => {
  const handoff = createListingHandoff({
    sessionId: 'transient-session',
    slots: {
      front: { slot: 'front', status: 'captured', mediaId: 'media_front', previewUrl: 'blob:front', source: 'camera' },
      back: { slot: 'back', status: 'approved', mediaId: 'media_back', previewUrl: 'blob:back', source: 'album' },
      tag: { slot: 'tag', status: 'approved', mediaId: 'media_tag', previewUrl: 'blob:tag', source: 'album' },
      measurement: { slot: 'measurement', status: 'approved', mediaId: 'media_measurement', previewUrl: 'blob:measurement', source: 'camera' },
    },
    measurement: { lengthCm: 70, widthCm: 50, source: 'approved_manual' },
    background: { status: 'approved', previewUrl: 'data:image/png;base64,transient' },
  });

  assert.deepEqual(handoff.images, [
    { slot: 'back', mediaId: 'media_back' },
    { slot: 'tag', mediaId: 'media_tag' },
  ]);
  assert.deepEqual(handoff.garmentMeasurements, { lengthCm: 70, widthCm: 50, source: 'approved_manual' });
  assert.equal(handoff.images.some(({ mediaId }) => mediaId === 'media_measurement'), false);
  assert.equal('sessionId' in handoff, false);
  assert.equal('approvedBackground' in handoff, false);
  assert.equal(JSON.stringify(handoff).includes('blob:'), false);
  assert.equal(JSON.stringify(handoff).includes('data:image/'), false);
});

test('measurement point wire contract accepts four endpoints without confidence', () => {
  const endpoints = {
    lengthStart: { x: 0.5, y: 0.1 },
    lengthEnd: { x: 0.5, y: 0.9 },
    widthStart: { x: 0.2, y: 0.5 },
    widthEnd: { x: 0.8, y: 0.5 },
  };
  assert.deepEqual(MeasurementPointSuggestionSchema.parse(endpoints), endpoints);
  assert.equal(MeasurementPointSuggestionSchema.safeParse({ ...endpoints, confidence: 0.9 }).success, false);
});

test('context exposes the guarded listing photo assistant handoff', async () => {
  const context = await read('app/context/MercariContext.tsx');
  const types = await read('app/types/mercari.ts');
  assert.match(context, /handoffListingPhotoAssistant/);
  assert.match(context, /createListingPhotoAssistantDraftPatch/);
  assert.match(types, /garmentMeasurements\?: GarmentMeasurements/);
  assert.match(types, /approved_cv.*approved_manual/);
});

test('API source of truth and docs checks are wired', async () => {
  const workflow = await read('.github/workflows/verify.yml');
  const packageJson = JSON.parse(await read('package.json'));
  const catalogItemRoute = await read('app/api/catalog/[itemId]/route.ts');
  assert.match(workflow, /npm run docs:check/);
  assert.equal(packageJson.scripts['docs:check'], 'node scripts/validate-api-docs.mjs');
  assert.match(catalogItemRoute, /ITEM_NOT_FOUND/);
  assert.match(catalogItemRoute, /If-None-Match|if-none-match/);
});

test('mobile navigation stays in the viewport and the agent bundle excludes control UI', async () => {
  const bottomNav = await read('app/components/BottomNav.tsx');
  const context = await read('app/context/MercariContext.tsx');
  const app = await read('app/components/MercariApp.tsx');
  const detail = await read('app/components/views/ItemDetailView.tsx');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(bottomNav, /fixed inset-x-0 bottom-0 md:hidden/);
  assert.match(bottomNav, /absolute inset-x-0 bottom-0/);
  assert.match(context, /history\.pushState/);
  assert.match(context, /ITEM_ROUTE_PREFIX/);
  assert.match(context, /window\.history\.back\(\)/);
  assert.match(app, /onClose=\{closeItem\}/);
  assert.doesNotMatch(app, /SandboxInspector/);
  assert.doesNotMatch(context, /runUiControlCommand/);
  assert.match(detail, /\$\{isDeviceFrame \? 'absolute' : 'fixed'\}/);
  assert.match(detail, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(myPage, /出品した商品/);
  assert.match(myPage, /売却済み/);
  assert.match(myPage, /下書き一覧/);
  assert.match(myPage, /furima-listing-open-draft-id/);
});
