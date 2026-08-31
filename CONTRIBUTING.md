# Contributing

## 開発環境とモード

- Nodeはルートの`.nvmrc`に固定し、npmは`package.json`の`packageManager`に合わせます。依存関係は`npm install`ではなく`npm ci`でlockfileから再現してください。
- `npm run check:shared`: 固定Nodeと共有用コンテナファイルの最小チェックです。変更前後に実行します。
- `npm run dev`: 軽量UI開発。ローカルfixtureで起動し、通常の編集/HMRに使います。既定URLは<http://localhost:3000>です。
- `docker compose up --build`: Node版UI/fixtureを起動します。編集中のソースを自動同期する場合は`docker compose up --build --watch`を使います。Dockerは本番Cloudflare Workerと同じruntimeではありません。
- ComposeにはFurima UIと出品写真アシスタントFastAPIが含まれます。通常は`fixture`で起動し、LiveKit Agentとrembgは`--profile live`を付けた場合だけ起動します。
- Python依存はルートの`pyproject.toml`と`uv.lock`を正本にします。`uv sync --frozen`で開発依存を含めて再現し、`uv run pytest -q`でPythonテストを実行します。
- `npm run dev:edge`: WranglerでCloudflare Worker/D1相当を確認します。UI/fixture用Composeとは別経路です。
- `npm run build`: `dist`と`.next`を削除してからクリーンビルドします。

手動のUI/fixture起動では`FURIMA_LOCAL_FIXTURE_MODE=true`と`FURIMA_STORAGE_MODE=memory`を設定します。`memory`はローカルfixture専用のin-process storeを選択します。Workerで永続化する場合は`FURIMA_STORAGE_MODE=d1`と`DB` bindingを設定し、D1が利用できなければ起動・healthが失敗する前提です。ブラウザUIのSandbox aggregateは引き続きIndexedDBを正本とします。

## 変更前後の確認

次の順で実行してください。

1. npm run check:shared
2. npm run typecheck
3. npm run lint
4. npm run types:worker
5. npm run docs:check
6. npm test
7. npm run assets:audit
8. npm audit --omit=dev

監査時点の`npm audit --audit-level=high`は0件です。依存更新時は同じ監査を再実行し、High/Criticalが出た場合は内容を確認してから対応します。`npm audit fix --force`のような破壊的な置換は、影響を確認せず実行しません。

出品画面を変更した場合は、390x844と1440x900で次も確認します。

- 開いた直後のwindowスクロールとフロー内スクロールが0
- 1、4、19、20枚の追加と21枚目の拒否
- カメラ入力、アルバム入力、削除、表紙変更、ドラッグ/左右キー並べ替え
- 下書きの保存、復元、複製、削除
- 購入開始後の編集拒否

## 契約の正本

APIの変更は先に docs/api/openapi.yaml と docs/api/error-codes.md を更新してください。ブラウザAPIの互換名は削除せず、deprecatedにして移行手順を記載します。

## PR

PRには、変更範囲、リスク、テスト結果、UI変更時のスクリーンショット、DB/R2 migrationの有無を記載します。大きな機能は、画面、ドメイン、API契約、運用の4つに分けてレビューできる粒度にしてください。
