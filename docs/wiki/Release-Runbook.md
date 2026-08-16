# Release Runbook

1. 変更対象を確認し、画像Blob・secret・参考assetを公開対象へ混ぜない。
2. `npm run typecheck`、`npm run lint`、`npm run docs:check`、`npm run qa:matrix`、`npm test`を通す。
3. Pagesは`docs-pages.yml`のActions実行結果と公開URLを確認する。
4. Wikiは`docs/wiki`を正本として`npm run docs:wiki:check`後にWikiへ同期する。
5. 失敗時はPages workflowを停止または直前成功workflowへ戻し、Wikiは直前のコミットへrevertする。

## 公開範囲

PagesにはAPI参照のみを出し、内部の復旧手順、状態payload、個人情報、secret値は載せません。private repositoryでもPagesサイトの可視性設定は別途確認し、チーム限定資料はWikiへ置きます。
