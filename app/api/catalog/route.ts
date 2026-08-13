import { CATALOG_ITEMS } from '../../data/catalogData';

const PAGE_SIZE = 160;

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('ja-JP').trim();

/**
 * Keep the large demo catalog out of the interactive client bundle. The
 * sandbox still works with the small initial catalog if this request fails.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? PAGE_SIZE);
  const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number.isInteger(requestedLimit) ? Math.min(PAGE_SIZE, Math.max(1, requestedLimit)) : PAGE_SIZE;
  const offset = Number.isInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const query = normalize(url.searchParams.get('q') ?? '');
  const category = normalize(url.searchParams.get('category') ?? '');
  const filtered = CATALOG_ITEMS.filter((item) => {
    const haystack = normalize([item.title, item.description, ...item.category, ...(item.searchTags ?? [])].join(' '));
    return (!query || haystack.includes(query)) && (!category || item.category.some((value) => normalize(value).includes(category)));
  });
  const page = filtered.slice(offset, offset + limit);
  const etag = `"catalog-v2-${offset}-${limit}-${encodeURIComponent(query)}-${encodeURIComponent(category)}-${filtered.length}"`;
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
