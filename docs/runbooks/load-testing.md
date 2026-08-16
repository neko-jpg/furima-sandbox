# Sandbox負荷試験

負荷試験は本番データやremote D1へ書き込まず、指定したHTTP origin上に一時Sandboxを20個作って実行する。各actorは固有の` sandboxId`と冪等キーを使い、catalog読み取り、health、state、wallet preview/commit、同一commitの再送を混在させる。

```powershell
npm run build
npm run load:smoke
```

既に起動済みのサーバーを使う場合は、次のように指定する。

```powershell
$env:SANDBOX_BASE_URL = 'http://127.0.0.1:3001'
npm run load:smoke -- --no-start
```

Nightly／提出前の完全試験は以下を使う。

```powershell
npm run load:full
```

`output/load/latest.json`へ、実測RPS、error rate、p50/p95/p99、HTTP status別件数、state invariant違反、重複mutation、idempotency再送結果を保存する。合格基準はerror rate `< 0.5%`、p95 `< 750ms`、p99 `< 1,500ms`、invariant violation 0件、重複mutation 0件。標準スモーク（5秒以上、2 actor以上、10 req/s以上）では、冪等性再送も1件以上実行される。`--base-url`で別のlocal／Preview originを指定できるが、remote D1を対象にする場合は必ず専用Sandboxと明示的な許可を用意する。
