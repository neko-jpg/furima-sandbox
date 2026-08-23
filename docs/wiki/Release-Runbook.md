# Release Runbook

1. 変更対象を確認し、画像Blob・secret・参考assetを公開対象へ混ぜない。
2. `npm run typecheck`、`npm run lint`、`npm run docs:check`、`npm run qa:matrix`、`npm test`、`npm run security:audit`、`npm run qa:static`、`npm run security:schemathesis`、`npm run e2e:pr`、`npm run load:smoke`を通す。
   MCPをデモ経路で使う場合は、ローカルのinspectだけで完了扱いにせず、保護CIで`SNYK_TOKEN`を設定したMCP-Scan hosted analysisも成功させる。push/nightly CIはsecret未設定時に停止する。
3. Cloudflare PagesはDirect Uploadで`main`だけへdeployし、`verify` workflow成功後に`docs-cloudflare-pages.yml`が動くこと、Pages側のAccess policyで本番ホストを保護したことを確認してから、Actions実行結果と公開URLを確認する。
4. Wikiは`docs/wiki`を正本として`npm run docs:wiki:check`後にWikiへ同期する。
5. 失敗時はCloudflare Pagesの直前成功deploymentへ戻し、必要ならWikiは直前のコミットへrevertする。

## 公開範囲

Cloudflare PagesにはAPI参照のみを出し、内部の復旧手順、状態payload、個人情報、secret値は載せません。PagesはCloudflare Accessで招待ユーザーだけに公開し、チーム限定の運用資料はWikiへ置きます。
canonical URLにAccessを設定していても個別のdeployment/Preview URLが同じ保護になるとは限らないため、未認証で拒否されることを確認するまでそれらのURLを共有しません。200を返す場合は、Access範囲を修正するか、公開ドキュメントとして扱うことを明示するまでリリースを止めます。
