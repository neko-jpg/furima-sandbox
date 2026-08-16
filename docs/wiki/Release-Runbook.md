# Release Runbook

1. 変更対象を確認し、画像Blob・secret・参考assetを公開対象へ混ぜない。
2. `npm run typecheck`、`npm run lint`、`npm run docs:check`、`npm run qa:matrix`、`npm test`を通す。
3. Cloudflare PagesはDirect Uploadで`main`だけへdeployし、Pages側のAccess policyで本番ホストを保護したことを確認してから、`docs-cloudflare-pages.yml`のActions実行結果と公開URLを確認する。
4. Wikiは`docs/wiki`を正本として`npm run docs:wiki:check`後にWikiへ同期する。
5. 失敗時はCloudflare Pagesの直前成功deploymentへ戻し、必要ならWikiは直前のコミットへrevertする。

## 公開範囲

Cloudflare PagesにはAPI参照のみを出し、内部の復旧手順、状態payload、個人情報、secret値は載せません。PagesはCloudflare Accessで招待ユーザーだけに公開し、チーム限定の運用資料はWikiへ置きます。
