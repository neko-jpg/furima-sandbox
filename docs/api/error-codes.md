# Error Codes

| Code | Meaning | Retry |
| --- | --- | --- |
| ITEM_NOT_FOUND | 商品が存在しない | No |
| DRAFT_NOT_FOUND | 下書きが存在しない、または削除済み | No |
| AUTH_REQUIRED | ログインが必要 | After auth |
| FORBIDDEN | actorに権限がない | No |
| INVALID_INPUT | 入力形式・文字数・画像参照が不正 | After correction |
| INVALID_TAB | 不明な画面タブ | No |
| POLICY_BLOCKED | 禁止物・個人情報・外部画像などで拒否 | After correction |
| POLICY_REVIEW_REQUIRED | 運営審査が必要 | No |
| STATE_CONFLICT | stateVersionまたはETagが競合 | Yes after reload |
| IDEMPOTENCY_CONFLICT | 同じキーに異なるpayloadを送信 | No; use new key |
| INVALID_TRANSITION | 現在の出品・取引状態では操作不可 | No |
| ALREADY_SOLD | 売却済み | No |
| PURCHASE_INTENT_EXPIRED | 購入予約期限切れ | Start again |
| PAYMENT_FAILED | 支払い失敗 | Retry payment |
| TRANSACTION_NOT_FOUND | 取引が存在しない | No |
| INVALID_AMOUNT | 金額が不正 | After correction |
| INSUFFICIENT_FUNDS | 利用可能残高が不足している | Deposit or reduce amount |
| WALLET_NOT_FOUND | actorのウォレットが存在しない | No |
| FOLLOW_TARGET_NOT_FOUND | フォロー対象のactorが存在しない、または公開対象でない | No |
| ALREADY_FOLLOWING | すでにフォローしている | No |
| NOT_FOLLOWING | フォローしていない対象を解除しようとした | No |
| CANNOT_FOLLOW_SELF | 自分自身はフォローできない | No |
| BID_TOO_LOW | 入札額が現在値以下 | After correction |
| NOT_AUCTION | オークションでない | No |
| AUCTION_ENDED | オークション終了済み | No |
| NO_RESULTS | 検索結果なし | Query correction |
| UNSUPPORTED_CATEGORY | 対象外カテゴリー | Correction |
| INVALID_ACTOR | actorが不明 | No |
| CONFIRMATION_REQUIRED | 確認操作が必要 | After confirmation |
| UNKNOWN_SCENARIO | Sandboxシナリオが不明 | No |
| PREVIEW_NOT_FOUND | previewが存在しない、または別Sandboxのpreview | No |
| PREVIEW_EXPIRED | previewの有効期限が切れている | Create preview again |
| SANDBOX_NOT_READY | IndexedDB/D1からSandbox状態を復元中 | Wait for ready |
| D1_UNAVAILABLE | 永続化用D1が利用できない | Retry after service recovery |
| PAYLOAD_TOO_LARGE | requestまたはstate payloadが上限超過 | Reduce payload |
| INVALID_STATE | Sandbox state envelopeまたは保存済み結果が壊れている | Reset or repair state |
| REPLAY_FAILED | replay command列の途中で失敗した | Fix action at reported index |
| STATE_NOT_FOUND | 指定Sandboxの保存済みstateが存在しない | Seed or reset Sandbox |
| INVALID_STATE_ID | Sandbox IDの形式が不正 | Use an allowed ID |
| AUTH_NOT_CONFIGURED | デプロイ環境のAPI認証Secretが未設定 | Configure the secret |
| FEATURE_NOT_AVAILABLE | Sandbox対象外機能を実行しようとした | Use a supported feature |

HTTP APIでは、未認証は401、権限不足は403、状態競合は409、D1利用不能は503、状態payload上限超過は413です。エラーに details.retryable がある場合だけ自動再試行を許可します。

`AUTH_NOT_CONFIGURED` は、D1環境で `FURIMA_D1_API_TOKEN` が設定されていないため安全側に停止した状態です。デプロイ環境ではトークンをSecretとして設定し、ローカルfixtureではlocalhostのみ認証を省略します。
