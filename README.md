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
