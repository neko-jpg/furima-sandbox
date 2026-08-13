# Furima Sandbox

Furima Sandboxは、架空ユーザーが同じ市場を共有する、動作するフリマアプリのサンドボックスです。見た目を再現するだけでなく、出品、購入、支払い、発送、配送、相互評価、売上確定までを一つの市場状態として扱います。

現在はユーザー側の体験を実装しています。画面上部の「サンドボックスを開く」からNatsuki、サクラ、TechGeek、izuへ切り替えられます。初期シナリオではNatsukiがサクラの商品を購入済みです。

1. Natsukiとして購入履歴を確認
2. サクラへ切り替えて発送通知
3. Natsukiへ戻って配送完了・受取評価
4. サクラへ戻って購入者評価・売上確定

同じ取引を買い手と売り手の両側から進めるため、ユーザー間の循環と各役割の見え方を確認できます。

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

ブラウザ上では `window.__FURIMA_SANDBOX_API__` から安定したAPIオブジェクトを取得できます。後方互換のため `window.__SHOP_API__` と `window.__MERCARI_API__` も同じオブジェクトを指します。

主な読み取りAPI:

- `getWorldState()` — ユーザー、出品、取引、決済、配送、評価、通知、タスク、監査履歴をまとめて取得
- `getSnapshot()` — 現在の画面状態とアクティブユーザーを取得
- `getPersonas()` — 切り替え可能な架空ユーザーを取得
- `getActivity()` — 市場イベントを新しい順に取得
- `getItems()`, `getItem(id)`, `searchItems(query)` — 商品データを取得
- `getActionTrace()` — Agent API経由の操作履歴を取得

主な操作API:

- `switchPersona(userId)`
- `createListingDraft()`, `submitListing()`, `listItem()`
- `startPurchase()`, `confirmPurchase()`, `completePayment()`
- `markAsShipped()`, `advanceShipment()`, `rateTransaction()`
- `setLiked()`, `setSaved()`, `placeBid()`
- `resetScenario()`

操作結果はすべて `ActionResult` で返り、`requestId` と `idempotencyKey` による重複実行防止に対応しています。

```js
const api = window.__FURIMA_SANDBOX_API__;
api.getPersonas();
api.switchPersona('user-サクラ');
api.getWorldState();
```

購入や出品はUIだけでなくdomain action側でも入力と状態を検証します。
