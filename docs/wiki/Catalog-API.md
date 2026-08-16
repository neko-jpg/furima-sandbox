# Catalog API

通常の初期取得は24件、一覧の上限は40件です。全カタログを初回に転送せず、`offset`、`limit`、`q`、`category`で必要な範囲だけ取得します。

```ts
api.catalog.list({ offset: 0, limit: 24, query: 'ニット' });
api.catalog.get(itemId);
```

HTTPカタログはETagと`If-None-Match`を使い、変更なしは304で再利用します。一覧用サムネイルと詳細画像を分け、WebPなど最適化済みの実行時assetを使います。
