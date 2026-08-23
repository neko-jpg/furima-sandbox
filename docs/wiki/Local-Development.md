# Local Development

```powershell
npm ci
npm run dev
```

UIだけを軽く確認する場合は`npm run dev`、Cloudflare/D1境界まで確認する場合は`npm run dev:edge`を使います。

Docker上のUI/fixtureを確認する場合は、通常起動に次を使います。

```powershell
docker compose up --build
```

編集中のソースをDockerへ自動同期する場合は、Docker Compose 2.22以降のWatchを使います。

```powershell
docker compose up --build --watch
```

Composeはホストのソースをbind mountせず、イメージ内のソースを起動時に使います。`--watch`を付けた場合だけソースを同期し、`package.json`または`package-lock.json`の変更時はイメージを再buildします。

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

Cloudflare Pagesへの本番デプロイは、API関連差分が`main`へ入ったときだけ`.github/workflows/docs-cloudflare-pages.yml`から実行されます。詳細は[Cloudflare Pages APIドキュメントRunbook](https://github.com/neko-jpg/furima-sandbox/blob/main/docs/runbooks/cloudflare-pages-docs.md)を参照してください。
