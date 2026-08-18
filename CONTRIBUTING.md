# Contributing

## 開発モード

- npm run dev: 軽量UI開発。ローカルfixtureで起動し、通常の編集/HMRに使います。
- npm run dev:edge: WranglerでCloudflare Worker/D1相当を確認します。D1/R2の接続設定がある環境で利用してください。
- npm run build: distと.nextを削除してからクリーンビルドします。

## 変更前後の確認

次の順で実行してください。

1. npm run typecheck
2. npm run lint
3. npm run types:worker
4. npm run docs:check
5. npm test
6. npm run assets:audit
7. npm audit --omit=dev

`npm audit`全体では、現行`vinext`が固定する`image-size`のhigh advisoryが残ります。これはビルド時の開発依存で、`npm audit fix --force`はvinextの破壊的な置換を伴うため実行しません。更新時にvinext側の修正版を再確認してください。

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
