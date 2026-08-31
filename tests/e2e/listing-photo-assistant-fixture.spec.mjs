import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { assertNoPageErrors, installPageGuards, resetSandbox } from './_sandbox.mjs';

const UI_ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const ASSISTANT_API_URL = process.env.VITE_LISTING_ASSISTANT_API_URL ?? '';
const DRAFT_KEY = 'furima-listing-drafts-v3:furima-demo:seller_01';

// Generate a small, valid PNG in memory instead of checking an image fixture
// into the repository. The bytes are used only during the test and are never
// attached to a report or written to disk.
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, payload) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 0);
  return Buffer.concat([length, typeBytes, payload, checksum]);
};

const makeFixturePng = () => {
  const width = 400;
  const height = 400;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const tile = (Math.floor(x / 20) + Math.floor(y / 20)) % 2;
      raw[offset] = tile ? 49 : 232;
      raw[offset + 1] = tile ? 87 : 245;
      raw[offset + 2] = tile ? 105 : 250;
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const fixturePng = makeFixturePng();

const upload = async (input, name) => {
  await input.setInputFiles({ name, mimeType: 'image/png', buffer: fixturePng });
};

const exerciseHttpFixtureBackend = async (page, runNumber) => page.evaluate(async ({ apiUrl, bytes, sessionId }) => {
  const health = await fetch(`${apiUrl}/api/health`, { headers: { accept: 'application/json' }, credentials: 'omit' });
  if (!health.ok) throw new Error(`fixture health returned HTTP ${health.status}`);
  const capture = await import('/app/features/guided-capture/ui/httpAdapter.ts');
  // Keep the browser receiver explicit while exercising the adapter contract.
  const browserFetch = (input, init) => globalThis.fetch(input, init);
  const adapter = capture.createHttpGuidedCaptureAdapter({ baseUrl: apiUrl, mode: 'fixture', fetchImpl: browserFetch });
  const image = () => new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
  const assess = (slot) => adapter.assessShot({ sessionId, slot, blob: image() });
  const connection = await adapter.connect(sessionId);
  const front = await assess('front');
  const retry = await assess('back');
  const correctedBack = await assess('back');
  const tag = await assess('tag');
  const measurement = await adapter.suggestMeasurement({ sessionId, blob: image() });
  await adapter.disconnect();

  const background = await import('/app/features/background-edit/provider.ts');
  const provider = new background.HttpBackgroundEditProvider({ baseUrl: apiUrl, fetchImpl: browserFetch });
  const mask = await provider.removeBackground(image());
  const generated = await provider.generateBackground('studio_white');
  return {
    connection,
    front,
    retry,
    correctedBack,
    tag,
    measurement: { endpoints: measurement.endpoints ?? null },
    mask: { type: mask.type, size: mask.size },
    generated: { type: generated.type, size: generated.size },
  };
}, { apiUrl: ASSISTANT_API_URL, bytes: [...fixturePng], sessionId: `fixture-http-${runNumber}` });

const readFinalEvidence = async (page) => {
  const draft = await page.evaluate((draftKey) => {
    const raw = window.localStorage.getItem(draftKey);
    if (!raw) throw new Error('deterministic fixture did not save a listing draft');
    const parsed = JSON.parse(raw);
    const candidate = Array.isArray(parsed) ? parsed.find((value) => Array.isArray(value?.media) && value.media.length === 3) : null;
    if (!candidate) throw new Error('saved draft does not contain exactly three listing images');
    const serialized = JSON.stringify(candidate);
    return {
      frontMediaId: candidate.media[0]?.id,
      normalizedState: {
        form: {
          title: candidate.form?.title ?? '',
          price: candidate.form?.price ?? '',
          description: candidate.form?.description ?? '',
          category: candidate.form?.category ?? '',
          subcategory: candidate.form?.subcategory ?? '',
          condition: candidate.form?.condition ?? '',
          shippingMethod: candidate.form?.shippingMethod ?? '',
          shippingFee: candidate.form?.shippingFee ?? '',
          shippingDays: candidate.form?.shippingDays ?? '',
        },
        media: candidate.media.map((media) => ({
          source: media.source,
          status: media.status,
          mimeType: media.mimeType,
          width: media.width ?? null,
          height: media.height ?? null,
          byteSize: media.byteSize,
        })),
        imageOrder: candidate.imageOrder.map((entry) => ({ order: entry.order, isCover: entry.isCover })),
      },
      hasTransientUrl: /(?:data:image\/|blob:)/u.test(serialized),
      hasMeasurementPayload: /(?:measurement|garmentMeasurements|lengthCm|widthCm)/iu.test(serialized),
    };
  }, DRAFT_KEY);

  if (typeof draft.frontMediaId !== 'string' || !draft.frontMediaId) throw new Error('saved front media id is missing');
  const output = await page.evaluate(async (mediaId) => {
    const record = await new Promise((resolve, reject) => {
      const request = indexedDB.open('furima-listing-media-v1');
      request.onerror = () => reject(request.error ?? new Error('media database open failed'));
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('media', 'readonly').objectStore('media').get(mediaId);
        read.onerror = () => { database.close(); reject(read.error ?? new Error('media record read failed')); };
        read.onsuccess = () => { database.close(); resolve(read.result ?? null); };
      };
    });
    if (!record?.blob || !(record.blob instanceof Blob)) throw new Error('saved front output is not a Blob record');
    const bytes = await record.blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    return { sha256: hash, mimeType: record.blob.type, byteSize: record.blob.size };
  }, draft.frontMediaId);

  return { ...draft, output };
};

const runFlow = async (page, runNumber) => {
  const errors = await installPageGuards(page);
  const requests = { assessments: 0, measurement: 0, mask: 0, background: 0, backgroundStyles: [] };
  let retryInjected = false;

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/suggest-measurement-points') requests.measurement += 1;
    if (pathname === '/api/remove-background') requests.mask += 1;
    if (pathname === '/api/generate-background') {
      requests.background += 1;
      try {
        const body = request.postDataJSON();
        if (body && typeof body === 'object' && 'styleId' in body) requests.backgroundStyles.push(body.styleId);
      } catch {
        // The request count is the evidence; never retain binary request data.
      }
    }
  });

  await page.route('**/api/analyze-shot', async (route) => {
    requests.assessments += 1;
    if (requests.assessments !== 2 || retryInjected) {
      await route.continue();
      return;
    }
    retryInjected = true;
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': UI_ORIGIN,
        'cache-control': 'no-store',
      },
      contentType: 'application/json',
      body: JSON.stringify({
        shotType: 'back',
        quality: 'retry',
        issues: ['GARMENT_CROPPED'],
        missingShots: ['back', 'tag'],
        nextAction: 'RETAKE',
      }),
    });
  });

  await page.goto('/');
  const backendEvidence = await exerciseHttpFixtureBackend(page, runNumber);
  await resetSandbox(page, `listing-photo-assistant-fixture-${runNumber}`);
  await page.getByRole('button', { name: '出品', exact: true }).last().click();
  await expect(page.getByTestId('listing-view')).toBeVisible();
  await page.getByTestId('open-listing-flow').click();
  await expect(page.getByTestId('listing-flow')).toBeVisible();

  await page.getByTestId('guided-capture-toggle').click();
  await expect(page.getByTestId('guided-capture-content')).toBeVisible();
  await page.getByTestId('guided-capture-start').click();
  await expect(page.getByTestId('guided-capture-connection')).toContainText('接続済み');
  await expect(page.getByTestId('guided-capture-transport')).toContainText('fixture接続');

  const listingImages = page.locator('#listing-images');
  const mediaList = page.locator('[role="list"][aria-label^="追加した写真"]');
  await upload(listingImages, 'front.png');
  await expect(page.getByTestId('guided-capture-slot-front')).toContainText('撮影済み');
  await expect(page.locator('[aria-label="追加した写真 1枚"]')).toBeVisible();

  await upload(listingImages, 'back-retry.png');
  await expect(page.getByTestId('guided-capture-slot-back')).toContainText('撮影済み');
  await upload(listingImages, 'tag.png');
  await expect(page.getByTestId('guided-capture-slot-tag')).toContainText('撮影済み');
  await expect(page.locator('[aria-label="追加した写真 3枚"]')).toBeVisible();

  const measurementEditor = page.getByTestId('guided-capture-measurement-editor');
  await expect(measurementEditor).toBeVisible();
  await upload(measurementEditor.locator('input[type="file"]').last(), 'measurement.png');
  await expect(page.getByTestId('guided-capture-measurement-endpoints')).toBeVisible();
  await expect(page.getByTestId('guided-capture-measurement-preview')).toBeVisible();
  await expect(page.locator('[aria-label="追加した写真 3枚"] img[alt="採寸画像"]')).toHaveCount(0);

  await page.getByLabel('着丈 始点 X').fill('0.510');
  await page.getByLabel('5cmマーカーの1辺 (px)').fill('50');
  const lengthInput = page.getByLabel('着丈 (cm)');
  const widthInput = page.getByLabel('身幅 (cm)');
  await expect.poll(async () => Number(await lengthInput.inputValue())).toBeGreaterThan(20);
  await expect.poll(async () => Number(await widthInput.inputValue())).toBeGreaterThan(20);
  await expect(page.getByTestId('guided-capture-approve-measurement')).toBeEnabled();
  await page.getByTestId('guided-capture-approve-measurement').click();
  await expect(page.getByTestId('guided-capture-review')).toBeVisible();
  await page.getByTestId('guided-capture-approve-review').click();
  await expect(page.getByTestId('guided-capture-ready')).toBeVisible();

  const backgroundPanel = page.getByTestId('background-edit-panel');
  await expect(backgroundPanel).toBeVisible();
  await backgroundPanel.getByRole('button', { name: 'プレビュー生成' }).click();
  await expect(backgroundPanel.getByRole('button', { name: 'この画像を明示承認して採用' })).toBeVisible();
  await expect(backgroundPanel).toContainText('元画像');
  await backgroundPanel.getByRole('button', { name: 'この画像を明示承認して採用' }).click();
  await expect(backgroundPanel).toContainText('背景編集画像を明示承認しました。');

  await page.getByRole('button', { name: '保存', exact: true }).first().click();
  await expect(page.getByText('下書きを保存しました。複数の下書きからいつでも再開できます。')).toBeVisible();
  await expect(page.locator('[aria-label="追加した写真 3枚"]')).toBeVisible();

  await assertNoPageErrors(errors);
  const evidence = await readFinalEvidence(page);
  return {
    normalizedState: evidence.normalizedState,
    backendEvidence,
    measurement: { lengthCm: Number(await lengthInput.inputValue()), widthCm: Number(await widthInput.inputValue()) },
    outputHash: evidence.output.sha256,
    outputMimeType: evidence.output.mimeType,
    outputByteSize: evidence.output.byteSize,
    requests,
    retryInjected,
    hasTransientUrl: evidence.hasTransientUrl,
    hasMeasurementPayload: evidence.hasMeasurementPayload,
  };
};

test('fixture backend adapter and photo assistant handoff are deterministic', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The deterministic runner executes this flow on chromium-desktop only.');
  test.skip(!ASSISTANT_API_URL, 'The deterministic runner supplies a local fixture backend URL.');

  const results = [];
  for (const runNumber of [1, 2]) {
    const context = await browser.newContext({ baseURL: UI_ORIGIN });
    const page = await context.newPage();
    try {
      results.push(await runFlow(page, runNumber));
    } finally {
      await context.close();
    }
  }

  expect(results).toHaveLength(2);
  for (const result of results) {
    expect(result.retryInjected).toBe(true);
    expect(result.backendEvidence.connection).toMatchObject({ connectionState: 'connected', transport: 'fixture' });
    expect(result.backendEvidence.front).toMatchObject({ shotType: 'front', quality: 'ok' });
    expect(result.backendEvidence.retry).toMatchObject({ shotType: 'back', quality: 'retry', issues: ['GARMENT_CROPPED'], nextAction: 'RETAKE' });
    expect(result.backendEvidence.correctedBack).toMatchObject({ shotType: 'back', quality: 'ok' });
    expect(result.backendEvidence.tag).toMatchObject({ shotType: 'tag', quality: 'ok' });
    expect(result.backendEvidence.measurement.endpoints).toBeTruthy();
    expect(result.backendEvidence.mask).toMatchObject({ type: 'image/png' });
    expect(result.backendEvidence.generated).toMatchObject({ type: 'image/png' });
    expect(result.requests).toMatchObject({ assessments: 4, measurement: 1, mask: 1, background: 1, backgroundStyles: ['studio_white'] });
    expect(result.normalizedState.media).toHaveLength(3);
    expect(result.normalizedState.imageOrder).toEqual([
      { order: 0, isCover: true },
      { order: 1, isCover: false },
      { order: 2, isCover: false },
    ]);
    expect(result.measurement.lengthCm).toBeGreaterThan(20);
    expect(result.measurement.widthCm).toBeGreaterThan(20);
    expect(result.measurement.lengthCm).toBeLessThan(100);
    expect(result.measurement.widthCm).toBeLessThan(80);
    expect(result.outputMimeType).toMatch(/^image\//u);
    expect(result.outputByteSize).toBeGreaterThan(0);
    expect(result.hasTransientUrl).toBe(false);
    expect(result.hasMeasurementPayload).toBe(false);
  }
  expect(results[1].normalizedState).toEqual(results[0].normalizedState);
  expect(results[1].measurement).toEqual(results[0].measurement);
  expect(results[1].outputHash).toBe(results[0].outputHash);
});
