# Sandbox State API

Sandboxは決定的なseedと`stateVersion`を持つ状態機械です。IndexedDB、Memory fallback、D1 adapterは同じpayloadとCAS契約を共有します。

## 状態境界

- `follows`: follower/followeeと作成日時だけを保存
- `wallets`: 台帳から残高を再計算
- `profiles`: 表示プロフィールと`avatarRef`だけを保存
- `items`: 商品のメディア参照と順序だけを保存
- 画像Blob、Data URL、外部URLはSandbox状態に保存しない

## actor分離

通常actorは自分のウォレット・取引・フォロー一覧だけを取得できます。管理操作は`scope: 'sandbox-control'`とadmin/platform actorに限定します。D1環境では未認証401、権限不足403、CAS競合409です。

状態を変更する前に`expectedStateVersion`を付け、失敗時は現在のsnapshotを再取得してください。
