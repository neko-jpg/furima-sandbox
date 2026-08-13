import type { ProductFamily, ProductVariant } from '../types/mercari';

// The large product catalog is loaded after the shell. The listing form only
// needs this compact, stable taxonomy to render its selectors immediately.
export const CATALOG_FAMILIES: ProductFamily[] = [
  { id: 'audio-headphone', name: 'ヘッドホン', productType: 'ヘッドホン', category: '家電・スマホ' },
  { id: 'audio-speaker', name: 'スピーカー', productType: 'スピーカー', category: '家電・スマホ' },
  { id: 'audio-earbuds', name: 'ワイヤレスイヤホン', productType: 'イヤホン', category: '家電・スマホ' },
  { id: 'phone-standard', name: 'スマートフォン', productType: 'スマートフォン', category: '家電・スマホ' },
  { id: 'pc-notebook', name: 'ノートPC', productType: 'ノートPC', category: '家電・スマホ' },
  { id: 'camera-mirrorless', name: 'ミラーレスカメラ', productType: 'デジタルカメラ', category: '家電・スマホ' },
  { id: 'furniture-table', name: 'テーブル', productType: 'テーブル', category: 'インテリア・住まい・小物' },
  { id: 'furniture-chair', name: 'チェア・椅子', productType: 'チェア', category: 'インテリア・住まい・小物' },
  { id: 'furniture-storage', name: '収納家具', productType: '収納', category: 'インテリア・住まい・小物' },
  { id: 'bag-shoulder', name: 'ショルダーバッグ', productType: 'バッグ', category: 'レディース' },
  { id: 'bag-backpack', name: 'リュック・バックパック', productType: 'バッグ', category: 'レディース' },
  { id: 'shoes-sneaker', name: 'スニーカー', productType: 'スニーカー', category: 'メンズ' },
  { id: 'book-novel', name: '小説・読み物', productType: '本・雑誌', category: '本・マンガ' },
  { id: 'game-console', name: 'ゲーム機本体', productType: 'ゲーム機', category: 'ゲーム・おもちゃ・グッズ' },
  { id: 'collection-figure', name: 'フィギュア・模型', productType: 'コレクション', category: 'ホビー' },
  { id: 'sports-outdoor', name: 'アウトドア用品', productType: 'アウトドア用品', category: 'スポーツ・レジャー' },
];

const variant = (id: string, familyId: string, name: string, attributes: Record<string, string>): ProductVariant => ({
  id,
  familyId,
  name,
  attributes,
  searchTags: [name, ...Object.values(attributes)],
});

export const CATALOG_VARIANTS: ProductVariant[] = [
  variant('audio-headphone-monitor', 'audio-headphone', 'モニターモデル', { 接続: '有線', 用途: '制作・編集', カラー: 'ブラック' }),
  variant('audio-speaker-portable', 'audio-speaker', 'ポータブルモデル', { 接続: 'Bluetooth', 用途: '屋内・屋外', カラー: 'グレー' }),
  variant('audio-earbuds-basic', 'audio-earbuds', 'ベーシックモデル', { 接続: 'Bluetooth', 用途: '通勤・通学', カラー: 'ブラック' }),
  variant('phone-standard-compact', 'phone-standard', 'コンパクトモデル', { 容量: '128GB', 用途: '日常・旅行', カラー: 'ホワイト' }),
  variant('pc-notebook-standard', 'pc-notebook', 'スタンダードモデル', { 画面サイズ: '14〜15インチ', 用途: '仕事・学習', カラー: 'ブラック' }),
  variant('camera-mirrorless-entry', 'camera-mirrorless', 'エントリーモデル', { 用途: '日常・旅行', サイズ: '標準', カラー: 'ブラック' }),
  variant('furniture-table-desk', 'furniture-table', 'デスク', { 用途: '仕事・学習', 素材: '木製', カラー: 'ブラウン' }),
  variant('furniture-chair-work', 'furniture-chair', 'ワークチェア', { 用途: '仕事・学習', 素材: 'ファブリック', カラー: 'グレー' }),
  variant('furniture-storage-shelf', 'furniture-storage', 'シェルフ・ラック', { 用途: '収納', 素材: '木製', カラー: 'ブラウン' }),
  variant('bag-shoulder-canvas', 'bag-shoulder', 'キャンバス', { 用途: '普段使い', 素材: 'キャンバス', カラー: 'ベージュ' }),
  variant('bag-backpack-travel', 'bag-backpack', '旅行向け', { 用途: '旅行・アウトドア', 素材: 'ナイロン', カラー: 'グレー' }),
  variant('shoes-sneaker-standard', 'shoes-sneaker', '定番モデル', { 用途: '普段使い', サイズ: '26cm', カラー: 'ホワイト' }),
  variant('book-novel-magazine', 'book-novel', '雑誌・ムック', { ジャンル: '雑誌', 用途: '情報収集', 版: '通常版' }),
  variant('game-console-standard', 'game-console', 'スタンダードモデル', { 用途: 'ゲーム', 世代: '現行', カラー: 'ブラック' }),
  variant('collection-figure-character', 'collection-figure', 'キャラクターモデル', { 用途: 'コレクション', 素材: 'PVC', カラー: 'マルチカラー' }),
  variant('sports-outdoor-camp', 'sports-outdoor', 'キャンプ向け', { 用途: 'アウトドア', 素材: 'アルミ', カラー: 'ブラック' }),
];
