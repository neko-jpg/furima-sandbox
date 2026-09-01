/**
 * Extract the demo chapters and build a compact contact sheet for visual QA.
 * Only frames rendered from the finished video and non-sensitive metadata are
 * written. Source images, request bodies, credentials, and tokens are never
 * copied into the review directory.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_INPUT = resolve(ROOT, 'output/playwright/demo/furima-ai-listing-demo-final.mp4');
const DEFAULT_MANIFEST = resolve(ROOT, 'output/playwright/demo/furima-ai-listing-demo-manifest.json');
const DEFAULT_REVIEW_DIR = resolve(ROOT, 'output/playwright/demo/review');

const fallbackChapters = [
  { title: 'おすすめを眺める', atSeconds: 2 },
  { title: '商品詳細を見る', atSeconds: 6 },
  { title: 'AI撮影アシスタント LIVE', atSeconds: 11 },
  { title: '失敗判定：全体が入るように撮り直し', atSeconds: 17 },
  { title: '成功復帰：裏面OK', atSeconds: 22 },
  { title: '実物50mmマーカーで採寸', atSeconds: 29 },
  { title: '採寸を明示承認', atSeconds: 35 },
  { title: '背景分離・生成と比較', atSeconds: 44 },
  { title: '完成画像を明示承認', atSeconds: 53 },
];

const fail = (message) => {
  throw new Error(`[demo:review] ${message}`);
};

const parseArgs = (argv) => {
  const result = { input: DEFAULT_INPUT, manifest: DEFAULT_MANIFEST, outputDir: DEFAULT_REVIEW_DIR, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) fail(`${argument} requires a value`);
      index += 1;
      return argv[index];
    };
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--input') result.input = resolve(next());
    else if (argument === '--manifest') result.manifest = resolve(next());
    else if (argument === '--output-dir') result.outputDir = resolve(next());
    else fail(`unknown option: ${argument}`);
  }
  return result;
};

const printHelp = () => {
  console.log(`Demo video review

Usage:
  npm run demo:review
  npm run demo:review -- --input <finished-video>

Options:
  --input <path>       Finished 1080x1920 MP4 (default: output/playwright/demo/furima-ai-listing-demo-final.mp4)
  --manifest <path>    Recorder manifest (default: output/playwright/demo/furima-ai-listing-demo-manifest.json)
  --output-dir <path> Review frame directory (default: output/playwright/demo/review)`);
};

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  return result;
};

const probeVideo = (input) => {
  const result = run(process.env.FFPROBE_BIN ?? 'ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input,
  ]);
  if (result.status !== 0) fail(`ffprobe failed: ${(result.stderr || '').slice(-800)}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    fail(`ffprobe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stream = parsed.streams?.find((candidate) => candidate.codec_type === 'video');
  const width = Number(stream?.width ?? 0);
  const height = Number(stream?.height ?? 0);
  const duration = Number(parsed.format?.duration ?? 0);
  if (width !== 1080 || height !== 1920) fail(`review input must be 1080x1920, received ${width}x${height}`);
  if (!Number.isFinite(duration) || duration <= 0) fail('review input has no usable duration');
  return { width, height, duration: Number(duration.toFixed(2)) };
};

const readChapters = (manifestPath, duration) => {
  if (!existsSync(manifestPath)) return fallbackChapters.map((chapter) => ({ ...chapter }));
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(manifest.chapters) && manifest.chapters.length > 0) {
      return manifest.chapters
        .filter((chapter) => typeof chapter?.title === 'string' && Number.isFinite(Number(chapter.atSeconds)))
        .map((chapter) => ({ title: chapter.title, atSeconds: Math.max(0, Math.min(duration - 0.1, Number(chapter.atSeconds))) }));
    }
  } catch {
    // The recorder manifest is optional metadata; fixed review points remain useful.
  }
  return fallbackChapters.map((chapter) => ({
    ...chapter,
    atSeconds: Math.max(0, Math.min(duration - 0.1, chapter.atSeconds)),
  }));
};

const extractFrame = (input, output, atSeconds) => {
  const result = run(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', atSeconds.toFixed(2), '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=540:960:force_original_aspect_ratio=decrease:flags=lanczos,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=0x111111',
    '-q:v', '2', output,
  ]);
  if (result.status !== 0 || !existsSync(output) || statSync(output).size <= 0) {
    fail(`could not extract review frame at ${atSeconds.toFixed(2)}s: ${(result.stderr || '').slice(-800)}`);
  }
};

const makeContactSheet = (frameCount, reviewDir, output) => {
  const rows = Math.ceil(frameCount / 2);
  const result = run(process.env.FFMPEG_BIN ?? 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', '1', '-start_number', '1', '-i', resolve(reviewDir, 'frame-%02d.png'),
    '-frames:v', '1',
    '-vf', `scale=270:480:flags=lanczos,tile=2x${rows}:padding=12:margin=12:color=0x161616`,
    '-q:v', '2', output,
  ]);
  if (result.status !== 0 || !existsSync(output) || statSync(output).size <= 0) {
    fail(`could not create review contact sheet: ${(result.stderr || '').slice(-800)}`);
  }
};

const main = () => {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  if (!existsSync(config.input)) fail(`finished video does not exist: ${config.input}`);
  const video = probeVideo(config.input);
  mkdirSync(config.outputDir, { recursive: true });
  const chapters = readChapters(config.manifest, video.duration);
  const frameRecords = chapters.map((chapter, index) => {
    const filename = `frame-${String(index + 1).padStart(2, '0')}.png`;
    const output = resolve(config.outputDir, filename);
    extractFrame(config.input, output, chapter.atSeconds);
    return { ...chapter, filename };
  });
  const contactSheet = 'contact-sheet.png';
  makeContactSheet(frameRecords.length, config.outputDir, resolve(config.outputDir, contactSheet));
  const review = {
    input: basename(config.input),
    video,
    frames: frameRecords,
    contactSheet,
    sourceBytesPersisted: false,
    requestBodiesPersisted: false,
    secretsPersisted: false,
  };
  writeFileSync(resolve(config.outputDir, 'review.json'), JSON.stringify(review, null, 2));
  console.log(`[demo:review] contact sheet=${resolve(config.outputDir, contactSheet)}`);
  console.log(`[demo:review] frames=${frameRecords.length} duration=${video.duration}s canvas=${video.width}x${video.height}`);
};

try {
  main();
} catch (error) {
  console.error(`[demo:review] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
