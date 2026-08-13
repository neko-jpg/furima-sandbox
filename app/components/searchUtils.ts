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

export const searchCatalogItems = (items: MercariItem[], query: string): MercariItem[] => items.filter((item) => itemMatchesSearchQuery(item, query));
