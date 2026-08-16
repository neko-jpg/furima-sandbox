# Architecture

## 境界

~~~text
UI / Listing Flow
       |
       v
MercariContext + Browser API bridge
       |
       +--> CatalogStore: ページ取得したカタログ
       +--> SandboxStore: 取引・在庫・出品状態
       +--> PreferencesStore: likes、検索履歴、表示設定
       |
       v
SandboxEngine (domain invariants)
       |
       +--> local fixture
       +--> D1 state endpoint (edge mode)

Listing media
       |
       +--> IndexedDB (local bytes)
       +--> R2 adapter (future production bytes)
       +--> state contains refs/order/dimensions only

Wallet / Profile
       |
       +--> SandboxEngine ledger and ActorProfile invariants
       +--> browser API (actor-scoped, stateVersion/permission checked)
       +--> My Page wallet and profile panels
~~~

カタログ全件をSandboxEngineへコピーしない方針です。初期UIは24件、APIの1ページは最大40件とし、必要なページだけをCatalogStoreへ追加します。SandboxEngineには在庫・取引・出品差分を置きます。

## 状態保存

localStorageは小さな設定と互換読み込みに限定します。画像本体や大きなSandbox JSONを同期保存しません。書き込みはデバウンスし、D1更新はstateVersion/ETagで競合を検知します。

## 出品画像

ListingMediaRefは公開状態で参照するメタデータです。画像処理は同時2枚まで、MIME実体検査後に1600px以下へ変換します。UIの互換表示が必要な間だけlegacy imagesを生成し、永続境界ではimageRefsを正本にします。

プロフィール画像も同じIndexedDBメディア境界を使い、SandboxにはavatarRefのみ保存します。ウォレットはopeningBalanceから台帳を再生し、DEPOSIT/WITHDRAWAL/HOLD/CAPTURE/REFUND/SALE/FEEの整合性をドメインassertInvariantsで検証します。
