import { CATALOG_ITEMS } from '../../data/catalogData.ts';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 40;
const CATALOG_QUERY_KEYS = new Set(['offset', 'limit', 'q', 'category']);

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
const hashText = (value: string): string => {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  let c = 0x85ebca6b;
  let d = 0xc2b2ae35;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + index), 0x27d4eb2d);
    c = Math.imul(c ^ (code << (index % 8)), 0x165667b1);
    d = Math.imul(d ^ (code * 31), 0x9e3779b1);
  }
  return [a, b, c, d].map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('');
};
const CATALOG_INDEX = CATALOG_ITEMS.map((item) => ({
  item,
  haystack: normalize([item.title, item.description, ...item.category, ...(item.searchTags ?? [])].join(' ')),
  categories: item.category.map(normalize),
}));

/**
 * Keep the large demo catalog out of the interactive client bundle. The
 * sandbox still works with the small initial catalog if this request fails.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => !CATALOG_QUERY_KEYS.has(key))) {
    return Response.json({ ok: false, error: 'INVALID_INPUT', message: '未対応のquery parameterです' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');
  const requestedLimit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  const requestedOffset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
    return Response.json({ ok: false, error: 'INVALID_INPUT', message: 'limitは1〜40、offsetは0以上の整数で指定してください' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const limit = requestedLimit;
  const offset = requestedOffset;
  const query = normalize(url.searchParams.get('q') ?? '');
  const category = normalize(url.searchParams.get('category') ?? '');
  if (query.length > 200 || category.length > 200) return Response.json({ ok: false, error: 'INVALID_INPUT', message: 'qとcategoryは200文字以内で指定してください' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  const filtered = CATALOG_INDEX.filter(({ haystack, categories }) => (!query || haystack.includes(query)) && (!category || categories.some((value) => value.includes(category))));
  const page = filtered.slice(offset, offset + limit).map(({ item }) => item);
  const contentDigest = hashText(JSON.stringify(filtered.map(({ item }) => item)));
  const etag = `"catalog-v3-${offset}-${limit}-${encodeURIComponent(query)}-${encodeURIComponent(category)}-${contentDigest}"`;
  const headers = {
    'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    etag,
    vary: 'accept-encoding',
    'x-catalog-total': String(filtered.length),
    'x-catalog-offset': String(offset),
    'x-catalog-limit': String(limit),
  };
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch?.split(',').some((candidate) => candidate.trim() === etag)) return new Response(null, { status: 304, headers });
  return Response.json(page, { headers });
}

export function TRACE(): Response {
  return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
}

export function PUT(): Response {
  return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
}
