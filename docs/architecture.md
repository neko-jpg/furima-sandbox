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

公開UIとSandboxの初期データは、選定済み50件のローカル商品カタログです。APIの1ページは最大40件とし、必要なページだけをCatalogStoreへ追加します。旧来のINITIAL_ITEMSは隔離したテスト用fixtureとして扱い、公開カタログへ混在させません。SandboxEngineには在庫・取引・出品差分を置きます。Catalog APIのHTTP ETagは取得内容のdigestを含み、q/categoryは200文字以内です。

## 状態保存

IndexedDBをブラウザSandbox aggregateの永続化正本とし、localStorageは小さな設定、actor-scoped draft metadata、legacy stateの互換読み込みに限定します。画像本体はListingMediaStoreへ置き、大きなSandbox JSONを同期保存しません。書き込みはデバウンスし、D1更新はstateVersion/ETagで競合を検知します。D1 HTTP経路はoperator APIであり、browser bearer tokenを埋め込みません。
Cloudflare Workerの15分Cron Triggerはcommand/preview retention cleanupを実行し、実行結果は構造化ログへ出します。

## 出品画像

ListingMediaRefは公開状態で参照するメタデータです。画像処理は同時2枚まで、MIME実体検査後に1600px以下へ変換します。UIの互換表示が必要な間だけlegacy imagesを生成し、永続境界ではimageRefsを正本にします。

プロフィール画像も同じIndexedDBメディア境界を使い、SandboxにはavatarRefのみ保存します。ウォレットはopeningBalanceから台帳を再生し、DEPOSIT/WITHDRAWAL/HOLD/CAPTURE/REFUND/SALE/FEEの整合性をドメインassertInvariantsで検証します。
