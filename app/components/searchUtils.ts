export const tokenizeSearchQuery = (query: string): string[] => {
  const seen = new Set<string>();
  return query
    .split(/[\s\u3000]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => {
      const normalized = token.toLocaleLowerCase('ja-JP');
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
};

export const joinSearchTokens = (tokens: string[]): string => tokens.filter(Boolean).join('　');
