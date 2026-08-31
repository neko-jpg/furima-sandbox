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

Guided garment capture (optional, clothing-only)
       |
       +--> furima UI: guided-capture reducer, camera/quality checks, LiveKit adapter, fixture adapter
       +--> assistant-api: FastAPI contract and fixture/live provider boundary
       +--> assistant-agent: separate LiveKit Agent process (live profile only)
       +--> rembg: private sidecar used only for mask-only output (live profile only)
       +--> approved front/back/tag refs + approved measurements --> existing listing draft
       +--> measurement image, endpoints, scale, events, and unapproved backgrounds --> discarded at session end

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

## Team-Dバックエンドの統合境界

Team-Dの最新`main`（統合基準は`cd7b42a207fc3912fdd5e8e76ac2e91f7f5f5abe`、初期基準`be5ee304febe14b280fa546fa3cc9704b84e6e8`から更新）から、PythonのFastAPI／LiveKit Agent、GuidanceStateMachine、latest-frame backpressure、VisionGuidanceProvider、ShotAssessor、採寸・mask・背景処理のprovider契約だけを`services/listing_photo_assistant/`へ移管します。Team-DのReact/Vite画面、CSS、Vite設定、Node APIはfurimaの正本へ取り込みません。

fixtureは外部資格情報なしで動作し、`PROVIDER_MODE=live`を明示した場合だけ実AI・LiveKit・rembgなどへ接続します。AIキー、LiveKit secret、rembg URLはPythonプロセス／Compose内部に留め、ブラウザへは短期tokenと公開接続情報だけを返します。FastAPIとAgentは別プロセスです。

Python依存関係はルートの`pyproject.toml`と`uv.lock`を正本とし、Compose／CIは`uv sync --frozen`後の環境だけを実行します。`assistant-api`はfixtureのhealthcheckを待ってUIを起動し、`assistant-agent`とrembgはComposeの`live` profileでのみ起動します。`ASSISTANT_CORS_ORIGINS`は`http://127.0.0.1:3000`と`http://localhost:3000`の明示allowlistで、wildcard CORSは許可しません。

撮影アシスタントは既存の4ステップ出品フローの写真ステップ内にある任意の子機能です。対象は半袖クルーネックTシャツ向けに限定し、対象外カテゴリでは従来のカメラ／アルバム入力を妨げません。Reducerが`front → back → tag → measurement → explicit approval`を管理し、AIの`nextAction`だけでは出品画面を遷移させません。

## セッションと出品データの境界

撮影中のBlob、object URL、LiveKit room、Worker、measurement画像、端点、scale、GuidanceEvent、AI途中結果はメモリ上のセッションに限定します。画面を閉じる、終了する、unmountする場合はそれらを解放し、既存メディアへ自動マージ・自動上書きしません。

明示的に出品へ進む操作が成功したときだけ、既存の下書きへ次を渡します。

```text
imageRefs: approved front / back / tag local refs
garmentMeasurements: { lengthCm, widthCm, source }
```

背景編集は正面原本のRGBと検証済みmaskを端末内Canvasで合成します。背景生成APIへ商品画像を渡さず、生成画像は比較表示と明示承認を経るまで出品画像へ入りません。

## 出品画像

ListingMediaRefは公開状態で参照するメタデータです。画像処理は同時2枚まで、MIME実体検査後に1600px以下へ変換します。UIの互換表示が必要な間だけlegacy imagesを生成し、永続境界ではimageRefsを正本にします。

プロフィール画像も同じIndexedDBメディア境界を使い、SandboxにはavatarRefのみ保存します。ウォレットはopeningBalanceから台帳を再生し、DEPOSIT/WITHDRAWAL/HOLD/CAPTURE/REFUND/SALE/FEEの整合性をドメインassertInvariantsで検証します。
