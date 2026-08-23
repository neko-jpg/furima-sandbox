# API Overview

## 正本と公開先

OpenAPIの正本は [`docs/api/openapi.yaml`](https://github.com/neko-jpg/furima-sandbox/blob/main/docs/api/openapi.yaml) です。Cloudflare Pagesはこの正本から生成した参照で、Browser API・Listing Flow・Error CodesのガイドはPagesと同じMarkdownをWikiへ同期します。

## 契約の共通項目

書き込みは `ActionResult<T>` を返し、`stateVersion`、`operationId`、actor、Sandbox、modeを追跡できます。状態更新では `expectedStateVersion`、再送では `idempotencyKey` を使います。

## 主な領域

- Catalog: ページングされた商品一覧と商品詳細
- Listings: 下書き、公開、停止、再開、再出品
- Wallet: Sandbox仮想残高、保留、売上、返金、台帳
- Profile: 表示名、自己紹介、画像参照
- Social: フォロー中、フォロワー、公開フォロー概要

API契約を変更するPRでは、先にOpenAPI・Browser API・エラーコードを同じ変更で更新し、`npm run docs:check`を通します。

## APIドキュメントサイト

- [Cloudflare Pages API Reference](https://mercari-ui-kit-api-docs.pages.dev/)
- [Browser API](Browser-API)
- [Listing Flow](Listing-Flow)
- [Error Codes](Error-Codes)
