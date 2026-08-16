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

API参照サイトは`npm run docs:site`で`output/docs-site`へ生成し、`npm run docs:validate-public`で公開前検査を行います。Wiki資材は`npm run docs:wiki:check`で検証します。

Cloudflare Pagesへの本番デプロイは、API関連差分が`main`へ入ったときだけ`.github/workflows/docs-cloudflare-pages.yml`から実行されます。詳細は[Cloudflare Pages APIドキュメントRunbook](https://github.com/neko-jpg/mercari-ui-kit/blob/main/docs/runbooks/cloudflare-pages-docs.md)を参照してください。
