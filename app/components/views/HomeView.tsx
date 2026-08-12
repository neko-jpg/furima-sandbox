'use client';

import React from 'react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { Flame, ArrowRight, Clock } from 'lucide-react';
import { Footer } from '../Footer';

export const HomeView: React.FC = () => {
  const { homeTab, setHomeTab, items, setSelectedItem } = useMercari();

  const normalItems = items.filter((i) => !i.isAuction);
  const auctionItems = items.filter((i) => i.isAuction);

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#121212] flex flex-col justify-between" data-testid="home-view">
      <div>
        {/* Sub Tabs Header */}
        <div className="sticky top-0 z-20 bg-[#1e1e1e] border-b border-[#2c2c2e] flex items-center justify-around text-sm font-medium">
          <button
            onClick={() => setHomeTab('recommend')}
            className={`py-3 px-4 flex-1 text-center transition-colors relative ${
              homeTab === 'recommend' ? 'text-[#ff0211] font-bold' : 'text-gray-300 hover:text-white'
            }`}
            data-testid="subtab-recommend"
          >
            おすすめ
            {homeTab === 'recommend' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff0211]"></span>
            )}
          </button>

          <button
            onClick={() => setHomeTab('mylist')}
            className={`py-3 px-4 flex-1 text-center transition-colors relative ${
              homeTab === 'mylist' ? 'text-[#ff0211] font-bold' : 'text-gray-300 hover:text-white'
            }`}
            data-testid="subtab-mylist"
          >
            マイリスト
            {homeTab === 'mylist' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff0211]"></span>
            )}
          </button>

          <button
            onClick={() => setHomeTab('auction')}
            className={`py-3 px-4 flex-1 text-center transition-colors relative ${
              homeTab === 'auction' ? 'text-[#ff0211] font-bold' : 'text-gray-300 hover:text-white'
            }`}
            data-testid="subtab-auction"
          >
            オークション
            {homeTab === 'auction' && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#ff0211]"></span>
            )}
          </button>
        </div>

        {/* Promotional Green Banner */}
        <div className="p-3">
          <div className="bg-gradient-to-r from-[#00c853] to-[#00e676] text-white p-3.5 rounded-xl flex items-center justify-between shadow-md relative overflow-hidden">
            <div className="z-10">
              <span className="bg-[#ff0211] text-[10px] font-bold px-2 py-0.5 rounded-full text-white inline-block mb-1">
                さらに初めての方限定！
              </span>
              <div className="font-extrabold text-sm md:text-base leading-tight">
                LINE友だち追加＆ID連携で
              </div>
              <div className="text-xl md:text-2xl font-black text-yellow-300 drop-shadow-sm">
                5% OFF クーポン<span className="text-xs text-white font-normal ml-1">もらえる！</span>
              </div>
            </div>
            <div className="text-3xl font-black opacity-20 select-none">MERCARI</div>
          </div>
        </div>

        {/* Recommend Tab Content */}
        {homeTab === 'recommend' && (
          <div className="space-y-6 px-3 pb-6">
            {/* Liked Items Section */}
            <div>
              <div className="flex items-center justify-between py-2">
                <h2 className="font-bold text-base text-white">いいね！した商品</h2>
                <button className="text-xs text-blue-400 hover:underline flex items-center gap-0.5">
                  すべて見る <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {normalItems.slice(0, 4).map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>

            {/* PC Section */}
            <div>
              <div className="flex items-center justify-between py-2">
                <h2 className="font-bold text-base text-white">MSI - ゲーミングPC</h2>
                <span className="text-xs text-gray-400">...</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {normalItems.slice(4).map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mylist Tab Content */}
        {homeTab === 'mylist' && (
          <div className="space-y-6 px-3 pb-6">
            <div className="border-b border-[#2c2c2e] pb-4">
              <h2 className="font-bold text-base text-white py-2">保存した検索条件</h2>
              <p className="text-sm text-gray-400 py-1">保存している検索条件はありません</p>
              <button className="text-xs text-blue-400 hover:underline mt-1 flex items-center gap-1">
                検索条件の保存について <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between py-2">
                <h2 className="font-bold text-base text-white">最近閲覧した商品</h2>
                <button className="text-xs text-blue-400 hover:underline flex items-center gap-0.5">
                  すべて見る <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {items.slice(0, 6).map((item) => (
                  <ItemCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Auction Tab Content */}
        {homeTab === 'auction' && (
          <div className="space-y-6 px-3 pb-6">
            <div>
              <div className="flex items-center gap-1.5 py-2">
                <Flame className="w-5 h-5 text-[#ff0211]" />
                <h2 className="font-extrabold text-base text-white">Hot!!なオークション</h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {auctionItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="bg-[#1e1e1e] rounded-xl overflow-hidden border border-[#2c2c2e] hover:border-gray-500 transition-all cursor-pointer flex flex-col"
                    data-testid={`auction-card-${item.id}`}
                  >
                    <div className="relative aspect-square">
                      <img
                        src={item.images[0]}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full text-xs font-bold text-white flex items-center gap-1">
                        🏷️ {item.bidsCount || 1}
                      </div>
                    </div>

                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="text-[11px] text-gray-400">現在の最高入札</div>
                        <div className="text-lg font-black text-white">
                          ¥{item.price.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-[#ff0211] font-medium mt-0.5">
                          <Clock className="w-3 h-3" /> {item.timeLeft || '残り1日'}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                        }}
                        className="mt-3 w-full bg-[#ff0211] hover:bg-[#e5020f] text-white text-xs font-bold py-2.5 rounded-lg transition-colors text-center"
                        data-testid={`bid-btn-${item.id}`}
                      >
                        入札する
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="font-bold text-base text-white py-2">最初の入札をしてみよう！</h2>
              <div className="grid grid-cols-3 gap-2.5">
                {normalItems.slice(0, 3).map((item) => (
                  <ItemCard key={item.id} item={{ ...item, isAuction: true, currentBid: item.price }} onClick={() => setSelectedItem(item)} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Accordion & Copyright */}
      <Footer />
    </div>
  );
};

interface ItemCardProps {
  item: MercariItem;
  onClick: () => void;
}

const ItemCard: React.FC<ItemCardProps> = ({ item, onClick }) => {
  return (
    <div
      onClick={onClick}
      className="group relative bg-[#1e1e1e] rounded-lg overflow-hidden border border-[#2c2c2e] hover:border-gray-500 transition-all cursor-pointer shadow-sm flex flex-col"
      data-testid={`item-card-${item.id}`}
    >
      <div className="relative aspect-square w-full bg-[#2a2a2d]">
        <img
          src={item.images[0]}
          alt={item.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />

        {/* Price Badge */}
        <div className="absolute bottom-1 left-1 bg-black/80 backdrop-blur-xs text-white text-xs font-black px-1.5 py-0.5 rounded">
          ¥{item.price.toLocaleString()}
        </div>

        {/* SOLD Banner */}
        {item.isSold && (
          <div className="absolute top-0 left-0 bg-[#ff0211] text-white text-[10px] font-black px-2 py-0.5 tracking-wider shadow-sm transform -rotate-12 translate-y-1 -translate-x-1">
            SOLD
          </div>
        )}
      </div>

      <div className="p-2 flex-1 flex flex-col justify-between">
        <h3 className="text-xs text-gray-200 line-clamp-2 leading-snug font-medium">
          {item.title}
        </h3>
      </div>
    </div>
  );
};
