# Security notes

このリポジトリは、実データや本番認証情報を扱わない Furima Sandbox の開発用コードです。報告・検証用のログ、API token、Access 設定、個人情報は issue や pull request に貼り付けないでください。

## 共有前の境界

- `FURIMA_LOCAL_FIXTURE_MODE=true` はローカル開発時だけ使用し、公開 Worker の環境変数には設定しない。
- `FURIMA_STORAGE_MODE` は `memory` または `d1` を明示する。共有・staging・production では D1 を選び、binding 不足を許容しない。
- `FURIMA_D1_API_TOKEN` と `FURIMA_D1_CONTROL_TOKEN` はリポジトリへ保存せず、デプロイ環境の secret 管理機能だけで設定する。
- 画像最適化は同一 Worker の allowlist 済み asset のみを対象にし、入力形式・入力/出力サイズ・幅・品質・処理時間を制限する。

## 依存関係の注意

現行の `vinext` が間接的に利用する画像処理依存には、upstream の修正版が提供されるまで継続監視が必要な advisory があります。更新時は `npm audit --omit=dev` と `npm audit` の結果を確認し、画像最適化の境界テストを再実行してください。修正版がない状態で外部公開する場合は、platform maintainer がリスク受容者と再確認日をリリース記録へ登録します。

## 報告

再現手順、影響範囲、対象 commit を含めて、リポジトリの非公開のチーム連絡経路へ報告してください。公開 issue には未修正の脆弱性情報や token を投稿しないでください。
