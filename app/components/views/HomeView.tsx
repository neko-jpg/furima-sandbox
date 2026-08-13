'use client';

import React from 'react';
import { ArrowRight, Camera, Clock3, Flame, Heart, Search, ShoppingBag } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { MercariItem } from '../../types/mercari';
import { Footer } from '../Footer';
import { ProductCard, SectionHeader } from '../ui/ShopPrimitives';
import { MyListView } from './MyListView';

export const HomeView: React.FC = () => {
  const { homeTab, setHomeTab, items, openItem, setLiked, setIsSearchOpen, setSearchQuery, openCategory, isDeviceFrame } = useMercari();
  const { isAuthenticated } = useMercari();
  const allNormalItems = items.filter((item) => !item.isAuction);
  const normalItems = allNormalItems;
  const auctionItems = items.filter((item) => item.isAuction);
  const likedItems = normalItems.filter((item) => item.isLiked);
  const pcItems = normalItems.filter((item) => item.category.some((category) => category.includes('PC') || category.includes('パソコン') || category.includes('タブレット'))).slice(0, 10);
  const fashionItems = normalItems.filter((item) => item.category.some((category) => category.includes('レディース') || category.includes('メンズ') || category.includes('ファッション'))).slice(0, 10);
  const bookItems = normalItems.filter((item) => item.category.some((category) => category.includes('本'))).slice(0, 10);
  const rankingItems = [...normalItems].sort((a, b) => b.likesCount - a.likesCount).slice(0, 10);
  const popularItems = normalItems.filter((item) => !item.isLiked).slice(0, 10);
  const openSearchFor = (query: string) => {
    setSearchQuery(query);
    setIsSearchOpen(true);
  };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="home-view">
      <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 md:px-7 lg:px-9">
        <div className={`${isDeviceFrame ? '' : 'md:hidden'} sticky top-0 z-20 -mx-4 border-b border-[var(--shop-border)] bg-[rgba(31,31,33,.93)] px-4 backdrop-blur-xl md:-mx-7 md:px-7 lg:-mx-9 lg:px-9`}>
          <div className="flex h-12 items-center gap-1 overflow-x-auto no-scrollbar md:h-14" role="tablist" aria-label="商品カテゴリ">
            {([
              ['recommend', 'おすすめ'],
              ['mylist', 'マイリスト'],
              ['auction', 'オークション'],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={homeTab === tab}
                onClick={() => setHomeTab(tab)}
                className={`relative h-full shrink-0 px-5 text-sm transition-colors md:px-7 ${homeTab === tab ? 'font-bold text-[var(--shop-accent)]' : 'text-[var(--shop-muted)] hover:text-white'}`}
                data-testid={`subtab-${tab}`}
              >
                {label}
                {homeTab === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--shop-accent)]" />}
              </button>
            ))}
          </div>
        </div>

        {homeTab === 'recommend' && <ShopPromo />}

        {homeTab === 'recommend' && (isAuthenticated ? (
          <div className="space-y-10">
            <ProductSection
              title="いいねした商品"
              items={likedItems.slice(0, 5)}
              onOpen={openItem}
              onLike={setLiked}
              onAction={() => setHomeTab('mylist')}
              emptyText="気になる商品をいいねすると、ここに表示されます。"
            />
            <ProductSection title="Furima Sandboxで人気の商品" items={popularItems} onOpen={openItem} onLike={setLiked} onAction={() => openSearchFor('人気')} />
            <ProductSection title="MSI・ゲーミングPC" items={pcItems} onOpen={openItem} onLike={setLiked} onAction={() => openCategory('PC')} />
            <ProductSection title="新着の商品" items={normalItems.slice(0, 10)} onOpen={openItem} onLike={setLiked} onAction={() => openSearchFor('')} />
            <ProductSection title="ファッションから探す" items={fashionItems} onOpen={openItem} onLike={setLiked} onAction={() => openCategory('ファッション')} />
            <ProductSection title="本・マンガのおすすめ" items={bookItems} onOpen={openItem} onLike={setLiked} onAction={() => openCategory('本')} />
            <RankingSection items={rankingItems} onOpen={openItem} onAction={() => openSearchFor('')} />
          </div>
          ) : <GuestHome items={normalItems} onOpen={openItem} onLike={setLiked} />)}

        {homeTab === 'mylist' && <MyListView />}

        {homeTab === 'auction' && <AuctionHome items={auctionItems} recommended={auctionItems} onOpen={openItem} onLike={setLiked} />}
      </div>
      <Footer />
    </div>
  );
};

const GuestHome: React.FC<{ items: MercariItem[]; onOpen: (id: string) => void; onLike: (id: string, liked: boolean) => unknown }> = ({ items, onOpen, onLike }) => {
  const { openCategory, openItem } = useMercari();
  const guestItems = items.map((item) => item.isLiked ? { ...item, isLiked: false } : item);
  const starterItems = [...guestItems.filter((item) => item.price <= 500), ...guestItems.filter((item) => item.price > 500)].slice(0, 10);
  const categories = ['ファッション', 'ベビー・キッズ', 'ゲーム・おもちゃ・グッズ', '本・雑誌・漫画', 'スマホ・タブレット・パソコン', '家具・インテリア'];
  const brandItems = guestItems.slice(0, 5);
  return <div className="space-y-10">
    <ProductSection title="掘り出しもの ¥300スタート" items={starterItems} onOpen={onOpen} onLike={onLike} onAction={() => openCategory('オークション')} />
    <ProductSection title="人気の商品" items={guestItems.slice(0, 10)} onOpen={onOpen} onLike={onLike} onAction={() => openCategory('人気の商品')} />
    <section>
      <SectionHeader title="人気のブランド" actionLabel="すべて見る" onAction={() => openCategory('ブランド')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">{brandItems.map((item) => <button type="button" key={item.id} onClick={() => openItem(item.id)} className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-3 text-left hover:border-[var(--shop-blue)]"><div className="flex items-center gap-2"><img src={item.images[0]} alt="" className="h-10 w-10 rounded-full object-cover" /><span className="line-clamp-2 text-xs font-bold text-white">{item.seller.name}</span></div></button>)}</div>
    </section>
    <section>
      <SectionHeader title="人気のカテゴリー" actionLabel="すべて見る" onAction={() => openCategory('すべてのカテゴリ')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">{categories.map((category) => <button type="button" key={category} onClick={() => openCategory(category)} className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] px-3 py-5 text-center text-xs font-bold text-white hover:border-[var(--shop-blue)]">{category}</button>)}</div>
    </section>
    <ProductSection title="新着の商品" items={guestItems.slice(0, 10)} onOpen={onOpen} onLike={onLike} />
  </div>;
};

const ShopPromo: React.FC = () => {
  const { setSearchQuery, setIsSearchOpen, openItem, navigateToTab, items } = useMercari();
  const demoItems = items.filter((item) => item.isDemo);
  const availableDemoItems = demoItems.filter((item) => !item.isSold);
  const familyCount = new Set(demoItems.map((item) => item.productFamilyId).filter(Boolean)).size;
  const variantCount = new Set(demoItems.map((item) => item.variantId).filter(Boolean)).size;
  return (
    <section className="my-4 overflow-hidden rounded-2xl border border-[var(--shop-border)] bg-gradient-to-br from-[#303036] via-[var(--shop-surface)] to-[#25252a] p-4 shadow-[0_12px_28px_rgba(0,0,0,.18)] md:mb-7 md:mt-0 md:p-5" aria-label="Furima Sandboxのクイックスタート">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--shop-blue)]/35 bg-[#143247] px-2.5 py-1 text-[10px] font-black tracking-[.08em] text-[var(--shop-blue)]">FURIMA SANDBOX / QUICK START</div>
          <h1 className="text-xl font-black tracking-tight text-white md:text-2xl">検索から購入・出品まで、同じ画面で試せます</h1>
          <p className="mt-1.5 text-xs leading-5 text-[var(--shop-muted)] md:text-sm">これはハッカソン用の操作サンドボックスです。下のショートカットなら、エージェント操作とUI操作の結果をすぐに見比べられます。</p>
        </div>
        <div className="hidden rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-right text-[11px] text-[var(--shop-muted)] md:block"><span className="block font-bold text-white">安全なデモ環境</span><span>決済・配送・出品は実行されません</span></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 sm:grid-cols-5" aria-label="デモカタログの状態">
        <div><span className="block text-[10px] text-[var(--shop-muted)]">デモ出品</span><strong className="mt-0.5 block text-sm font-black text-white">{demoItems.length.toLocaleString()}件</strong></div>
        <div><span className="block text-[10px] text-[var(--shop-muted)]">販売中</span><strong className="mt-0.5 block text-sm font-black text-[var(--shop-blue)]">{availableDemoItems.length.toLocaleString()}件</strong></div>
        <div><span className="block text-[10px] text-[var(--shop-muted)]">商品ファミリー</span><strong className="mt-0.5 block text-sm font-black text-white">{familyCount.toLocaleString()}種</strong></div>
        <div><span className="block text-[10px] text-[var(--shop-muted)]">バリエーション</span><strong className="mt-0.5 block text-sm font-black text-white">{variantCount.toLocaleString()}種</strong></div>
        <div><span className="block text-[10px] text-[var(--shop-muted)]">画像つき</span><strong className="mt-0.5 block text-sm font-black text-white">{demoItems.length.toLocaleString()}枚</strong></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={() => { setSearchQuery('ノートPC'); setIsSearchOpen(true); }} className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[#202024]/80 p-3 text-left transition-colors hover:border-[var(--shop-blue)] hover:bg-[#16394d]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#153247] text-[var(--shop-blue)]"><Search className="h-4 w-4" /></span><span><span className="block text-xs font-black text-white">1. ノートPCを検索</span><span className="mt-0.5 block text-[10px] text-[var(--shop-muted)]">フィルタと件数の変化を見る</span></span>
        </button>
        <button type="button" onClick={() => openItem('pc-2')} className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[#202024]/80 p-3 text-left transition-colors hover:border-[var(--shop-blue)] hover:bg-[#16394d]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#153247] text-[var(--shop-blue)]"><ShoppingBag className="h-4 w-4" /></span><span><span className="block text-xs font-black text-white">2. 商品詳細を確認</span><span className="mt-0.5 block text-[10px] text-[var(--shop-muted)]">安心情報と購入内訳を見る</span></span>
        </button>
        <button type="button" onClick={() => navigateToTab('sell')} className="flex items-center gap-3 rounded-xl border border-[var(--shop-border)] bg-[#202024]/80 p-3 text-left transition-colors hover:border-[var(--shop-blue)] hover:bg-[#16394d]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#153247] text-[var(--shop-blue)]"><Camera className="h-4 w-4" /></span><span><span className="block text-xs font-black text-white">3. 出品をシミュレート</span><span className="mt-0.5 block text-[10px] text-[var(--shop-muted)]">AI候補・審査・収支を確認</span></span>
        </button>
      </div>
    </section>
  );
};

interface ProductSectionProps {
  title: string;
  items: MercariItem[];
  onOpen: (id: string) => void;
  onLike: (id: string, liked: boolean) => unknown;
  onAction?: () => void;
  emptyText?: string;
}

const ProductSection: React.FC<ProductSectionProps> = ({ title, items, onOpen, onLike, onAction, emptyText }) => {
  const { isDeviceFrame } = useMercari();
  return <section>
    <SectionHeader title={title} onAction={onAction} />
    {items.length === 0 ? (
      <div className="rounded-lg border border-dashed border-[var(--shop-border)] px-4 py-8 text-center text-sm text-[var(--shop-muted)]">{emptyText || '表示できる商品はありません。'}</div>
    ) : (
      <div className={`grid grid-cols-3 gap-1.5 ${isDeviceFrame ? '' : 'sm:gap-2.5 md:grid-cols-4 md:gap-4 lg:grid-cols-5 lg:gap-6 lg:pt-5'}`}>
        {items.map((item) => <ProductCard key={item.id} item={item} compact={isDeviceFrame} onOpen={() => onOpen(item.id)} onLike={(liked) => onLike(item.id, liked)} />)}
      </div>
    )}
  </section>;
};

const RankingSection: React.FC<{ items: MercariItem[]; onOpen: (id: string) => void; onAction?: () => void }> = ({ items, onOpen, onAction }) => (
  <section>
    <SectionHeader title="最近の価格上昇ランキング" actionLabel="ランキングを見る" onAction={onAction} />
    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
      {items.slice(0, 7).map((item, index) => (
        <button type="button" key={item.id} onClick={() => onOpen(item.id)} className="relative w-[138px] shrink-0 overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] p-2 text-left md:w-[170px]">
          <span className={`absolute left-2 top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-black ${index === 0 ? 'bg-[#b58d29] text-white' : index === 1 ? 'bg-[#6d737b] text-white' : index === 2 ? 'bg-[#9a5c2f] text-white' : 'bg-[var(--shop-surface-raised)] text-[var(--shop-muted)]'}`}>{index + 1}</span>
          <img src={item.images[0]} alt={item.title} className="aspect-square w-full rounded-md object-cover" loading="lazy" />
          <p className="mt-2 line-clamp-1 text-[10px] text-[var(--shop-muted)]">{item.title}</p>
          <p className="mt-0.5 text-sm font-black text-white">¥{item.price.toLocaleString()}</p>
          <p className="text-[9px] text-[var(--shop-subtle)]">いいね {item.likesCount}</p>
        </button>
      ))}
    </div>
  </section>
);

const AuctionHome: React.FC<{ items: MercariItem[]; recommended: MercariItem[]; onOpen: (id: string) => void; onLike: (id: string, liked: boolean) => unknown }> = ({ items, recommended, onOpen, onLike }) => {
  const [activeCategory, setActiveCategory] = React.useState('すべて');
  const categories = ['すべて', 'ゲーム・おもちゃ・グッズ', 'レディース', 'メンズ', '本・雑誌・漫画'];
  const filteredItems = activeCategory === 'すべて' ? items : items.filter((item) => item.category.some((value) => value.includes(activeCategory) || (activeCategory === 'ゲーム・おもちゃ・グッズ' && value.includes('ゲーム・おもちゃ'))));
  return <div className="space-y-10">
    <section>
      <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-bold text-white md:text-lg"><Flame className="h-5 w-5 text-[var(--shop-accent)]" />注目のオークション</h2><button type="button" className="rounded-full bg-[var(--shop-surface-raised)] p-2 text-white" aria-label="オークションをもっと見る"><ArrowRight className="h-4 w-4" /></button></div>
      <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">{items.map((item) => <AuctionCard key={item.id} item={item} onOpen={() => onOpen(item.id)} />)}</div>
    </section>
    <ProductSection title="最初の入札をしてみよう！" items={recommended} onOpen={onOpen} onLike={onLike} />
    <AuctionCategorySection items={filteredItems} categories={categories} activeCategory={activeCategory} onCategory={setActiveCategory} onOpen={onOpen} />
    <ProductSection title="あなたへのおすすめ" items={recommended} onOpen={onOpen} onLike={onLike} />
    <ProductSection title="新着オークション" items={items} onOpen={onOpen} onLike={onLike} />
  </div>;
};

const AuctionCategorySection: React.FC<{ items: MercariItem[]; categories: string[]; activeCategory: string; onCategory: (category: string) => void; onOpen: (id: string) => void }> = ({ items, categories, activeCategory, onCategory, onOpen }) => {
  return <section><SectionHeader title="カテゴリ別オークション" /><div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">{categories.map((category) => <button type="button" key={category} onClick={() => onCategory(category)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] ${activeCategory === category ? 'border-[var(--shop-blue)] bg-[#16394d] text-[var(--shop-blue)]' : 'border-[var(--shop-border)] text-[var(--shop-muted)] hover:border-[var(--shop-blue)] hover:text-[var(--shop-blue)]'}`}>{category}</button>)}</div><div className="grid grid-cols-3 gap-2.5 md:grid-cols-5">{items.slice(0, 10).map((item) => <AuctionGridCard key={item.id} item={item} onOpen={() => onOpen(item.id)} />)}</div></section>;
};

const AuctionGridCard: React.FC<{ item: MercariItem; onOpen: () => void }> = ({ item, onOpen }) => <button type="button" onClick={onOpen} className="relative overflow-hidden rounded-lg border border-[var(--shop-border)] bg-[var(--shop-surface)] text-left"><div className="relative aspect-square"><img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" loading="lazy" /><span className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-bold text-white">現在 ¥{(item.currentBid ?? item.price).toLocaleString()}</span><Heart className="absolute right-1 top-1 h-4 w-4 text-white" /></div><div className="px-2 py-1.5 text-[9px] text-[var(--shop-muted)]">入札 {item.bidsCount ?? 0} ・ {item.timeLeft || '残り1日'}</div></button>;

const AuctionCardLegacy: React.FC<{ item: MercariItem; onOpen: () => void }> = ({ item, onOpen }) => (
  <article className="w-[190px] shrink-0 overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] md:w-[240px]">
    <button type="button" onClick={onOpen} className="w-full text-left"><div className="relative aspect-[1.12] overflow-hidden"><img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" loading="lazy" /><span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-bold text-white">入札 {item.bidsCount || 0}</span><span className="absolute inset-x-2 bottom-2 rounded-md bg-black/75 px-2 py-1 text-[10px] text-white">現在の最高入札額</span></div><div className="p-3"><div className="text-xl font-black text-white">¥{(item.currentBid ?? item.price).toLocaleString()}</div><div className="mt-1 flex items-center gap-1 text-xs text-[var(--shop-accent)]"><Clock3 className="h-3.5 w-3.5" />{item.timeLeft || '残り1日'}</div></div></button>
    <button type="button" onClick={onOpen} className="mx-3 mb-3 block w-[calc(100%-24px)] rounded-full bg-[var(--shop-accent)] py-2.5 text-sm font-bold text-white">入札する</button>
  </article>
);

void AuctionCardLegacy;

const AuctionCard: React.FC<{ item: MercariItem; onOpen: () => void }> = ({ item, onOpen }) => {
  const { startPurchase } = useMercari();
  return <article className="w-[190px] shrink-0 overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] md:w-[240px]">
    <button type="button" onClick={onOpen} className="w-full text-left"><div className="relative aspect-[1.12] overflow-hidden"><img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" loading="lazy" /><span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-xs font-bold text-white">入札 {item.bidsCount || 0}</span><span className="absolute inset-x-2 bottom-2 rounded-md bg-black/75 px-2 py-1 text-[10px] text-white">現在の最高入札額</span></div><div className="p-3"><div className="text-xl font-black text-white">¥{(item.currentBid ?? item.price).toLocaleString()}</div><div className="mt-1 flex items-center gap-1 text-xs text-[var(--shop-accent)]"><Clock3 className="h-3.5 w-3.5" />{item.timeLeft || '残り1日'}</div></div></button>
    <button type="button" onClick={() => startPurchase(item.id)} className="mx-3 mb-3 block w-[calc(100%-24px)] rounded-full bg-[var(--shop-accent)] py-2.5 text-sm font-bold text-white">入札する</button>
  </article>;
};
