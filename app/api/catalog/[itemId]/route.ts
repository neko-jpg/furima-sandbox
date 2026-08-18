import { CATALOG_ITEMS } from '../../../data/catalogData.ts';

const normalize = (value: string): string => value.normalize('NFKC').trim();
const catalogById = new Map(CATALOG_ITEMS.map((item) => [item.id, item]));
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

export function GET(request: Request): Response {
  const pathname = new URL(request.url).pathname.replace(/\/$/u, '');
  const rawItemId = pathname.split('/').pop() ?? '';
  let itemId = '';
  try { itemId = normalize(decodeURIComponent(rawItemId)); } catch { itemId = ''; }
  if (!itemId || itemId.length > 160) return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const item = catalogById.get(itemId);
  if (!item) return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const etag = `"catalog-item-${encodeURIComponent(item.id)}-${hashText(JSON.stringify(item))}"`;
  const headers = { 'cache-control': 'public, max-age=300, stale-while-revalidate=600', etag, vary: 'accept-encoding' };
  if (request.headers.get('if-none-match')?.split(',').some((candidate) => candidate.trim() === etag)) return new Response(null, { status: 304, headers });
  return Response.json(item, { headers });
}
