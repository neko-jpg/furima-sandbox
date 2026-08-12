'use client';

import React from 'react';
import { useMercari } from '../../context/MercariContext';
import { X, Search, Heart, ChevronRight, Layers, Tag } from 'lucide-react';

export const SearchView: React.FC = () => {
  const {
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    searchHistory,
    addSearchHistory,
    clearSearchHistory,
    items,
    setSelectedItem,
  } = useMercari();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      addSearchHistory(searchQuery.trim());
    }
  };

  const filteredItems = searchQuery.trim()
    ? items.filter(
        (item) =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.category.some((c) =>
            c.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-[#121212] flex flex-col overflow-y-auto no-scrollbar animate-fade-in"
      data-testid="search-view"
    >
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#1e1e1e] border-b border-[#2c2c2e] p-3 flex items-center gap-3">
        <button
          onClick={() => setIsSearchOpen(false)}
          className="p-1 text-gray-300 hover:text-white transition-colors"
          data-testid="close-search-btn"
        >
          <X className="w-6 h-6" />
        </button>

        <form onSubmit={handleSearchSubmit} className="flex-1 relative flex items-center">
          <Search className="w-4 h-4 text-gray-400 absolute left-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="なにをお探しですか？"
            autoFocus
            className="w-full bg-[#2a2a2d] border border-[#3a3a3c] rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-red-500"
            data-testid="search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 text-gray-400 hover:text-white text-xs bg-gray-700 rounded-full w-4 h-4 flex items-center justify-center"
            >
              ×
            </button>
          )}
        </form>
      </div>

      {/* Category / Brand Quick Action Buttons */}
      <div className="p-3 grid grid-cols-2 gap-3 border-b border-[#2c2c2e]">
        <button className="bg-[#1e1e1e] hover:bg-[#252528] border border-[#2c2c2e] py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-200 transition-colors">
          <Layers className="w-4 h-4 text-[#ff0211]" />
          <span>カテゴリー</span>
        </button>

        <button className="bg-[#1e1e1e] hover:bg-[#252528] border border-[#2c2c2e] py-3 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-gray-200 transition-colors">
          <Tag className="w-4 h-4 text-blue-400" />
          <span>ブランド</span>
        </button>
      </div>

      {/* If Search Query Exists: Show Filtered Results */}
      {searchQuery.trim() ? (
        <div className="p-3 space-y-3 flex-1">
          <div className="text-xs text-gray-400 flex items-center justify-between">
            <span>「{searchQuery}」の検索結果</span>
            <span>{filteredItems.length} 件</span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              一致する商品が見つかりませんでした。
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setIsSearchOpen(false);
                    setSelectedItem(item);
                  }}
                  className="bg-[#1e1e1e] rounded-lg overflow-hidden border border-[#2c2c2e] cursor-pointer"
                  data-testid={`search-result-${item.id}`}
                >
                  <div className="relative aspect-square">
                    <img
                      src={item.images[0]}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-1 left-1 bg-black/80 text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                      ¥{item.price.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-1.5 text-xs text-gray-200 truncate">{item.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* If No Query: Show Search History */
        <div className="p-4 space-y-3 flex-1">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-gray-300">検索履歴</h2>
            {searchHistory.length > 0 && (
              <button
                onClick={clearSearchHistory}
                className="text-xs text-blue-400 hover:underline"
              >
                クリア
              </button>
            )}
          </div>

          <div className="space-y-1">
            {searchHistory.length === 0 ? (
              <p className="text-xs text-gray-500 italic py-2">検索履歴はありません。</p>
            ) : (
              searchHistory.map((q, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setSearchQuery(q);
                    addSearchHistory(q);
                  }}
                  className="flex items-center justify-between py-3 px-2 border-b border-[#2c2c2e] text-sm text-gray-200 hover:bg-[#1e1e1e] rounded-lg cursor-pointer transition-colors"
                >
                  <span>{q}</span>
                  <div className="flex items-center gap-2 text-gray-500">
                    <Heart className="w-4 h-4 hover:text-[#ff0211]" />
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
