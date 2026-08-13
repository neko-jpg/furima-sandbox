"""Generate deterministic MercariItem records from the selected image manifest."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public/images/products/pexels-selected/manifest.json"
OUTPUT = ROOT / "app/data/catalogData.ts"

LABELS = {
    "PC・タブレット": "ノートPC・タブレット",
    "スマートフォン": "スマートフォン",
    "オーディオ": "オーディオ機器",
    "カメラ": "カメラ・撮影機器",
    "生活家電": "生活家電",
    "照明": "照明・ライト",
    "家具": "家具",
    "インテリア": "インテリア雑貨",
    "トップス": "トップス",
    "バッグ": "バッグ",
    "靴": "シューズ",
    "靴・アクセサリー": "シューズ・アクセサリー",
    "ゲーム": "ゲーム機・ゲーム周辺機器",
    "おもちゃ": "おもちゃ・ゲームグッズ",
    "コレクション": "コレクション・ホビー",
    "本・雑誌": "本・雑誌・文具",
    "調理器具": "キッチン用品・調理器具",
    "スポーツ用品": "スポーツ用品",
    "子ども用品": "ベビー・キッズ用品",
}

# These are sandbox product families, not claims about the pictured object.
# Several listings can share a family/variant while still having their own SKU,
# seller, condition, and stock record, which mirrors the separation used by a
# real marketplace catalog.
VARIANT_CATALOG = {
    "PC・タブレット": [
        {"id": "pc-notebook", "name": "ノートPC", "type": "ノートPC", "variants": [
            {"id": "light", "name": "軽量モデル", "attributes": {"画面サイズ": "13〜14インチ", "用途": "持ち運び", "カラー": "シルバー"}, "tags": ["PC", "パソコン", "ノートパソコン", "軽量"]},
            {"id": "standard", "name": "スタンダードモデル", "attributes": {"画面サイズ": "14〜15インチ", "用途": "仕事・学習", "カラー": "ブラック"}, "tags": ["PC", "パソコン", "ノートパソコン", "仕事用"]},
            {"id": "creative", "name": "クリエイティブモデル", "attributes": {"画面サイズ": "15〜16インチ", "用途": "制作・編集", "カラー": "グレー"}, "tags": ["PC", "パソコン", "ノートパソコン", "動画編集"]},
        ]},
        {"id": "pc-tablet", "name": "タブレット", "type": "タブレット", "variants": [
            {"id": "compact", "name": "コンパクトモデル", "attributes": {"画面サイズ": "8〜10インチ", "用途": "読書・動画", "カラー": "ホワイト"}, "tags": ["タブレット", "タブレットPC", "動画視聴", "読書"]},
            {"id": "large", "name": "大画面モデル", "attributes": {"画面サイズ": "11〜13インチ", "用途": "仕事・学習", "カラー": "グレー"}, "tags": ["タブレット", "タブレットPC", "大画面"]},
        ]},
        {"id": "pc-desktop", "name": "デスクトップPC", "type": "デスクトップPC", "variants": [
            {"id": "gaming", "name": "ゲーミングモデル", "attributes": {"用途": "ゲーム", "形状": "タワー型", "カラー": "ブラック"}, "tags": ["PC", "パソコン", "デスクトップ", "ゲーミングPC"]},
            {"id": "compact", "name": "省スペースモデル", "attributes": {"用途": "仕事・学習", "形状": "小型", "カラー": "ホワイト"}, "tags": ["PC", "パソコン", "デスクトップ", "省スペース"]},
        ]},
    ],
    "スマートフォン": [
        {"id": "phone-standard", "name": "スマートフォン", "type": "スマートフォン", "variants": [
            {"id": "standard", "name": "スタンダードモデル", "attributes": {"容量": "128GB", "用途": "普段使い", "カラー": "ブラック"}, "tags": ["スマホ", "携帯電話", "SIMフリー"]},
            {"id": "large-storage", "name": "大容量モデル", "attributes": {"容量": "256GB", "用途": "写真・動画", "カラー": "ブルー"}, "tags": ["スマホ", "携帯電話", "大容量"]},
            {"id": "compact", "name": "コンパクトモデル", "attributes": {"容量": "64GB", "用途": "軽量・普段使い", "カラー": "ホワイト"}, "tags": ["スマホ", "携帯電話", "小型"]},
        ]},
        {"id": "phone-accessory", "name": "スマートフォン周辺機器", "type": "スマホアクセサリー", "variants": [
            {"id": "case", "name": "ケース・カバー", "attributes": {"素材": "合成素材", "用途": "保護", "カラー": "ブラック"}, "tags": ["スマホケース", "カバー", "アクセサリー"]},
            {"id": "charger", "name": "充電アクセサリー", "attributes": {"接続": "USB-C", "用途": "充電", "カラー": "ホワイト"}, "tags": ["充電器", "ケーブル", "スマホアクセサリー"]},
        ]},
    ],
    "オーディオ": [
        {"id": "audio-earbuds", "name": "ワイヤレスイヤホン", "type": "イヤホン", "variants": [
            {"id": "basic", "name": "ベーシックモデル", "attributes": {"接続": "Bluetooth", "用途": "通勤・通学", "カラー": "ブラック"}, "tags": ["イヤホン", "Bluetooth", "ワイヤレス"]},
            {"id": "noise-cancel", "name": "ノイズキャンセリングモデル", "attributes": {"接続": "Bluetooth", "用途": "集中・移動", "カラー": "ホワイト"}, "tags": ["イヤホン", "Bluetooth", "ノイズキャンセリング"]},
        ]},
        {"id": "audio-headphone", "name": "ヘッドホン", "type": "ヘッドホン", "variants": [
            {"id": "over-ear", "name": "オーバーイヤー", "attributes": {"接続": "Bluetooth", "用途": "音楽鑑賞", "カラー": "ブラック"}, "tags": ["ヘッドホン", "Bluetooth", "音楽"]},
            {"id": "monitor", "name": "モニターモデル", "attributes": {"接続": "有線", "用途": "制作・編集", "カラー": "ブラック"}, "tags": ["ヘッドホン", "モニター", "有線"]},
        ]},
        {"id": "audio-speaker", "name": "スピーカー", "type": "スピーカー", "variants": [
            {"id": "portable", "name": "ポータブルモデル", "attributes": {"接続": "Bluetooth", "用途": "屋内・屋外", "カラー": "グレー"}, "tags": ["スピーカー", "Bluetooth", "ポータブル"]},
            {"id": "home", "name": "ホームオーディオ", "attributes": {"接続": "Bluetooth・有線", "用途": "リビング", "カラー": "ブラウン"}, "tags": ["スピーカー", "オーディオ", "リビング"]},
        ]},
    ],
    "カメラ": [
        {"id": "camera-mirrorless", "name": "ミラーレスカメラ", "type": "デジタルカメラ", "variants": [
            {"id": "entry", "name": "エントリーモデル", "attributes": {"用途": "日常・旅行", "サイズ": "標準", "カラー": "ブラック"}, "tags": ["カメラ", "ミラーレス", "写真"]},
            {"id": "creator", "name": "クリエイターモデル", "attributes": {"用途": "動画・制作", "サイズ": "標準", "カラー": "ブラック"}, "tags": ["カメラ", "ミラーレス", "動画撮影"]},
        ]},
        {"id": "camera-compact", "name": "コンパクトカメラ", "type": "コンパクトカメラ", "variants": [
            {"id": "travel", "name": "旅行向けモデル", "attributes": {"用途": "旅行・日常", "サイズ": "コンパクト", "カラー": "シルバー"}, "tags": ["カメラ", "コンパクト", "旅行"]},
            {"id": "vlog", "name": "Vlog向けモデル", "attributes": {"用途": "動画・日常", "サイズ": "コンパクト", "カラー": "ホワイト"}, "tags": ["カメラ", "コンパクト", "Vlog"]},
        ]},
        {"id": "camera-accessory", "name": "カメラ周辺機器", "type": "カメラアクセサリー", "variants": [
            {"id": "lens", "name": "レンズ・光学機器", "attributes": {"用途": "撮影", "サイズ": "標準", "カラー": "ブラック"}, "tags": ["カメラ", "レンズ", "撮影機材"]},
            {"id": "tripod", "name": "三脚・撮影用品", "attributes": {"用途": "撮影", "サイズ": "標準", "カラー": "ブラック"}, "tags": ["カメラ", "三脚", "撮影用品"]},
        ]},
    ],
    "生活家電": [
        {"id": "home-vacuum", "name": "掃除機", "type": "掃除機", "variants": [
            {"id": "stick", "name": "スティック型", "attributes": {"用途": "床掃除", "形状": "コードレス", "カラー": "ホワイト"}, "tags": ["掃除機", "コードレス", "家電"]},
            {"id": "robot", "name": "ロボット型", "attributes": {"用途": "自動掃除", "形状": "ロボット", "カラー": "ブラック"}, "tags": ["掃除機", "ロボット掃除機", "家電"]},
        ]},
        {"id": "home-air", "name": "空調・加湿家電", "type": "空調家電", "variants": [
            {"id": "humidifier", "name": "加湿モデル", "attributes": {"用途": "乾燥対策", "設置": "卓上", "カラー": "ホワイト"}, "tags": ["加湿器", "空調", "家電"]},
            {"id": "air-purifier", "name": "空気清浄モデル", "attributes": {"用途": "空気ケア", "設置": "床置き", "カラー": "ホワイト"}, "tags": ["空気清浄機", "空調", "家電"]},
        ]},
        {"id": "home-kitchen", "name": "小型生活家電", "type": "生活家電", "variants": [
            {"id": "compact", "name": "コンパクトモデル", "attributes": {"用途": "日常使い", "設置": "卓上", "カラー": "ブラック"}, "tags": ["生活家電", "小型家電", "家電"]},
            {"id": "family", "name": "ファミリーモデル", "attributes": {"用途": "家族向け", "設置": "据え置き", "カラー": "ホワイト"}, "tags": ["生活家電", "家電", "ファミリー"]},
        ]},
    ],
    "照明": [
        {"id": "light-floor", "name": "フロアライト", "type": "照明", "variants": [
            {"id": "standard", "name": "スタンダード", "attributes": {"設置": "床置き", "用途": "リビング", "カラー": "ブラック"}, "tags": ["照明", "ライト", "フロアライト"]},
            {"id": "wood", "name": "ナチュラルモデル", "attributes": {"設置": "床置き", "用途": "寝室・リビング", "カラー": "ブラウン"}, "tags": ["照明", "ライト", "ナチュラル"]},
        ]},
        {"id": "light-desk", "name": "デスクライト", "type": "照明", "variants": [
            {"id": "study", "name": "学習・作業向け", "attributes": {"設置": "デスク", "用途": "学習・仕事", "カラー": "ホワイト"}, "tags": ["照明", "デスクライト", "作業"]},
            {"id": "ambient", "name": "間接照明モデル", "attributes": {"設置": "卓上", "用途": "リラックス", "カラー": "グレー"}, "tags": ["照明", "間接照明", "ライト"]},
        ]},
    ],
    "家具": [
        {"id": "furniture-chair", "name": "チェア・椅子", "type": "チェア", "variants": [
            {"id": "work", "name": "ワークチェア", "attributes": {"用途": "仕事・学習", "素材": "ファブリック", "カラー": "グレー"}, "tags": ["家具", "椅子", "チェア", "デスク"]},
            {"id": "dining", "name": "ダイニングチェア", "attributes": {"用途": "ダイニング", "素材": "木製", "カラー": "ブラウン"}, "tags": ["家具", "椅子", "チェア", "ダイニング"]},
        ]},
        {"id": "furniture-table", "name": "テーブル", "type": "テーブル", "variants": [
            {"id": "desk", "name": "デスク", "attributes": {"用途": "仕事・学習", "素材": "木製", "カラー": "ブラウン"}, "tags": ["家具", "テーブル", "デスク"]},
            {"id": "side", "name": "サイドテーブル", "attributes": {"用途": "リビング", "素材": "木製", "カラー": "ホワイト"}, "tags": ["家具", "テーブル", "サイドテーブル"]},
        ]},
        {"id": "furniture-storage", "name": "収納家具", "type": "収納", "variants": [
            {"id": "shelf", "name": "シェルフ・ラック", "attributes": {"用途": "収納", "素材": "木製", "カラー": "ブラウン"}, "tags": ["家具", "収納", "棚", "ラック"]},
            {"id": "cabinet", "name": "キャビネット", "attributes": {"用途": "収納", "素材": "合成素材", "カラー": "ホワイト"}, "tags": ["家具", "収納", "キャビネット"]},
        ]},
    ],
    "インテリア": [
        {"id": "interior-decor", "name": "インテリア雑貨", "type": "インテリア雑貨", "variants": [
            {"id": "minimal", "name": "ミニマル系", "attributes": {"用途": "部屋づくり", "素材": "セラミック", "カラー": "ホワイト"}, "tags": ["インテリア", "雑貨", "ホームデコ"]},
            {"id": "natural", "name": "ナチュラル系", "attributes": {"用途": "部屋づくり", "素材": "木製", "カラー": "ブラウン"}, "tags": ["インテリア", "雑貨", "ナチュラル"]},
        ]},
        {"id": "interior-fabric", "name": "ファブリック・ラグ", "type": "ファブリック", "variants": [
            {"id": "rug", "name": "ラグ・マット", "attributes": {"用途": "リビング", "素材": "ファブリック", "カラー": "グレー"}, "tags": ["インテリア", "ラグ", "マット"]},
            {"id": "cushion", "name": "クッション・カバー", "attributes": {"用途": "リビング", "素材": "ファブリック", "カラー": "ブルー"}, "tags": ["インテリア", "クッション", "カバー"]},
        ]},
    ],
    "トップス": [
        {"id": "fashion-tops", "name": "トップス", "type": "トップス", "variants": [
            {"id": "tshirt", "name": "Tシャツ・カットソー", "attributes": {"サイズ": "M", "素材": "コットン", "カラー": "ホワイト"}, "tags": ["ファッション", "トップス", "Tシャツ", "カットソー"]},
            {"id": "shirt", "name": "シャツ・ブラウス", "attributes": {"サイズ": "L", "素材": "コットン混", "カラー": "ブルー"}, "tags": ["ファッション", "トップス", "シャツ", "ブラウス"]},
            {"id": "knit", "name": "ニット・セーター", "attributes": {"サイズ": "S", "素材": "ウール混", "カラー": "グリーン"}, "tags": ["ファッション", "トップス", "ニット", "セーター"]},
        ]},
        {"id": "fashion-outer", "name": "ライトアウター", "type": "アウター", "variants": [
            {"id": "jacket", "name": "ジャケット", "attributes": {"サイズ": "M", "素材": "ポリエステル", "カラー": "ブラック"}, "tags": ["ファッション", "アウター", "ジャケット"]},
            {"id": "cardigan", "name": "カーディガン", "attributes": {"サイズ": "L", "素材": "コットン混", "カラー": "ブラウン"}, "tags": ["ファッション", "アウター", "カーディガン"]},
        ]},
    ],
    "バッグ": [
        {"id": "bag-shoulder", "name": "ショルダーバッグ", "type": "バッグ", "variants": [
            {"id": "leather", "name": "レザー風", "attributes": {"用途": "通勤・普段使い", "素材": "合成皮革", "カラー": "ブラック"}, "tags": ["バッグ", "ショルダーバッグ", "通勤"]},
            {"id": "canvas", "name": "キャンバス", "attributes": {"用途": "普段使い", "素材": "キャンバス", "カラー": "ベージュ"}, "tags": ["バッグ", "ショルダーバッグ", "キャンバス"]},
        ]},
        {"id": "bag-tote", "name": "トートバッグ", "type": "バッグ", "variants": [
            {"id": "daily", "name": "デイリートート", "attributes": {"用途": "通勤・通学", "素材": "ファブリック", "カラー": "ブラウン"}, "tags": ["バッグ", "トートバッグ", "通勤", "通学"]},
            {"id": "mini", "name": "ミニトート", "attributes": {"用途": "お出かけ", "素材": "合成皮革", "カラー": "ホワイト"}, "tags": ["バッグ", "トートバッグ", "ミニバッグ"]},
        ]},
        {"id": "bag-backpack", "name": "リュック・バックパック", "type": "バッグ", "variants": [
            {"id": "commute", "name": "通勤・通学向け", "attributes": {"用途": "通勤・通学", "素材": "ナイロン", "カラー": "ブラック"}, "tags": ["バッグ", "リュック", "バックパック", "通勤"]},
            {"id": "travel", "name": "旅行向け", "attributes": {"用途": "旅行・アウトドア", "素材": "ナイロン", "カラー": "グレー"}, "tags": ["バッグ", "リュック", "旅行", "アウトドア"]},
        ]},
    ],
    "靴": [
        {"id": "shoes-sneaker", "name": "スニーカー", "type": "スニーカー", "variants": [
            {"id": "casual", "name": "カジュアル", "attributes": {"サイズ": "24.5cm", "用途": "普段使い", "カラー": "ホワイト"}, "tags": ["靴", "スニーカー", "カジュアル"]},
            {"id": "sport", "name": "スポーツモデル", "attributes": {"サイズ": "26.0cm", "用途": "スポーツ・運動", "カラー": "ブラック"}, "tags": ["靴", "スニーカー", "スポーツ"]},
        ]},
        {"id": "shoes-boots", "name": "ブーツ・革靴", "type": "ブーツ・革靴", "variants": [
            {"id": "boots", "name": "ブーツ", "attributes": {"サイズ": "25.0cm", "用途": "普段使い", "カラー": "ブラウン"}, "tags": ["靴", "ブーツ", "革靴"]},
            {"id": "loafer", "name": "ローファー", "attributes": {"サイズ": "24.0cm", "用途": "通勤・通学", "カラー": "ブラック"}, "tags": ["靴", "ローファー", "通勤"]},
        ]},
    ],
    "靴・アクセサリー": [
        {"id": "accessory-jewelry", "name": "アクセサリー", "type": "アクセサリー", "variants": [
            {"id": "necklace", "name": "ネックレス・ペンダント", "attributes": {"用途": "普段使い", "素材": "合金", "カラー": "ゴールド"}, "tags": ["アクセサリー", "ネックレス", "ペンダント"]},
            {"id": "earring", "name": "ピアス・イヤリング", "attributes": {"用途": "お出かけ", "素材": "合金", "カラー": "シルバー"}, "tags": ["アクセサリー", "ピアス", "イヤリング"]},
        ]},
        {"id": "accessory-wallet", "name": "財布・小物", "type": "財布・小物", "variants": [
            {"id": "long-wallet", "name": "長財布", "attributes": {"用途": "普段使い", "素材": "合成皮革", "カラー": "ブラック"}, "tags": ["財布", "長財布", "小物"]},
            {"id": "compact-wallet", "name": "コンパクト財布", "attributes": {"用途": "持ち運び", "素材": "合成皮革", "カラー": "ブラウン"}, "tags": ["財布", "ミニ財布", "小物"]},
        ]},
    ],
    "ゲーム": [
        {"id": "game-console", "name": "ゲーム機本体", "type": "ゲーム機", "variants": [
            {"id": "home", "name": "家庭用モデル", "attributes": {"用途": "家庭用ゲーム", "形状": "据え置き", "カラー": "ホワイト"}, "tags": ["ゲーム", "ゲーム機", "本体", "家庭用"]},
            {"id": "portable", "name": "携帯モデル", "attributes": {"用途": "携帯ゲーム", "形状": "携帯", "カラー": "グレー"}, "tags": ["ゲーム", "ゲーム機", "本体", "携帯"]},
        ]},
        {"id": "game-accessory", "name": "ゲーム周辺機器", "type": "ゲーム周辺機器", "variants": [
            {"id": "controller", "name": "コントローラー", "attributes": {"用途": "ゲーム操作", "接続": "ワイヤレス", "カラー": "ブラック"}, "tags": ["ゲーム", "コントローラー", "周辺機器"]},
            {"id": "display", "name": "ゲーム用ディスプレイ", "attributes": {"用途": "ゲーム", "接続": "HDMI", "カラー": "ブラック"}, "tags": ["ゲーム", "モニター", "周辺機器"]},
        ]},
    ],
    "おもちゃ": [
        {"id": "toy-building", "name": "知育・組み立て玩具", "type": "おもちゃ", "variants": [
            {"id": "building", "name": "ブロック・組み立て", "attributes": {"対象年齢": "3歳以上", "用途": "知育・遊び", "カラー": "レッド"}, "tags": ["おもちゃ", "知育玩具", "ブロック"]},
            {"id": "puzzle", "name": "パズル・ボードゲーム", "attributes": {"対象年齢": "6歳以上", "用途": "家族で遊ぶ", "カラー": "ブルー"}, "tags": ["おもちゃ", "パズル", "ボードゲーム"]},
        ]},
        {"id": "toy-character", "name": "キャラクター・ぬいぐるみ", "type": "キャラクターグッズ", "variants": [
            {"id": "plush", "name": "ぬいぐるみ", "attributes": {"対象年齢": "全年齢", "用途": "コレクション", "カラー": "ブラウン"}, "tags": ["おもちゃ", "ぬいぐるみ", "キャラクター"]},
            {"id": "figure", "name": "フィギュア・模型", "attributes": {"対象年齢": "15歳以上", "用途": "コレクション", "カラー": "ブラック"}, "tags": ["おもちゃ", "フィギュア", "模型"]},
        ]},
    ],
    "コレクション": [
        {"id": "collection-figure", "name": "フィギュア・模型", "type": "コレクション", "variants": [
            {"id": "figure", "name": "フィギュア", "attributes": {"用途": "コレクション", "素材": "PVC", "カラー": "レッド"}, "tags": ["コレクション", "フィギュア", "模型"]},
            {"id": "model", "name": "模型・ミニチュア", "attributes": {"用途": "コレクション", "素材": "プラスチック", "カラー": "グレー"}, "tags": ["コレクション", "模型", "ミニチュア"]},
        ]},
        {"id": "collection-card", "name": "カード・コレクション", "type": "コレクション", "variants": [
            {"id": "trading", "name": "トレーディングカード", "attributes": {"用途": "コレクション", "保管": "スリーブ保管", "カラー": "ブルー"}, "tags": ["コレクション", "カード", "トレカ"]},
            {"id": "vintage", "name": "ヴィンテージ雑貨", "attributes": {"用途": "コレクション", "保管": "屋内保管", "カラー": "ブラウン"}, "tags": ["コレクション", "ヴィンテージ", "レトロ"]},
        ]},
    ],
    "本・雑誌": [
        {"id": "book-business", "name": "ビジネス・実用書", "type": "本・雑誌", "variants": [
            {"id": "business", "name": "ビジネス・経済", "attributes": {"ジャンル": "ビジネス・経済", "用途": "学習・仕事", "版": "通常版"}, "tags": ["本", "書籍", "ビジネス", "実用書"]},
            {"id": "design", "name": "デザイン・クリエイティブ", "attributes": {"ジャンル": "デザイン", "用途": "学習・制作", "版": "通常版"}, "tags": ["本", "書籍", "デザイン", "実用書"]},
        ]},
        {"id": "book-novel", "name": "小説・読み物", "type": "本・雑誌", "variants": [
            {"id": "novel", "name": "文学・小説", "attributes": {"ジャンル": "文学・小説", "用途": "読書", "版": "単行本"}, "tags": ["本", "小説", "文学", "読み物"]},
            {"id": "magazine", "name": "雑誌・ムック", "attributes": {"ジャンル": "雑誌", "用途": "情報収集", "版": "雑誌"}, "tags": ["本", "雑誌", "ムック"]},
        ]},
        {"id": "book-child", "name": "絵本・児童書", "type": "絵本・児童書", "variants": [
            {"id": "picture", "name": "絵本", "attributes": {"ジャンル": "絵本", "用途": "読み聞かせ", "版": "ハードカバー"}, "tags": ["本", "絵本", "児童書"]},
            {"id": "study", "name": "学習・図鑑", "attributes": {"ジャンル": "学習", "用途": "学習・知育", "版": "通常版"}, "tags": ["本", "児童書", "図鑑", "学習"]},
        ]},
    ],
    "調理器具": [
        {"id": "kitchen-cookware", "name": "鍋・フライパン", "type": "調理器具", "variants": [
            {"id": "frypan", "name": "フライパン", "attributes": {"用途": "焼く・炒める", "素材": "アルミ系", "カラー": "ブラック"}, "tags": ["キッチン", "調理器具", "フライパン"]},
            {"id": "pot", "name": "鍋・ソースパン", "attributes": {"用途": "煮る・茹でる", "素材": "ステンレス系", "カラー": "シルバー"}, "tags": ["キッチン", "調理器具", "鍋"]},
        ]},
        {"id": "kitchen-tools", "name": "キッチンツール", "type": "キッチン用品", "variants": [
            {"id": "prep", "name": "調理小物", "attributes": {"用途": "下ごしらえ", "素材": "ステンレス系", "カラー": "シルバー"}, "tags": ["キッチン", "調理器具", "調理小物"]},
            {"id": "storage", "name": "保存・収納用品", "attributes": {"用途": "保存・収納", "素材": "ガラス系", "カラー": "ホワイト"}, "tags": ["キッチン", "保存容器", "収納"]},
        ]},
    ],
    "スポーツ用品": [
        {"id": "sports-fitness", "name": "フィットネス用品", "type": "スポーツ用品", "variants": [
            {"id": "training", "name": "トレーニング用品", "attributes": {"用途": "筋トレ・運動", "素材": "合成素材", "カラー": "ブラック"}, "tags": ["スポーツ", "フィットネス", "トレーニング"]},
            {"id": "yoga", "name": "ヨガ・ストレッチ用品", "attributes": {"用途": "ヨガ・ストレッチ", "素材": "PVC", "カラー": "ブルー"}, "tags": ["スポーツ", "ヨガ", "ストレッチ"]},
        ]},
        {"id": "sports-outdoor", "name": "アウトドア用品", "type": "アウトドア用品", "variants": [
            {"id": "camp", "name": "キャンプ用品", "attributes": {"用途": "キャンプ", "素材": "アルミ系", "カラー": "グリーン"}, "tags": ["スポーツ", "アウトドア", "キャンプ"]},
            {"id": "run", "name": "ランニング用品", "attributes": {"用途": "ランニング", "素材": "ポリエステル", "カラー": "レッド"}, "tags": ["スポーツ", "ランニング", "運動"]},
        ]},
    ],
    "子ども用品": [
        {"id": "kids-clothing", "name": "ベビー・キッズ服", "type": "ベビー服", "variants": [
            {"id": "baby", "name": "ベビー服", "attributes": {"サイズ": "80cm", "用途": "普段着", "カラー": "ブルー"}, "tags": ["ベビー", "キッズ", "子ども服"]},
            {"id": "kids", "name": "キッズ服", "attributes": {"サイズ": "120cm", "用途": "普段着", "カラー": "レッド"}, "tags": ["ベビー", "キッズ", "子ども服"]},
        ]},
        {"id": "kids-goods", "name": "ベビー用品", "type": "ベビー用品", "variants": [
            {"id": "toy", "name": "ベビー玩具", "attributes": {"対象年齢": "1歳以上", "用途": "遊び・知育", "カラー": "イエロー"}, "tags": ["ベビー", "キッズ", "おもちゃ", "知育"]},
            {"id": "daily", "name": "育児用品", "attributes": {"対象年齢": "乳幼児", "用途": "育児・日常", "カラー": "ホワイト"}, "tags": ["ベビー", "キッズ", "育児用品"]},
        ]},
    ],
}

SELLERS = [
    ("sandbox_select", "photo-1500648767791-00dcc994a43e", 4.8, 128),
    ("demo_market", "photo-1494790108377-be9c29b29330", 4.9, 86),
    ("furima_lab", "photo-1472099645785-5658abf4ff4e", 4.7, 204),
    ("curated_room", "photo-1438761681033-6461ffad8d80", 4.9, 71),
    ("sandbox_store", "photo-1535713875002-d1d0cf377fde", 4.8, 156),
]

PRICE_RANGES = {
    "PC・タブレット": (18000, 148000),
    "スマートフォン": (6800, 118000),
    "オーディオ": (1200, 49800),
    "カメラ": (4800, 128000),
    "生活家電": (1000, 54800),
    "照明": (1200, 24800),
    "家具": (2400, 69800),
    "インテリア": (800, 19800),
    "トップス": (900, 16800),
    "バッグ": (1800, 29800),
    "靴": (1800, 24800),
    "靴・アクセサリー": (1200, 19800),
    "ゲーム": (1200, 69800),
    "おもちゃ": (600, 24800),
    "コレクション": (800, 39800),
    "本・雑誌": (400, 5800),
    "調理器具": (600, 19800),
    "スポーツ用品": (900, 29800),
    "子ども用品": (600, 14800),
}

CONDITIONS = ["新品・未使用", "未使用に近い", "目立った傷や汚れなし"]
SHIPPING_METHODS = ["ゆうゆう配送", "らくらく配送", "ゆうパケットポスト"]
ORIGINS = ["東京都", "大阪府", "神奈川県", "愛知県", "福岡県", "北海道"]
SHIPPING_SIZES = ["60サイズ", "80サイズ", "100サイズ", "未定"]


def stable_value(number: int, minimum: int, maximum: int) -> int:
    return minimum + (number * 7919 % (maximum - minimum + 1))


def choose_variant(subcategory: str, index: int, pexels_id: int) -> tuple[dict, dict]:
    families = VARIANT_CATALOG.get(subcategory)
    if not families:
        fallback_family = {
            "id": f"family-{subcategory}",
            "name": LABELS.get(subcategory, subcategory),
            "type": LABELS.get(subcategory, subcategory),
            "variants": [{"id": "standard", "name": "スタンダード", "attributes": {}, "tags": [subcategory]}],
        }
        return fallback_family, fallback_family["variants"][0]
    family = families[(index + pexels_id) % len(families)]
    variants = family["variants"]
    variant = variants[(index * 3 + pexels_id) % len(variants)]
    return family, variant


def build_rows() -> list[dict]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rows: list[dict] = []
    for index, item in enumerate(manifest, start=1):
        subcategory = item["subcategory"]
        label = LABELS.get(subcategory, subcategory)
        minimum, maximum = PRICE_RANGES.get(subcategory, (800, 19800))
        pexels_id = int(item["pexelsId"])
        price = stable_value(pexels_id, minimum, maximum)
        price = max(300, round(price / 100) * 100)
        is_sold = index % 41 == 0
        is_auction = index % 37 == 0 and not is_sold
        family, variant = choose_variant(subcategory, index, pexels_id)
        inventory_policy = "MULTI" if index % 11 == 0 and not is_auction else "SINGLE"
        inventory_initial_quantity = 2 + index % 4 if inventory_policy == "MULTI" else 1
        inventory_quantity = 0 if is_sold else inventory_initial_quantity
        seller_index = (index + pexels_id) % len(SELLERS)
        seller_name, seller_avatar, rating, ratings_count = SELLERS[seller_index]
        current_bid = price if is_auction else None
        attributes = dict(variant["attributes"])
        search_tags = list(dict.fromkeys([
            item["category"],
            subcategory,
            family["name"],
            family["type"],
            variant["name"],
            *variant["tags"],
        ]))
        rows.append({
            "id": f"demo-{index:06d}",
            "sku": f"FBS-{index:06d}",
            "image": item["localPath"],
            "category": item["category"],
            "subcategory": subcategory,
            "label": f"{family['name']}・{variant['name']}",
            "productFamilyId": family["id"],
            "productFamilyName": family["name"],
            "variantId": f"{family['id']}-{variant['id']}",
            "variantName": variant["name"],
            "productType": family["type"],
            "searchTags": search_tags,
            "attributes": attributes,
            "price": price,
            "condition": CONDITIONS[(index + pexels_id) % len(CONDITIONS)],
            "shippingMethod": SHIPPING_METHODS[index % len(SHIPPING_METHODS)],
            "origin": ORIGINS[index % len(ORIGINS)],
            "shippingDays": ["1〜2日で発送", "2〜3日で発送", "4〜7日で発送"][index % 3],
            "shippingSize": SHIPPING_SIZES[index % len(SHIPPING_SIZES)],
            "isSold": is_sold,
            "isAuction": is_auction,
            "currentBid": current_bid,
            "bidsCount": (index * 3) % 18 + 1 if is_auction else None,
            "timeLeft": ["残り5時間", "残り1日", "残り2日"][index % 3] if is_auction else None,
            "likesCount": (index * 11 + pexels_id) % 96,
            "viewsCount": (index * 43 + pexels_id) % 900 + 40,
            "sellerName": seller_name,
            "sellerAvatar": f"https://images.unsplash.com/{seller_avatar}?auto=format&fit=crop&w=160&q=80",
            "rating": rating,
            "ratingsCount": ratings_count,
            "sellerType": "shop" if index % 5 == 0 else "individual",
            "inventoryPolicy": inventory_policy,
            "inventoryInitialQuantity": inventory_initial_quantity,
            "inventoryQuantity": inventory_quantity,
            "sourceUrl": item["pexelsUrl"],
            "sourcePhotographer": item.get("photographer") or "Pexels photographer",
            "sourceAttribution": f"Photo by {item.get('photographer') or 'Pexels photographer'} on Pexels",
            "sourceChecksum": item["sha256"],
        })
    return rows


def main() -> int:
    rows = build_rows()
    payload = json.dumps(rows, ensure_ascii=False, indent=2)
    output = f'''/* Generated from public/images/products/pexels-selected/manifest.json. Do not edit by hand. */
import type {{ MercariItem, ProductFamily, ProductVariant }} from '../types/mercari';

interface CatalogSeed {{
  id: string;
  sku: string;
  image: string;
  category: string;
  subcategory: string;
  label: string;
  productFamilyId: string;
  productFamilyName: string;
  variantId: string;
  variantName: string;
  productType: string;
  searchTags: string[];
  attributes: Record<string, string>;
  price: number;
  condition: string;
  shippingMethod: string;
  origin: string;
  shippingDays: string;
  shippingSize: string;
  isSold: boolean;
  isAuction: boolean;
  currentBid: number | null;
  bidsCount: number | null;
  timeLeft: string | null;
  likesCount: number;
  viewsCount: number;
  sellerName: string;
  sellerAvatar: string;
  rating: number;
  ratingsCount: number;
  sellerType: 'individual' | 'shop';
  inventoryPolicy: 'SINGLE' | 'MULTI';
  inventoryInitialQuantity: number;
  inventoryQuantity: number;
  sourceUrl: string;
  sourcePhotographer: string;
  sourceAttribution: string;
  sourceChecksum: string;
}}

const CATALOG_SEEDS: CatalogSeed[] = {payload};

export const CATALOG_FAMILIES: ProductFamily[] = Array.from(new Map(CATALOG_SEEDS.map((seed) => [seed.productFamilyId, {{
  id: seed.productFamilyId,
  name: seed.productFamilyName,
  productType: seed.productType,
  category: seed.category,
}}])).values());

export const CATALOG_VARIANTS: ProductVariant[] = Array.from(new Map(CATALOG_SEEDS.map((seed) => [seed.variantId, {{
  id: seed.variantId,
  familyId: seed.productFamilyId,
  name: seed.variantName,
  attributes: seed.attributes,
  searchTags: seed.searchTags,
}}])).values());

export const CATALOG_ITEMS: MercariItem[] = CATALOG_SEEDS.map((seed) => ({{
  id: seed.id,
  sku: seed.sku,
  title: `${{seed.label}} デモ出品 #${{seed.id.replace('demo-', '')}}`,
  price: seed.price,
  images: [seed.image],
  isSold: seed.isSold,
  isAuction: seed.isAuction,
  currentBid: seed.currentBid ?? undefined,
  bidsCount: seed.bidsCount ?? undefined,
  timeLeft: seed.timeLeft ?? undefined,
  description: `${{seed.label}}のデモ出品です。商品ファミリー「${{seed.productFamilyName}}」、バリエーション「${{seed.variantName}}」として検索・在庫操作を確認できます。属性は操作確認用の仮データで、画像から実物の仕様・ブランド・状態を保証するものではありません。決済・発送は発生しないサンドボックス商品です。`,
  category: [seed.category, seed.subcategory],
  productFamilyId: seed.productFamilyId,
  productFamilyName: seed.productFamilyName,
  variantId: seed.variantId,
  variantName: seed.variantName,
  productType: seed.productType,
  searchTags: seed.searchTags,
  attributes: seed.attributes,
  condition: seed.condition,
  shippingFee: '送料込み（出品者負担）',
  shippingMethod: seed.shippingMethod,
  origin: seed.origin,
  shippingDays: seed.shippingDays,
  likesCount: seed.likesCount,
  viewsCount: seed.viewsCount,
  seller: {{
    name: seed.sellerName,
    avatar: seed.sellerAvatar,
    rating: seed.rating,
    ratingsCount: seed.ratingsCount,
    isVerified: true,
    completedSales: seed.ratingsCount * 2,
    responseRate: 96,
  }},
  comments: [],
  isAnonymousShipping: true,
  shippingSize: seed.shippingSize,
  isAuthenticityEligible: false,
  sellerType: seed.sellerType,
  inventoryPolicy: seed.inventoryPolicy,
  inventoryInitialQuantity: seed.inventoryInitialQuantity,
  inventoryQuantity: seed.inventoryQuantity,
  reservedQuantity: 0,
  listingStatus: seed.isSold ? 'SOLD' : 'ACTIVE',
  isDemo: true,
  sourceUrl: seed.sourceUrl,
  sourcePhotographer: seed.sourcePhotographer,
  sourceAttribution: seed.sourceAttribution,
  sourceChecksum: seed.sourceChecksum,
}}));

export const CATALOG_ITEM_COUNT = CATALOG_ITEMS.length;
'''
    OUTPUT.write_text(output, encoding="utf-8")
    print(f"Generated {len(rows)} catalog items at {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
