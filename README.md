# Furima Sandbox UI Kit

## Sandbox operation notes

- `exportState` and `importState` are operator-only API commands. They require `scope: "sandbox-control"` and an authenticated `admin` or `platform` actor; ordinary actors receive `FORBIDDEN`.
- `wrangler.jsonc` is the local D1 migration configuration. Its placeholder `database_id` must be replaced with the real D1 database ID before running `npm run db:migrate:remote`.
- Local previews persist the Sandbox aggregate in IndexedDB; localStorage is limited to small preferences, legacy migration, and actor-scoped draft metadata. Browser-to-D1 state access is disabled by default. The D1 state endpoint is an operator API and must be placed behind separate API/control authentication and the deployment's Access policy before handling real user data.

Furima Sandboxは、AIエージェント連携のデモに使える、動作するフリマUIモックです。商品カタログ、検索、いいね、コメント、購入、出品、通知、マイページをローカルfixtureで再現しています。

## 開発

```bash
npm install
npm run dev
```

検証コマンド:

```bash
npm run lint
npm run build
npm test
npm run assets:audit
```

## APIドキュメント

- 正本: [`docs/api/openapi.yaml`](docs/api/openapi.yaml)
- Scalar API参照: [Cloudflare Pages](https://mercari-ui-kit-api-docs.pages.dev/)
- チーム運用: [GitHub Wiki](https://github.com/neko-jpg/mercari-ui-kit/wiki)

API関連の変更が`main`へ入ると、GitHub Actionsの
[`docs-cloudflare-pages.yml`](.github/workflows/docs-cloudflare-pages.yml)が検証後にCloudflare Pagesへデプロイします。
Cloudflare Accessの招待メールが必要です。運用手順は
[`docs/runbooks/cloudflare-pages-docs.md`](docs/runbooks/cloudflare-pages-docs.md)と[`AGENTS.md`](AGENTS.md)を参照してください。

## Agent API

ブラウザ上では `window.__SHOP_API__` から安定したAPIオブジェクトを取得できます。後方互換のため `window.__MERCARI_API__` も同じオブジェクトを指します。

読み取りには `getSnapshot()`, `getItems()`, `getItem(id)`, `searchItems(query)`、操作には `setLiked`, `startPurchase`, `confirmPurchase`, `createListingDraft`, `submitListing` などを使います。操作結果は `ActionResult` で返り、`idempotencyKey`, `getActionTrace()`, `resetScenario()` に対応しています。

購入や出品はUIだけでなくdomain action側でも入力と状態を検証します。

## Sandbox の境界と永続化

通常のagent操作とsandbox制御操作は分離しています。購入者・出品者のAPIには現在actorの取引・walletだけを返し、`switchActor`、シナリオロード、仮想時計、障害注入は `scope: "sandbox-control"` かつ admin/platform actor が必要です。Sandbox Inspector はデモ検証用の運営画面です。

実行時状態は、ブラウザでは IndexedDB を正本として保存し、`stateVersion` で楽観的競合を検出します。`/api/sandbox/state` などのD1経路はoperator/control APIとして分離され、ブラウザからbearer tokenを受け取りません。D1 bindingを使うWorkerデプロイでは、`FURIMA_D1_API_TOKEN`（read/通常API）と`FURIMA_D1_CONTROL_TOKEN`（seed/reset/replay/import）を別々に設定し、Access policyで本番URLを保護してください。デプロイ前に `.openai/hosting.json` の `d1` binding を `DB` に設定してください。

```powershell
npm run db:generate
npm run db:migrate:local
npm run db:migrate:remote
npm run types:worker
```

`db:migrate:remote` は対象 D1 のバックアップと適用先確認後に実行してください。D1 のバックアップ、保持期間、復旧演習はデプロイ環境の運用手順にも登録してください。
`types:worker` は `wrangler.jsonc` から生成したCloudflare環境型を更新します。設定変更後は生成差分を確認してからコミットしてください。
WorkerのCron Triggerは15分ごとにD1の期限切れcommand/previewを削除します。D1 bindingが未設定のローカルfixtureではcleanupをスキップします。

## 画像・カタログ運用

`public/images/products/pexels-selected/` だけが実行時の商品画像です。参考スクリーンショットは `docs/reference-assets/` に移し、公開静的 asset から除外しています。`npm run assets:audit` は公開対象の総量80MiB budgetと2MiB以上のファイルを確認します。

カタログAPIは `limit` 最大40、`offset`、`q`、`category` に対応し、ブラウザはページ単位で取得します。実運用では CDN の Brotli 圧縮、ETag/If-None-Match、検索インデックス、R2 画像配信を追加してください。

## カタログ画像とローカル収集

採用済みの商品画像は `public/images/products/pexels-selected/` に含まれています。50件の分類・商品ファミリー・属性・検索タグは同じフォルダの `catalog-metadata.json` を正本とし、レビュー用に取得した候補画像はコミットせず、`.gitignore` で除外しています。

Pexelsから追加候補を取得する場合は、APIキーを環境変数で渡してください。キーをソースコードや `.env` ファイルにコミットしないでください。

```powershell
$env:PEXELS_API_KEY = "your-key"
python scripts/collect-pexels-candidates.py --target 200
python scripts/curate-catalog-50.py
python scripts/generate-catalog-data.py
```

`PEXELS_API_KEY` が未設定の場合、収集スクリプトは何も取得せず終了します。実行時に使うのは、レビュー後に `pexels-selected` へ移した画像だけです。
