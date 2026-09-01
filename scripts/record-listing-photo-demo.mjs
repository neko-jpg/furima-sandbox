/**
 * Record the live, mobile-first listing-photo demo.
 *
 * This is deliberately a recording harness, not a product test. It never
 * writes request bodies, API keys, LiveKit tokens, or source image bytes to
 * disk. The only persisted artifacts are the final video, a small chapter /
 * request-count manifest, and the review frames made by the review script.
 *
 * The browser flow is implemented with Playwright's browser API because the
 * CLI and the library use the same engine, while the CLI remains the
 * recommended way to inspect/drive the page interactively (see the runbook).
 */

import { chromium } from 'playwright';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT, 'output/playwright/demo');
const RAW_DIR = resolve(OUTPUT_DIR, 'raw');
const FINAL_VIDEO = resolve(OUTPUT_DIR, 'furima-ai-listing-demo-final.mp4');
const RAW_VIDEO = resolve(OUTPUT_DIR, 'furima-ai-listing-demo-raw.webm');
const MANIFEST = resolve(OUTPUT_DIR, 'furima-ai-listing-demo-manifest.json');
const CANDIDATE_MANIFEST = resolve(OUTPUT_DIR, 'furima-ai-listing-background-candidates.json');

const VIEWPORT = { width: 390, height: 844 };
const RECORDING_SIZE = { width: 390, height: 844 };
const BACKGROUND_STYLES = ['studio_white', 'warm_neutral', 'light_wood'];
const STYLE_LABELS = {
  studio_white: 'ソフトホワイト',
  warm_neutral: 'ウォームニュートラル',
  light_wood: 'ライトウッド',
};

const DEFAULT_ASSETS = {
  front: 'C:\\Users\\arat2\\Downloads\\01-front-ok.jpg.webp',
  backBad: 'C:\\Users\\arat2\\Downloads\\02-back-bad-cropped.jpg.webp',
  backOk: 'C:\\Users\\arat2\\Downloads\\03-back-ok.jpg.webp',
  tag: 'C:\\Users\\arat2\\Downloads\\タグ写真.webp',
  marker: 'C:\\Users\\arat2\\Downloads\\50mm_black_square_frame_marker(1).png',
};

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const fail = (message) => {
  throw new Error(`[demo:record] ${message}`);
};

const parseArgs = (argv) => {
  const result = {
    uiUrl: process.env.DEMO_UI_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    apiUrl: process.env.DEMO_ASSISTANT_API_URL ?? process.env.VITE_LISTING_ASSISTANT_API_URL ?? 'http://127.0.0.1:3001',
    measurement: process.env.DEMO_MEASUREMENT_IMAGE ?? '',
    backgroundStyle: process.env.DEMO_BACKGROUND_STYLE ?? 'studio_white',
    sweep: process.env.DEMO_BACKGROUND_SWEEP !== 'false',
    headed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) fail(`${argument} requires a value`);
      index += 1;
      return argv[index];
    };
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--headed') result.headed = true;
    else if (argument === '--no-sweep') result.sweep = false;
    else if (argument === '--sweep') result.sweep = true;
    else if (argument === '--ui') result.uiUrl = next();
    else if (argument === '--api') result.apiUrl = next();
    else if (argument === '--measurement') result.measurement = next();
    else if (argument === '--background-style') result.backgroundStyle = next();
    else fail(`unknown option: ${argument}`);
  }
  return result;
};

const printHelp = () => {
  console.log(`Live mobile demo recorder\n\nUsage:\n  npm run demo:record -- --measurement <real-measurement-photo> [options]\n\nOptions:\n  --measurement <path>       A real photo with a physically printed 50mm marker (required)\n  --background-style <id>    studio_white | warm_neutral | light_wood (default: studio_white)\n  --no-sweep                 Skip the three-style preflight candidate sweep\n  --headed                   Show the Chromium window while recording\n  --ui <url>                 Mobile UI URL (default: http://127.0.0.1:3000)\n  --api <url>                Assistant API URL (default: http://127.0.0.1:3001)\n\nThe recorder requires live Proxy, LiveKit credentials, and the live rembg/BiRefNet\nsidecar. It refuses fixture mode and refuses to fabricate a measurement image.`);
};

const ensureDirectory = (directory) => mkdirSync(directory, { recursive: true });

const validateAsset = (label, pathValue, { required = true } = {}) => {
  if (!pathValue) {
    if (required) fail(`${label} is required. Take the real photo first; do not use a generated marker image.`);
    return null;
  }
  const absolute = resolve(pathValue);
  if (!existsSync(absolute)) fail(`${label} does not exist: ${absolute}`);
  const stats = statSync(absolute);
  if (!stats.isFile() || stats.size <= 0) fail(`${label} is not a non-empty file`);
  if (!/\.(?:jpe?g|png|webp|avif|gif)$/iu.test(extname(absolute))) fail(`${label} must be an image file`);
  return absolute;
};

const validateLiveEnvironment = () => {
  const required = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
  ];
  const missing = required.filter((name) => !String(process.env[name] ?? '').trim());
  if (process.env.PROVIDER_MODE !== 'live') missing.push('PROVIDER_MODE=live');
  if (process.env.VITE_LISTING_ASSISTANT_MODE !== 'live') missing.push('VITE_LISTING_ASSISTANT_MODE=live');
  if (missing.length) {
    fail(`live recording is not armed; configure ${missing.join(', ')} in a private environment. No fixture fallback is allowed.`);
  }
  if (!/^https?:\/\//iu.test(process.env.OPENAI_BASE_URL ?? '')) {
    fail('OPENAI_BASE_URL must be an http(s) Proxy URL');
  }
  if (!/^(?:wss|https?):\/\//iu.test(process.env.LIVEKIT_URL ?? '')) {
    fail('LIVEKIT_URL must use wss:// or https://');
  }
};

const validateAssets = (measurementPath) => {
  const assets = {
    front: validateAsset('front asset', process.env.DEMO_FRONT_IMAGE ?? DEFAULT_ASSETS.front),
    backBad: validateAsset('cropped back asset', process.env.DEMO_BACK_BAD_IMAGE ?? DEFAULT_ASSETS.backBad),
    backOk: validateAsset('corrected back asset', process.env.DEMO_BACK_OK_IMAGE ?? DEFAULT_ASSETS.backOk),
    tag: validateAsset('tag asset', process.env.DEMO_TAG_IMAGE ?? DEFAULT_ASSETS.tag),
    marker: validateAsset('marker reference image', process.env.DEMO_MARKER_IMAGE ?? DEFAULT_ASSETS.marker),
    measurement: validateAsset('real measurement photo', measurementPath),
  };
  if (resolve(assets.measurement) === resolve(assets.marker)) {
    fail('the marker reference itself cannot be uploaded as a measurement photo; print it at 100% and photograph it beside the garment');
  }
  return assets;
};

const waitForHealth = async (apiUrl) => {
  let lastError = 'health check did not complete';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/u, '')}/api/health`, { signal: AbortSignal.timeout(2500) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.status === 'ok') return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  fail(`assistant API is not ready at ${apiUrl}: ${lastError}`);
};

const ensureVisible = async (locator, label, timeout = 30_000) => {
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch (error) {
    fail(`${label} did not become visible: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const ensureEnabled = async (locator, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) return;
    await sleep(200);
  }
  fail(`${label} did not become enabled`);
};

const ensureText = async (locator, text, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const content = await locator.textContent().catch(() => '');
    if (content?.includes(text)) return;
    await sleep(250);
  }
  fail(`${label} did not contain expected text: ${text}`);
};

const clickAfterScroll = async (locator, label) => {
  await ensureVisible(locator, label);
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
};

const addChapter = (chapters, recordingStartedAt, title) => {
  chapters.push({ title, atSeconds: Number(((Date.now() - recordingStartedAt) / 1000).toFixed(2)) });
};

const routeLiveFailureOnce = async (page, counters) => {
  let injected = false;
  await page.route('**/api/analyze-shot', async (route) => {
    counters.analyze += 1;
    if (counters.analyze === 2 && !injected) {
      injected = true;
      await route.fulfill({
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          shotType: 'back',
          quality: 'retry',
          issues: ['GARMENT_CROPPED'],
          missingShots: ['back', 'tag'],
          nextAction: 'RETAKE',
        }),
      });
      return;
    }
    await route.continue();
  });
  return () => injected;
};

const installRequestCounters = (page) => {
  const counters = {
    analyze: 0,
    measurement: 0,
    mask: 0,
    background: 0,
    backgroundStyles: [],
    failedRequests: 0,
    pageErrors: [],
  };
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/suggest-measurement-points') counters.measurement += 1;
    if (pathname === '/api/remove-background') counters.mask += 1;
    if (pathname === '/api/generate-background') counters.background += 1;
    if (pathname === '/api/generate-background') {
      // Only retain the allow-listed style id, never request data or headers.
      try {
        const body = request.postDataJSON();
        if (body && typeof body === 'object' && BACKGROUND_STYLES.includes(body.styleId)) counters.backgroundStyles.push(body.styleId);
      } catch {
        // Request body is intentionally not retained.
      }
    }
  });
  page.on('requestfailed', () => { counters.failedRequests += 1; });
  page.on('pageerror', (error) => { counters.pageErrors.push(error.message.slice(0, 240)); });
  return counters;
};

const runPhotoAndMeasurementFlow = async (page, assets, options) => {
  const { counters, chapters, recordingStartedAt, apiUrl } = options;
  const wasInjected = await routeLiveFailureOnce(page, counters);

  await page.goto(options.uiUrl, { waitUntil: 'domcontentloaded' });
  await ensureVisible(page.getByTestId('home-view'), 'recommendation home');
  addChapter(chapters, recordingStartedAt, 'おすすめを眺める');
  await sleep(1200);
  await page.mouse.wheel(0, 210);
  await sleep(850);
  await page.mouse.wheel(0, 135);
  await sleep(950);

  const productCard = page.locator('[data-testid^="item-card-"]:visible').first();
  await clickAfterScroll(productCard, 'recommended product card');
  await ensureVisible(page.getByTestId('item-detail-view'), 'product detail');
  addChapter(chapters, recordingStartedAt, '商品詳細を見る');
  await sleep(1600);
  await clickAfterScroll(page.getByTestId('back-button'), 'product detail back button');

  await clickAfterScroll(page.getByTestId('nav-sell'), 'sell tab');
  await ensureVisible(page.getByTestId('listing-view'), 'listing home');
  await clickAfterScroll(page.getByTestId('open-listing-flow'), 'start listing button');
  await ensureVisible(page.getByTestId('listing-flow'), 'listing flow');
  const guidedContent = page.getByTestId('guided-capture-content');
  if (!(await guidedContent.isVisible().catch(() => false))) await clickAfterScroll(page.getByTestId('guided-capture-toggle'), 'AI capture assistant toggle');
  await ensureVisible(guidedContent, 'AI capture assistant');
  await clickAfterScroll(page.getByTestId('guided-capture-start'), 'start AI capture assistant');
  await ensureText(page.getByTestId('guided-capture-connection'), '接続済み', 'LiveKit connection', 60_000);
  await ensureText(page.getByTestId('guided-capture-transport'), 'LIVE', 'live transport badge', 10_000);
  addChapter(chapters, recordingStartedAt, 'AI撮影アシスタント LIVE');

  const listingImages = page.locator('#listing-images');
  await listingImages.setInputFiles(assets.front);
  await ensureText(page.getByTestId('guided-capture-slot-front'), '撮影済み', 'front shot');
  await sleep(800);

  await listingImages.setInputFiles(assets.backBad);
  await ensureVisible(page.locator('[role="alert"]').filter({ hasText: '衣類全体が入るように' }), 'cropped-shot retry guidance', 45_000);
  addChapter(chapters, recordingStartedAt, '失敗判定：全体が入るように撮り直し');
  await sleep(1400);

  await listingImages.setInputFiles(assets.backOk);
  await ensureText(page.getByTestId('guided-capture-slot-back'), '撮影済み', 'corrected back shot', 45_000);
  addChapter(chapters, recordingStartedAt, '成功復帰：裏面OK');
  await sleep(750);

  await listingImages.setInputFiles(assets.tag);
  await ensureText(page.getByTestId('guided-capture-slot-tag'), '撮影済み', 'tag shot', 45_000);
  await sleep(850);

  const measurementEditor = page.getByTestId('guided-capture-measurement-editor');
  await ensureVisible(measurementEditor, 'measurement editor', 45_000);
  const measurementInputs = measurementEditor.locator('input[type="file"]');
  if ((await measurementInputs.count()) < 1) fail('measurement album input is missing');
  await measurementInputs.last().setInputFiles(assets.measurement);
  await ensureVisible(page.getByTestId('guided-capture-measurement-preview'), 'measurement preview', 60_000);
  await ensureVisible(page.getByTestId('guided-capture-measurement-endpoints'), 'four measurement endpoints', 60_000);
  addChapter(chapters, recordingStartedAt, '実物50mmマーカーで採寸');
  await sleep(1600);

  const approveMeasurement = page.getByTestId('guided-capture-approve-measurement');
  await ensureEnabled(approveMeasurement, 'measurement approval');
  const review = page.getByTestId('guided-capture-review');
  for (let attempt = 0; attempt < 2 && !(await review.isVisible().catch(() => false)); attempt += 1) {
    await clickAfterScroll(approveMeasurement, 'measurement approval');
    await sleep(700);
  }
  await ensureVisible(review, 'measurement review');
  addChapter(chapters, recordingStartedAt, '採寸を明示承認');
  await clickAfterScroll(page.getByTestId('guided-capture-approve-review'), 'photo and measurement review approval');
  await ensureVisible(page.getByTestId('guided-capture-ready'), 'capture ready state', 30_000);

  if (options.skipBackground) {
    return { wasInjected: wasInjected() };
  }

  const panel = page.getByTestId('background-edit-panel');
  await ensureVisible(panel, 'AI background assistant', 30_000);
  const styleButton = panel.getByRole('radio', { name: STYLE_LABELS[options.backgroundStyle] });
  if (options.backgroundStyle !== 'studio_white') await clickAfterScroll(styleButton, 'selected background style');
  await clickAfterScroll(panel.getByTestId('background-edit-generate'), 'generate background preview');
  await ensureVisible(panel.getByTestId('background-edit-comparison'), 'original/background comparison', 120_000);
  addChapter(chapters, recordingStartedAt, '背景分離・生成と比較');
  await sleep(1800);
  const composite = panel.getByTestId('background-edit-select-composite');
  await ensureEnabled(composite, 'composite selection');
  await clickAfterScroll(composite, 'select generated composite');
  await clickAfterScroll(panel.getByTestId('background-edit-approve'), 'approve generated composite');
  await ensureText(panel, '合成プレビューを明示承認しました。', 'background approval', 30_000);
  addChapter(chapters, recordingStartedAt, '完成画像を明示承認');
  await panel.getByTestId('background-edit-comparison').scrollIntoViewIfNeeded();
  await sleep(3500);

  return {
    wasInjected: wasInjected(),
    apiUrl,
  };
};

const sweepBackgroundStyles = async (page, options) => {
  const panel = page.getByTestId('background-edit-panel');
  const candidates = [];
  for (const style of BACKGROUND_STYLES) {
    const button = panel.getByRole('radio', { name: STYLE_LABELS[style] });
    await clickAfterScroll(button, `${style} candidate`);
    await clickAfterScroll(panel.getByTestId('background-edit-generate'), `${style} background generation`);
    await ensureVisible(panel.getByTestId('background-edit-comparison'), `${style} comparison`, 120_000);
    candidates.push({ style, rendered: true });
    await sleep(1000);
  }
  writeFileSync(CANDIDATE_MANIFEST, JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidates,
    selectedStyle: options.backgroundStyle,
    selectionReason: 'studio_white is the default visual choice for the navy garment; override with --background-style after visual review',
    imageBytesPersisted: false,
  }, null, 2));
};

const createContext = async (browser, outputDir, recordVideo) => browser.newContext({
  viewport: VIEWPORT,
  screen: VIEWPORT,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  colorScheme: 'dark',
  ...(recordVideo ? { recordVideo: { dir: outputDir, size: RECORDING_SIZE } } : {}),
});

const recordPass = async (browser, config, assets, { recordVideo, skipBackground }) => {
  const context = await createContext(browser, RAW_DIR, recordVideo);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const counters = installRequestCounters(page);
  const chapters = [];
  const recordingStartedAt = Date.now();
  let video = null;
  try {
    video = page.video();
    const flowResult = await runPhotoAndMeasurementFlow(page, assets, {
      ...config,
      counters,
      chapters,
      recordingStartedAt,
      skipBackground,
    });
    return { context, page, video, counters, chapters, flowResult };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
};

const finishPass = async (pass) => {
  await pass.context.close();
  const videoPath = pass.video ? await pass.video.path() : null;
  return { ...pass, videoPath };
};

const moveRawVideo = (source) => {
  if (!source || !existsSync(source)) fail('Playwright did not produce a raw video');
  if (resolve(source) !== resolve(RAW_VIDEO) && existsSync(RAW_VIDEO)) rmSync(RAW_VIDEO, { force: true });
  if (resolve(source) !== resolve(RAW_VIDEO)) renameSync(source, RAW_VIDEO);
};

const runFfmpeg = (input, output) => {
  const filter = '[0:v]split=2[blur][phone];[blur]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=22,eq=brightness=-0.32[back];[phone]scale=886:1920:force_original_aspect_ratio=decrease[mobile];[back][mobile]overlay=(W-w)/2:0:format=auto[vout]';
  const result = spawnSync(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', output,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) fail(`FFmpeg final encode failed: ${(result.stderr || '').slice(-800)}`);
};

const validateFinalVideo = (pathValue) => {
  if (!existsSync(pathValue) || statSync(pathValue).size <= 0) fail('final video was not created');
  const probe = spawnSync(process.env.FFPROBE_BIN ?? 'ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', pathValue,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (probe.status !== 0) fail(`ffprobe failed: ${(probe.stderr || '').slice(-600)}`);
  const parsed = JSON.parse(probe.stdout);
  const stream = parsed.streams?.find((candidate) => candidate.codec_type === 'video');
  const width = Number(stream?.width ?? 0);
  const height = Number(stream?.height ?? 0);
  const duration = Number(parsed.format?.duration ?? 0);
  if (width !== 1080 || height !== 1920) fail(`final video must be 1080x1920, received ${width}x${height}`);
  if (!Number.isFinite(duration) || duration < 15) fail(`final video is too short (${duration.toFixed(2)}s)`);
  return { width, height, duration: Number(duration.toFixed(2)), sizeBytes: statSync(pathValue).size };
};

const main = async () => {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  if (!BACKGROUND_STYLES.includes(config.backgroundStyle)) fail(`unsupported background style: ${config.backgroundStyle}`);
  validateLiveEnvironment();
  const assets = validateAssets(config.measurement);
  ensureDirectory(RAW_DIR);
  await waitForHealth(config.apiUrl);

  const browser = await chromium.launch({ headless: !config.headed });
  let finalPass = null;
  try {
    if (config.sweep) {
      // The first pass intentionally has no video; it only spends one finite
      // measurement/photo session to render each of the three candidates.
      const candidateContext = await createContext(browser, RAW_DIR, false);
      const candidatePage = await candidateContext.newPage();
      candidatePage.setDefaultTimeout(45_000);
      const candidateCounters = installRequestCounters(candidatePage);
      const candidateChapters = [];
      const candidateStartedAt = Date.now();
      await routeLiveFailureOnce(candidatePage, candidateCounters);
      await runPhotoAndMeasurementFlow(candidatePage, assets, {
        ...config,
        counters: candidateCounters,
        chapters: candidateChapters,
        recordingStartedAt: candidateStartedAt,
        skipBackground: true,
      });
      await sweepBackgroundStyles(candidatePage, config);
      await candidateContext.close();
    }

    finalPass = await recordPass(browser, config, assets, { recordVideo: true, skipBackground: false });
    const completed = await finishPass(finalPass);
    finalPass = null;
    moveRawVideo(completed.videoPath);
    runFfmpeg(RAW_VIDEO, FINAL_VIDEO);
    const video = validateFinalVideo(FINAL_VIDEO);
    const manifest = {
      generatedAt: new Date().toISOString(),
      recorder: 'Playwright Chromium mobile context',
      viewport: VIEWPORT,
      finalCanvas: { width: 1080, height: 1920, layout: 'blurred background + centered 390x844 mobile UI' },
      selectedBackgroundStyle: config.backgroundStyle,
      assets: {
        front: basename(assets.front),
        backBad: basename(assets.backBad),
        backOk: basename(assets.backOk),
        tag: basename(assets.tag),
        measurement: basename(assets.measurement),
        markerReference: basename(assets.marker),
      },
      finalRequestCounts: completed.counters,
      chapters: completed.chapters,
      rawVideo: basename(RAW_VIDEO),
      finalVideo: basename(FINAL_VIDEO),
      video,
      sourceBytesPersisted: false,
      requestBodiesPersisted: false,
      secretsPersisted: false,
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    if (completed.counters.analyze !== 4 || completed.counters.measurement !== 1 || completed.counters.mask !== 1 || completed.counters.background !== 1) {
      fail(`unexpected final API call counts: ${JSON.stringify({ analyze: completed.counters.analyze, measurement: completed.counters.measurement, mask: completed.counters.mask, background: completed.counters.background })}`);
    }
    if (!completed.flowResult.wasInjected) fail('the deterministic second analyze-shot failure was not injected');
    if (completed.counters.failedRequests > 0 || completed.counters.pageErrors.length > 0) fail(`browser errors detected (${completed.counters.failedRequests} failed requests, ${completed.counters.pageErrors.length} page errors)`);
    console.log(`[demo:record] final=${FINAL_VIDEO}`);
    console.log(`[demo:record] duration=${video.duration}s canvas=${video.width}x${video.height}`);
    console.log(`[demo:record] manifest=${MANIFEST}`);
  } finally {
    if (finalPass) await finalPass.context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

try {
  await main();
} catch (error) {
  console.error(`[demo:record] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
