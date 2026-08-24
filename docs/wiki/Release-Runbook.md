# Release Runbook

1. 変更対象を確認し、画像Blob・secret・参考assetを公開対象へ混ぜない。
2. `npm run typecheck`、`npm run lint`、`npm run docs:check`、`npm run qa:matrix`、`npm test`、`npm run security:audit`、`npm run qa:static`、`npm run security:mcp`、`npm run security:schemathesis`、`npm run e2e:pr`、`npm run load:smoke`を通す。
   MCP-Scanは常にローカル`inspect`でMCP定義を検査し、秘密管理した`SNYK_TOKEN`が利用できる場合はhosted解析も自動実行する。hosted解析を必須にする環境では`MCP_SCAN_REQUIRE_HOSTED=true`と`SNYK_TOKEN`を同時に設定する。hosted必須時のsecret欠落、scanner未導入、検出、空の解析結果はいずれも失敗としてリリースを止める。
3. Cloudflare PagesはDirect Uploadで`main`だけへdeployする。`verify` workflow成功後、APIドキュメント生成元に変更がある場合だけ`docs-cloudflare-pages.yml`のdeployジョブが動き、UI、CI、Runbook、Wikiだけの変更ではskipされ、`docs-status`が成功することを確認する。進行中のdeploymentは後続runで中断せず直列に処理する。デプロイ時はPages側のAccess policyで本番ホストを保護したことを確認してから、Actions実行結果と公開URLを確認する。
4. Wikiは`docs/wiki`を正本として`npm run docs:wiki:check`後にWikiへ同期する。
5. 失敗時はCloudflare Pagesの直前成功deploymentへ戻し、必要ならWikiは直前のコミットへrevertする。

## 公開範囲

Cloudflare PagesにはAPI参照のみを出し、内部の復旧手順、状態payload、個人情報、secret値は載せません。PagesはCloudflare Accessで招待ユーザーだけに公開し、チーム限定の運用資料はWikiへ置きます。
canonical URLにAccessを設定していても個別のdeployment/Preview URLが同じ保護になるとは限らないため、未認証で拒否されることを確認するまでそれらのURLを共有しません。200を返す場合は、Access範囲を修正するか、公開ドキュメントとして扱うことを明示するまでリリースを止めます。
