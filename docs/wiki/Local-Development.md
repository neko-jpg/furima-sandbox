# Local Development

```powershell
npm ci
npm run dev
```

UIだけを軽く確認する場合は`npm run dev`、Cloudflare/D1境界まで確認する場合は`npm run dev:edge`を使います。

## 必須チェック

```powershell
npm run typecheck
npm run lint
npm run docs:check
npm run qa:matrix
npm test
npm run e2e
```

Pages用の参照サイトは`npm run docs:validate-public; npm run docs:site`で`output/docs-site`へ生成します。Wiki資材は`npm run docs:wiki:check`で検証します。
