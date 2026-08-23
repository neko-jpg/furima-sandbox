# Sandbox State API

Sandboxは決定的なseedと`stateVersion`を持つ状態機械です。IndexedDB、Memory fallback、D1 adapterは同じpayloadとCAS契約を共有します。

## 状態境界

- `follows`: follower/followeeと作成日時だけを保存
- `wallets`: 台帳から残高を再計算
- `profiles`: 表示プロフィールと`avatarRef`だけを保存
- `items`: 商品のメディア参照と順序だけを保存
- 画像Blob、Data URL、外部URLはSandbox状態に保存しない

## actor分離

通常actorは自分のウォレット・取引・フォロー一覧だけを取得できます。Sandbox全体状態の`GET/PUT /api/sandbox/state`は`FURIMA_D1_CONTROL_TOKEN`によるoperator/control認証に限定し、通常のAPI tokenでは利用できません。管理操作は`scope: 'sandbox-control'`とadmin/platform actorに限定します。D1環境では未認証401、権限不足403、CAS競合409です。

状態を変更する前に`expectedStateVersion`を付け、失敗時は現在のsnapshotを再取得してください。

## HTTP control操作

`POST /api/sandbox/reset`、`POST /api/sandbox/seed`、`POST /api/sandbox/replay`は`FURIMA_D1_CONTROL_TOKEN`を使うcontrol APIです。seed/resetで作成した保存済みSandboxへ続けてreplayする場合は、bodyに`fromStored: true`を指定して現在の保存状態を基準にします。指定しないreplayはseedとaction列から新しい基準状態を作るため、保存済み状態の`stateVersion`が進んでいれば`STATE_CONFLICT`で停止します。

同じ`idempotencyKey`を同じactionで再送した場合は保存済み結果を返し、副作用を再実行しません。異なるpayloadの再利用や一部actionだけが保存済みのbatchは`IDEMPOTENCY_CONFLICT`です。`POST /api/sandbox/preview`は候補commandだけを保存し、live state、stateVersion、ETagを変更しません。
