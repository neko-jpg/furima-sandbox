# Furima Sandbox UI Kit

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
```

## Agent API

ブラウザ上では `window.__SHOP_API__` から安定したAPIオブジェクトを取得できます。後方互換のため `window.__MERCARI_API__` も同じオブジェクトを指します。

読み取りには `getSnapshot()`, `getItems()`, `getItem(id)`, `searchItems(query)`、操作には `setLiked`, `startPurchase`, `confirmPurchase`, `createListingDraft`, `submitListing` などを使います。操作結果は `ActionResult` で返り、`idempotencyKey`, `getActionTrace()`, `resetScenario()` に対応しています。

購入や出品はUIだけでなくdomain action側でも入力と状態を検証します。

## カタログ画像とローカル収集

採用済みの商品画像は `public/images/products/pexels-selected/` に含まれています。レビュー用に取得した候補画像はコミットせず、`.gitignore` で除外しています。

Pexelsから追加候補を取得する場合は、APIキーを環境変数で渡してください。キーをソースコードや `.env` ファイルにコミットしないでください。

```powershell
$env:PEXELS_API_KEY = "your-key"
python scripts/collect-pexels-candidates.py --target 200
python scripts/generate-catalog-data.py
```

`PEXELS_API_KEY` が未設定の場合、収集スクリプトは何も取得せず終了します。実行時に使うのは、レビュー後に `pexels-selected` へ移した画像だけです。
