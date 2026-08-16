import { CATALOG_ITEMS } from '../../../data/catalogData.ts';

const normalize = (value: string): string => value.normalize('NFKC').trim();

export function GET(request: Request): Response {
  const pathname = new URL(request.url).pathname.replace(/\/$/u, '');
  const rawItemId = pathname.split('/').pop() ?? '';
  let itemId = '';
  try { itemId = normalize(decodeURIComponent(rawItemId)); } catch { itemId = ''; }
  if (!itemId || itemId.length > 160) return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const item = CATALOG_ITEMS.find((candidate) => candidate.id === itemId);
  if (!item) return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const etag = `"catalog-item-${encodeURIComponent(item.id)}-${encodeURIComponent(item.updatedAt ?? item.createdAt ?? 'v1')}"`;
  const headers = { 'cache-control': 'public, max-age=300, stale-while-revalidate=600', etag, vary: 'accept-encoding' };
  if (request.headers.get('if-none-match')?.split(',').some((candidate) => candidate.trim() === etag)) return new Response(null, { status: 304, headers });
  return Response.json(item, { headers });
}
