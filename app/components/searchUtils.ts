import type { MercariItem } from '../types/mercari';

const CONDITION_SEARCH_ALIASES: Record<string, string[]> = {
  '新品・未使用': ['新品', '新品商品', '新品同様', '未使用', '未使用品'],
  '未使用に近い': ['きれい', '綺麗', '美品', 'きれいめ', '未使用に近い'],
  '目立った傷や汚れなし': ['きれい', '綺麗', '美品', '目立った傷や汚れなし'],
  'やや傷や汚れあり': ['傷あり', '使用感', 'やや傷や汚れあり'],
  '傷や汚れあり': ['傷あり', '使用感', '傷や汚れあり'],
};

const SEARCH_ALIAS_GROUPS = [
  ['pc', 'パソコン', 'ノートpc', 'ノートパソコン', 'デスクトップpc', 'デスクトップパソコン'],
  ['スマホ', 'スマートフォン', '携帯電話'],
  ['バッグ', '鞄', 'かばん'],
  ['靴', 'シューズ', 'スニーカー'],
  ['服', '衣類', 'ファッション', '洋服'],
  ['本', '書籍', '書物'],
  ['ゲーム', 'ゲーム機', 'ゲームソフト'],
  ['家具', 'インテリア', '家具インテリア'],
  ['きれい', '綺麗', '美品'],
];

const toHiragana = (value: string): string => value.replace(/[ァ-ヶ]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));

export const normalizeSearchText = (value: string): string => toHiragana(value
  .normalize('NFKC')
  .toLocaleLowerCase('ja-JP')
  .replace(/[・･]/gu, ' ')
  .replace(/[!！?？,，、。./／:：;；()[\]{}「」『』]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim());

export const tokenizeSearchQuery = (query: string): string[] => {
  const seen = new Set<string>();
  return query
    .split(/[\s\u3000]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => {
      const normalized = normalizeSearchText(token);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

export const joinSearchTokens = (tokens: string[]): string => tokens.filter(Boolean).join('　');

export interface ParsedSearchQuery {
  includeTokens: string[];
  excludeTokens: string[];
}

export const parseSearchQuery = (query: string): ParsedSearchQuery => {
  const includeTokens: string[] = [];
  const excludeTokens: string[] = [];
  tokenizeSearchQuery(query).forEach((token) => {
    const isExcluded = token.startsWith('-') && token.length > 1;
    const value = normalizeSearchText(isExcluded ? token.slice(1) : token);
    if (!value) return;
    (isExcluded ? excludeTokens : includeTokens).push(value);
  });
  return { includeTokens, excludeTokens };
};

const expandAliases = (values: string[]): string[] => {
  const normalizedValues = values.map(normalizeSearchText);
  return SEARCH_ALIAS_GROUPS.flatMap((group) => {
    const normalizedGroup = group.map(normalizeSearchText);
    return normalizedGroup.some((alias) => normalizedValues.some((value) => value.includes(alias) || alias.includes(value))) ? group : [];
  });
};

const buildConditionTerms = (condition: string): string[] => [condition, ...(CONDITION_SEARCH_ALIASES[condition] ?? [])];

export const getItemSearchText = (item: MercariItem): string => {
  const attributeValues = Object.entries(item.attributes ?? {}).flatMap(([key, value]) => [key, value]);
  const baseValues = [
    item.title,
    item.description,
    ...item.category,
    item.condition,
    ...buildConditionTerms(item.condition),
    item.brand,
    item.size,
    item.color,
    item.seller.name,
    item.shippingMethod,
    item.shippingFee,
    item.sku,
    item.productFamilyId,
    item.productFamilyName,
    item.variantId,
    item.variantName,
    item.productType,
    ...(item.searchTags ?? []),
    ...attributeValues,
    '商品',
  ].filter((value): value is string => Boolean(value));
  const aliases = expandAliases(baseValues);
  return normalizeSearchText([...baseValues, ...aliases].join(' '));
};

export const itemMatchesSearchQuery = (item: MercariItem, query: string): boolean => {
  const { includeTokens, excludeTokens } = parseSearchQuery(query);
  if (!includeTokens.length && !excludeTokens.length) return false;
  const searchable = getItemSearchText(item);
  return includeTokens.every((token) => searchable.includes(token)) && excludeTokens.every((token) => !searchable.includes(token));
};

export const searchCatalogItems = (items: MercariItem[], query: string): MercariItem[] => items.filter((item) => isPubliclyVisible(item) && itemMatchesSearchQuery(item, query));

export interface CatalogFilterSpec {
  category?: string;
  subcategory?: string;
  brand?: string;
  size?: string;
  salesStatus?: 'all' | 'available' | 'sold';
  sellerType?: string;
  condition?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  discountOption?: string;
  appraisal?: string;
  listingType?: string;
  guarantee?: string;
  color?: string;
  shippingOption?: string;
  shippingFee?: string;
  timeSale?: string;
  excludeKeyword?: string;
}

const isAvailable = (item: MercariItem): boolean => item.listingStatus !== 'HELD' && !item.isSold && ((item.inventoryQuantity ?? 1) - (item.reservedQuantity ?? 0)) > 0;
const isPubliclyVisible = (item: MercariItem): boolean => item.listingStatus !== 'HELD' && item.listingStatus !== 'DRAFT' && item.listingStatus !== 'ARCHIVED';
const isSoldListing = (item: MercariItem): boolean => item.isSold || item.listingStatus === 'SOLD' || ((item.inventoryQuantity ?? 0) - (item.reservedQuantity ?? 0)) <= 0;

const percentFromTimeSale = (value: string): number => {
  const match = value.match(/(\d+)/u);
  return match ? Number(match[1]) : 0;
};

/**
 * Apply every visible filter against the structured product fields. Keeping
 * this in one pure function prevents the search page and the agent API from
 * silently drifting apart.
 */
export const filterCatalogItems = (items: MercariItem[], filters: CatalogFilterSpec): MercariItem[] => {
  const category = filters.category?.trim() ?? '';
  const subcategory = filters.subcategory?.trim() ?? '';
  const brand = normalizeSearchText(filters.brand?.trim() ?? '');
  const size = normalizeSearchText(filters.size?.trim() ?? '');
  const color = normalizeSearchText(filters.color?.trim() ?? '');
  const excluded = normalizeSearchText(filters.excludeKeyword?.trim() ?? '');
  const minPrice = filters.minPrice === '' || filters.minPrice === undefined ? undefined : Number(filters.minPrice);
  const maxPrice = filters.maxPrice === '' || filters.maxPrice === undefined ? undefined : Number(filters.maxPrice);
  const categoryAliases = category && category !== 'すべて' ? [category, ...(categorySearchAliasesFor(category))] : [];

  return items.filter((item) => {
    if (!isPubliclyVisible(item)) return false;
    if (categoryAliases.length && !item.category.some((value) => categoryAliases.some((alias) => normalizeSearchText(value).includes(normalizeSearchText(alias)) || normalizeSearchText(alias).includes(normalizeSearchText(value))))) return false;
    if (subcategory && subcategory !== 'すべて' && !item.category.some((value) => normalizeSearchText(value).includes(normalizeSearchText(subcategory)))) return false;
    if (filters.salesStatus === 'available' && !isAvailable(item)) return false;
    if (filters.salesStatus === 'sold' && !isSoldListing(item)) return false;
    if (filters.condition && item.condition !== filters.condition) return false;
    if (minPrice !== undefined && Number.isFinite(minPrice) && item.price < minPrice) return false;
    if (maxPrice !== undefined && Number.isFinite(maxPrice) && item.price > maxPrice) return false;
    if (brand && !normalizeSearchText(item.brand ?? item.attributes?.brand ?? '').includes(brand)) return false;
    if (size && !normalizeSearchText(item.size ?? item.attributes?.size ?? '').includes(size)) return false;
    if (color && !normalizeSearchText(item.color ?? item.attributes?.color ?? '').includes(color)) return false;
    if (filters.shippingFee && item.shippingFee !== filters.shippingFee) return false;
    if (filters.shippingOption === '匿名配送' && item.isAnonymousShipping === false) return false;
    if (filters.shippingOption && filters.shippingOption !== '匿名配送' && !item.shippingMethod.includes(filters.shippingOption.replace('メルカリ便', '配送'))) return false;
    if (filters.listingType === 'オークション' && !item.isAuction) return false;
    if (filters.listingType === '通常出品' && item.isAuction) return false;
    if (filters.sellerType && (item.sellerType ?? 'individual') !== (filters.sellerType === 'ショップ' ? 'shop' : 'individual')) return false;
    if (filters.discountOption === 'クーポン対象' && !item.isCouponEligible) return false;
    if (filters.discountOption === 'タイムセール' && !item.isTimeSale) return false;
    if (filters.appraisal === '対象' && !item.isAuthenticityEligible) return false;
    if (filters.guarantee === '対象' && !item.isGuaranteeEligible) return false;
    if (filters.timeSale && (!item.isTimeSale || (item.discountRate ?? 0) < percentFromTimeSale(filters.timeSale))) return false;
    if (excluded && getItemSearchText(item).includes(excluded)) return false;
    return true;
  });
};

export const categorySearchAliasesFor = (category: string): string[] => {
  const aliases: Record<string, string[]> = {
    ファッション: ['レディース', 'メンズ'],
    'ゲーム・おもちゃ・グッズ': ['ゲーム・おもちゃ', 'ゲーム', 'グッズ', 'ホビー', 'フィギュア', 'トレーディングカード'],
    '本・雑誌・漫画': ['本・マンガ', '本', 'マンガ', '漫画', '雑誌'],
    'スマホ・タブレット・パソコン': ['家電・スマホ', 'スマホ', 'タブレット', 'PC', 'パソコン'],
    'ベビー・キッズ': ['ベビー', 'キッズ'],
  };
  return aliases[category] ?? [];
};
