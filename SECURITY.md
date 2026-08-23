# Security notes

このリポジトリは、実データや本番認証情報を扱わない Furima Sandbox の開発用コードです。報告・検証用のログ、API token、Access 設定、個人情報は issue や pull request に貼り付けないでください。

## 共有前の境界

- `FURIMA_LOCAL_FIXTURE_MODE=true` はローカル開発時だけ使用し、公開 Worker の環境変数には設定しない。
- `FURIMA_STORAGE_MODE` は `memory` または `d1` を明示する。共有・staging・production では D1 を選び、binding 不足を許容しない。
- `FURIMA_D1_API_TOKEN` と `FURIMA_D1_CONTROL_TOKEN` はリポジトリへ保存せず、デプロイ環境の secret 管理機能だけで設定する。
- 画像最適化は同一 Worker の allowlist 済み asset のみを対象にし、入力形式・入力/出力サイズ・幅・品質・処理時間を制限する。

## 依存関係の注意

監査時点では `npm audit --audit-level=high` は0件です。依存更新時は `npm audit --omit=dev` と `npm audit` を再実行し、画像最適化の境界テストも再実行してください。High/Criticalが再発した場合は、修正版の適用またはリスク受容者・再確認日をリリース記録へ登録してから外部公開します。

MCPをデモ経路で使う場合、`npm run security:mcp`のローカルtokenなし実行はMCP server定義のinspectだけです。protected CIのpush/nightlyでは`SNYK_TOKEN`を必須とし、hosted analysisが未実行ならジョブを成功扱いにしません。

## 報告

再現手順、影響範囲、対象 commit を含めて、リポジトリの非公開のチーム連絡経路へ報告してください。公開 issue には未修正の脆弱性情報や token を投稿しないでください。
