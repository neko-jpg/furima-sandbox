import type { HomeTab } from '../types/mercari';

export const HOME_TABS: ReadonlyArray<{ tab: HomeTab; label: string }> = [
  { tab: 'recommend', label: 'おすすめ' },
  { tab: 'mylist', label: 'マイリスト' },
  { tab: 'auction', label: 'オークション' },
];
