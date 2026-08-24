# Furima Sandbox UI Kit

Furima Sandboxは、商品カタログ、検索、いいね、コメント、購入、出品、通知、マイページをローカルfixtureで再現する動作確認用のフリマUIです。UIだけでなく、ブラウザAPI、Sandboxドメイン、HTTP API、Cloudflare Worker/D1向けの実装も含むアプリケーション用リポジトリです。

## Quick Start

### NodeでUI/fixtureを起動する

Nodeはルートの`.nvmrc`にある`22.13.0`、npmは`package.json`の`packageManager`にある`10.9.2`を使います。Node version managerを使う場合は、`.nvmrc`のバージョンを選択してください。

~~~powershell
nvm install 22.13.0
nvm use 22.13.0
$env:FURIMA_LOCAL_FIXTURE_MODE = "true"
$env:FURIMA_STORAGE_MODE = "memory"
npm ci
npm run check:shared
npm run dev
~~~

ブラウザで<http://localhost:3000>を開きます。UI/fixture開発では外部D1や本番の資格情報は不要です。`.env.example`を`.env.local`へコピーする場合も、値はローカル開発用のままにしてください。

通常の`npm run dev`は、Vinextの3つの開発環境でsourcemap生成を省き、コールド初回表示を優先します。サーバーやhydrationのスタックをソース位置まで追うときは、起動前に`FURIMA_DEV_SOURCEMAPS=true`を設定してください。

### DockerでUI/fixtureを起動する

Docker経路も同じUI/fixture開発を目的にしています。通常起動はイメージへソースを含めるため、初回または依存関係・ソースを更新した後に次を実行します。

~~~powershell
docker compose up --build
~~~

編集中のソースを自動同期してHMRを使う場合は、Compose Watchを有効にします（Docker Compose 2.22以降）。

~~~powershell
docker compose up --build --watch
~~~

<http://localhost:3000>を確認し、停止するときは`Ctrl+C`または次を実行します。

~~~powershell
docker compose down
~~~

Composeは`FURIMA_LOCAL_FIXTURE_MODE=true`と`FURIMA_STORAGE_MODE=memory`を設定し、依存関係をコンテナ内へ`npm ci`で用意します。通常起動ではイメージ内のソースを使い、`--watch`を付けた場合だけCompose Watchでソースをコンテナへ同期します。`.wrangler`と`node_modules`は名前付きvolumeにします。ホストのbind mountを使わないため、Windowsでも起動時のファイルシステム差異を避けられます。

## アーキテクチャと実行モード

~~~text
Node/Vite/vinext dev または Docker Compose (ui)
  └─ Browser UI
       ├─ IndexedDB: Sandbox aggregateの正本
       ├─ localStorage: 小さな設定、旧データ移行、actor別下書きメタデータ
       └─ /api/*: FURIMA_LOCAL_FIXTURE_MODE=true のローカルfixture

npm run dev:edge
  └─ Wrangler local Worker ── DB binding ── Cloudflare D1 (利用可能な場合)

本番
  └─ Cloudflare Worker ── 実際のAssets/D1/R2等のbinding
~~~

`npm run dev`とDocker Composeは、Node上のUI/fixture開発環境です。本番Cloudflare Workerと同じランタイム、binding、デプロイ構成を提供するものではありません。Worker側の確認は`npm run dev:edge`、build、CI、およびデプロイ環境の検証で別途行います。Dockerイメージを本番Workerの互換性の証明やデプロイ用イメージとして扱わないでください。

`.openai/hosting.json`と`wrangler.jsonc`はbindingやデプロイ側の設定です。UI/fixture開発では実D1 IDや本番資格情報を設定しません。`wrangler.jsonc`のplaceholderを使ったremote migrationも実行しないでください。

## Fixtureとstorageの明示設定

- UI/fixtureでは`FURIMA_LOCAL_FIXTURE_MODE=true`を明示します。Composeもこの値を設定します。共有Workerや本番環境ではfixtureを有効にせず、適切な認証とAccess policyを設定してください。
- `FURIMA_STORAGE_MODE=memory`はローカルfixture専用のin-process storeを選択します。Workerで永続化する場合は`FURIMA_STORAGE_MODE=d1`と`DB` bindingを設定し、D1 bindingがなければ利用できません。production/stagingでmemoryやfixtureを有効にする構成は拒否されます。ブラウザUIのSandbox aggregateはIndexedDBを正本とします。
- ブラウザSandboxの正本はIndexedDBです。localStorageは小さな設定、旧データ移行、actor別の下書きメタデータなどに限定しています。IndexedDBが利用できない環境では診断付きのvolatile fallbackになるため、再起動後の保持を前提にしないでください。
- Cloudflare WorkerでD1を使う場合だけ、`DB` bindingとOperator API用の`FURIMA_D1_API_TOKEN` / `FURIMA_D1_CONTROL_TOKEN`を別途設定します。DockerのUIサービスはD1/R2を提供しません。

通常のagent操作とsandbox制御操作はorigin・bundle・JavaScript realmの境界で分離します。agent用React bundleにはactor切替、シナリオロード、仮想時計、障害注入のclientやcredentialを含めません。これらは`FURIMA_D1_CONTROL_TOKEN`で認証した外部ハーネスまたはcontrol APIからだけ実行し、購入者・出品者のAPIには現在actorの取引・walletだけを返します。

## 開発と検証

~~~bash
npm run check:shared
npm run typecheck
npm run lint
npm run build
npm test
npm run assets:audit
~~~

Cloudflare Worker/D1相当を確認する場合は`npm run dev:edge`を使います。D1 migrationは対象とbindingを確認してから実行してください。

~~~bash
npm run db:generate
npm run db:migrate:local
npm run types:worker
~~~

`npm run db:migrate:remote`はplaceholderの`database_id`を先に検査し、実IDへ置き換えられていない場合は停止します。実D1のバックアップ、対象確認、Access/運用手順の確認後に限って実行してください。APIドキュメントを変更した場合は、`docs/api/openapi.yaml`を正本として`AGENTS.md`記載の検証順序に従ってください。

## APIドキュメントと運用資料

- 正本: [`docs/api/openapi.yaml`](docs/api/openapi.yaml)
- Scalar API参照: [Cloudflare Pages](https://mercari-ui-kit-api-docs.pages.dev/)
- チーム運用資料: [`docs/wiki/`](docs/wiki/)
- 開発者向け手順: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- AIコーディングエージェント向け運用ルール: [`AGENTS.md`](AGENTS.md)

`main`へのAPIドキュメント生成元の変更でverify workflowが成功すると、GitHub Actionsの`.github/workflows/docs-cloudflare-pages.yml`が同じコミットを検証してからCloudflare Pagesへデプロイします。UI、CI、Wikiなど生成元以外だけの変更ではデプロイをスキップし、`docs-status`が「デプロイ不要」の正常終了を記録します。進行中のdocs deploymentは後続runで中断せず、順番に処理します。Cloudflare Accessの招待や本番デプロイは、このREADMEのDocker手順とは別の運用です。
個別のPages deployment URL（`*.pages.dev`）がcanonical URLと同じAccess保護になるとは限らないため、未認証確認が済むまでdeployment/Preview URLを共有しません。

## Agent API

ブラウザ上では`window.__SHOP_API__`から安定したdata-plane APIオブジェクトを取得できます。後方互換のため`window.__MERCARI_API__`も同じオブジェクトを指します。読み取りには`getSnapshot()`、`getItems()`、`getItem(id)`、`searchItems(query)`、操作には`setLiked`、`startPurchase`、`confirmPurchase`、`createListingDraft`、`submitListing`などを使います。操作結果は`ActionResult`で返り、`idempotencyKey`と`getActionTrace()`に対応します。`resetScenario`などのcontrol操作はブラウザAPIへ公開しません。

## 画像・カタログ

実行時の商品画像はWebPに変換して`public/images/products/pexels-selected/`へ置きます。Pexelsの未選定候補はGit管理・公開配信の対象外である`outputs/pexels-candidates*/`へ保存し、参考スクリーンショットは`docs/reference-assets/`に置きます。`public/images/products/pexels-candidates*/`や公開対象のJPEG/PNGが存在すると`npm run assets:audit`と`npm run build`は失敗します。監査は公開対象の総量80MiB budgetと2MiB以上のファイルも確認します。Pexelsから追加候補を取得する場合はAPIキーを環境変数で渡し、キーをソースコードや`.env`へコミットしないでください。
