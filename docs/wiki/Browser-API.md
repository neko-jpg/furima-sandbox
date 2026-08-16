# Browser API

`window.__SHOP_API__` と `window.__MERCARI_API__` は同じ互換ブリッジです。UI操作はContext経由、外部の検証・Playwright・Agent操作はBrowser API経由にします。

```ts
await api.waitForReady();
const list = api.getFollowList('following');
const summary = api.getFollowSummary('seller_01');
api.followUser('seller_01', { expectedStateVersion: summary.stateVersion });
```

画像本体はIndexedDBのBlob、Sandbox状態は`media_*`参照だけです。API payloadにData URL・Blob URLを渡さないでください。

変更操作の失敗はUIのdisabledだけに頼らず、ドメインの`ActionResult.error`を表示します。`STATE_CONFLICT`は最新状態を取得してから、同じpayloadの再送だけは同じidempotency keyで再試行します。
