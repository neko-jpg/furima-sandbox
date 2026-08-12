'use client';

import React from 'react';
import { ChevronRight, CreditCard, FileText, HelpCircle, Heart, History, PackageCheck, Settings, ShieldCheck, ShoppingBag, Users, X } from 'lucide-react';
import { useMercari } from '../../context/MercariContext';
import { Footer } from '../Footer';

export const MyPageView: React.FC = () => {
  const { user, items, navigateToTab, setHomeTab, isDeviceFrame } = useMercari();
  const likedCount = items.filter((item) => item.isLiked).length;
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const goToMyList = () => { navigateToTab('home'); setHomeTab('mylist'); };

  return (
    <div className="shop-scrollbar flex-1 overflow-y-auto bg-[var(--shop-bg)]" data-testid="mypage-view">
      <div className="mx-auto max-w-[1080px] px-4 pb-10 md:px-7">
        <div className="border-b border-[var(--shop-border)] py-5"><h1 className="text-lg font-black text-white">マイページ</h1></div>
        <div className={`grid gap-5 py-5 ${isDeviceFrame ? '' : 'lg:grid-cols-[300px_1fr]'}`}>
          <aside className="space-y-4">
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><div className="flex items-center gap-3"><img src={user.avatar} alt={user.name} className="h-14 w-14 rounded-full object-cover" /><div><p className="font-bold text-white">{user.name}<ChevronRight className="ml-1 inline h-4 w-4 text-[var(--shop-muted)]" /></p><p className="mt-1 text-xs text-[var(--shop-warning)]">★ {user.rating.toFixed(1)}（{user.ratingsCount}）</p></div></div><div className="mt-4 flex items-center gap-2 text-xs font-bold text-[var(--shop-success)]"><ShieldCheck className="h-4 w-4" />本人確認済み</div></div>
            <div className="rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5"><p className="text-xs text-[var(--shop-muted)]">売上金</p><p className="mt-1 text-2xl font-black text-white">¥{user.salesBalance.toLocaleString()}</p><div className="mt-4 border-t border-[var(--shop-border)] pt-4"><p className="text-xs text-[var(--shop-muted)]">ポイント</p><p className="mt-1 font-bold text-white">P {user.points}</p><p className="mt-2 text-xs font-bold text-[var(--shop-success)]">{user.hasDPointLinked ? 'ポイント連携済み' : 'ポイントを連携する'}</p></div></div>
          </aside>
          <div className="space-y-5">
            <ManagementGroup title="商品管理"><ManagementButton icon={<Heart className="text-[var(--shop-accent)]" />} label="いいねした商品" value={String(likedCount)} onClick={goToMyList} /><ManagementButton icon={<History className="text-[var(--shop-blue)]" />} label="閲覧履歴" onClick={goToMyList} /><ManagementButton icon={<Users className="text-[var(--shop-success)]" />} label="フォローリスト" onClick={() => setActiveMenu('フォローリスト')} /><ManagementButton icon={<PackageCheck className="text-[var(--shop-warning)]" />} label="出品した商品" onClick={() => setActiveMenu('出品した商品')} /><ManagementButton icon={<ShoppingBag className="text-purple-400" />} label="購入した商品" onClick={() => setActiveMenu('購入した商品')} /><ManagementButton icon={<FileText className="text-[var(--shop-muted)]" />} label="下書き一覧" onClick={() => setActiveMenu('下書き一覧')} /></ManagementGroup>
            <ManagementGroup title="設定・ヘルプ"><ManagementButton icon={<CreditCard className="text-[var(--shop-muted)]" />} label="支払い方法" onClick={() => setActiveMenu('支払い方法')} /><ManagementButton icon={<Settings className="text-[var(--shop-muted)]" />} label="アカウント設定" onClick={() => setActiveMenu('アカウント設定')} /><ManagementButton icon={<HelpCircle className="text-[var(--shop-muted)]" />} label="ヘルプ・ガイド" onClick={() => setActiveMenu('ヘルプ・ガイド')} /></ManagementGroup>
      </div>
      {activeMenu && <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${activeMenu}の詳細`}><div className="w-full max-w-md rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-black text-white">{activeMenu}</h2><button type="button" onClick={() => setActiveMenu(null)} aria-label="詳細を閉じる" className="rounded-full p-1 text-[var(--shop-muted)] hover:bg-[var(--shop-surface-raised)]"><X className="h-5 w-5" /></button></div><p className="mt-5 rounded-lg bg-[var(--shop-surface-raised)] p-4 text-sm leading-6 text-[var(--shop-muted)]">この画面はMercari AI Agent Hackathon for PM用のモックです。実際のアカウントや決済情報は変更せず、画面遷移と操作感だけを体験できます。</p><button type="button" onClick={() => setActiveMenu(null)} className="mt-5 w-full rounded-lg bg-[var(--shop-accent)] py-3 text-sm font-black text-white">閉じる</button></div></div>}
    </div>
      </div>
      <Footer />
    </div>
  );
};

const ManagementGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <section><h2 className="mb-2 text-sm font-bold text-white">{title}</h2><div className="divide-y divide-[var(--shop-border)] overflow-hidden rounded-xl border border-[var(--shop-border)] bg-[var(--shop-surface)]">{children}</div></section>;
const ManagementButton: React.FC<{ icon: React.ReactNode; label: string; value?: string; onClick?: () => void }> = ({ icon, label, value, onClick }) => <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-4 py-4 text-left text-sm text-white transition-colors hover:bg-[var(--shop-surface-raised)]"><span className="flex items-center gap-3">{icon}{label}</span><span className="flex items-center gap-2 text-xs text-[var(--shop-muted)]">{value}<ChevronRight className="h-4 w-4" /></span></button>;
