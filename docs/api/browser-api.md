# Browser API

window.__SHOP_API__ と window.__MERCARI_API__ は同じAPIブリッジを参照します。既存の名前は互換性のため維持し、新しい操作は両方から利用できます。

## 共通契約

すべての書き込み操作は ActionResult<T> を返します。

~~~ts
type ActionResult<T> =
  | { ok: true; data: T; stateVersion: number; meta: ActionMetadata; events?: DomainEvent[]; nextActions?: string[] }
  | { ok: false; error: AgentErrorCode; message?: string; stateVersion: number; meta: ActionMetadata; details?: unknown };

type ActionMetadata = {
  sandboxId: string;
  actorId: string;
  stateVersion: number;
  operationId: string;
  commandId?: string;
  requestId?: string;
  idempotencyKey?: string;
  mode: 'preview' | 'commit';
};
~~~

expectedStateVersion、requestId、idempotencyKey、actorId、scopeは必要な操作だけに渡します。状態更新でバージョンが一致しない場合は STATE_CONFLICT を返し、呼び出し側は最新状態を取得してから再試行します。
すべてのBrowser APIのActionResultにはsandboxId、actorId、stateVersion、operationId、modeを含むmetaが付きます。sandboxIdが異なる操作は拒否されます。

復元完了前の変更操作は `SANDBOX_NOT_READY` になります。Agentは最初に次を待ち、ページ再読み込みや別Worker後も同じSandboxのsnapshotを使ってください。

~~~ts
await api.waitForReady();
~~~

IndexedDBが利用できない場合はMemory fallbackへ切り替え、理由を`window.__FURIMA_SANDBOX_DIAGNOSTICS__`へ公開します。`backend`、`fallbackReason`、`migratedLegacyLocalStorage`を確認でき、永続化に失敗した状態を無言で見逃さないための診断情報になります。

## カタログ

~~~ts
window.__SHOP_API__?.catalog.list(
  { offset: 0, limit: 24, query: 'ニット', category: 'レディース' },
  { requestId: 'req-123' },
);

window.__SHOP_API__?.catalog.get('item_123');
~~~

catalog.listの通常limitは24、最大40です。全カタログをクライアントへ一括取得する用途には使いません。HTTP /api/catalog は ETag / If-None-Match とページ情報ヘッダーを返します。

## 出品下書き

~~~ts
const created = api.saveListingDraft({
  title: 'ニット',
  description: '着用回数は少なめです。',
  price: 3000,
  category: ['レディース', 'トップス'],
  condition: '目立った傷や汚れなし',
  imageRefs: ['media_abc'],
});

api.getListingDrafts();
api.saveListingDraft({ draftId: created.data.draftId, price: 2800 });
api.deleteListingDraft(created.data.draftId);
~~~

画像本体はBlobとしてブラウザのIndexedDBまたは将来のR2アダプターに置き、ReactのプレビューはObject URLを使います。Sandbox/D1状態には imageRefs と順序・寸法・サムネイル参照だけを保存します。旧 images: string[] は読み込み互換のため残していますが、新規クライアントでは使用しません。

## 出品後操作

現時点では`window.__SHOP_API__` / `window.__MERCARI_API__`が実装済みの実行経路です。`/api/listings*`のHTTP形式はOpenAPIで先に固定し、D1 adapter接続時に同じドメイン操作へ接続します。

~~~ts
api.listOwnListings();
api.updateListing(itemId, { price: 2800 }, { expectedStateVersion: 12 });
api.pauseListing(itemId);
api.resumeListing(itemId);
api.relistItem(itemId);
~~~

購入予約または取引開始後の編集はドメインで拒否されます。UIのdisabledだけを権限制御として扱わないでください。

## PreviewとCommit

購入、出品公開、Sandboxウォレット入出金は、状態を変更しないpreviewと実際に反映するcommitへ分けられます。previewは現在のstateVersionを固定し、状態が変わった場合のcommitをSTATE_CONFLICTで止めます。

~~~ts
const preview = api.previewAction('purchase', { itemId: 'item_123' }, { actorId: 'buyer_01' });
if (preview.ok) {
  const committed = api.commitPreview(preview.data.previewId, {
    actorId: 'buyer_01',
    idempotencyKey: 'purchase-item_123-001',
  });
}
~~~

同じidempotencyKeyで同じcommitを再送しても、処理結果だけを再利用します。異なるpayloadを同じキーで送ると IDEMPOTENCY_CONFLICT になります。

## ウォレット（Sandbox専用）

外部決済には接続せず、現在のactor本人の仮想ウォレットだけを操作します。入出金・決済保留・確定・返金・売上・手数料はすべて台帳へ記録され、結果には更新後の `stateVersion` が含まれます。

~~~ts
const wallet = api.getWallet({ actorId: 'buyer_01' });
api.depositWallet(5000, { actorId: 'buyer_01', expectedStateVersion: wallet.stateVersion });
api.withdrawWallet(1000, { actorId: 'buyer_01' });
~~~

金額は1〜1,000,000円の整数です。`availableBalance`だけが出金対象で、`heldBalance`は取引完了または返金まで出金できません。残高不足は `INSUFFICIENT_FUNDS`、ウォレット未作成は `WALLET_NOT_FOUND` です。状態競合は `STATE_CONFLICT` として返され、最新スナップショットを取得してから再試行します。

## カメラとメディア

出品画面の「カメラで撮影」は、secure contextで `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })` を使い、videoプレビューをCanvasのJPEGへ変換して既存の画像処理へ渡します。権限拒否・非対応・非secure環境では `capture="environment"` の端末入力へフォールバックします。閉じる、切替、アンマウント時には全 `MediaStreamTrack` を停止します。

画像本体はIndexedDB（本番R2アダプター）に保存し、Sandbox/D1には `imageRefs`、寸法、順序、`avatarRef` などの参照だけを保存します。Data URL・Blob URLを状態へ永続化しません。

## プロフィール

~~~ts
api.getProfile('buyer_01');
api.updateProfile({ displayName: '表示名', bio: '自己紹介', avatarRef: 'media_profile_01' }, { expectedStateVersion: 8 });
~~~

表示名は1〜60文字、自己紹介は500文字以内です。連絡先や外部URLは `INVALID_INPUT` で拒否します。actor identityは変更できず、通常権限では自分のプロフィールだけ更新できます。

## フォローリスト

フォロー関係はSandbox状態の `follows` 配列へ保存され、IndexedDB/D1の再hydration、export/import、stateVersion競合の対象になります。画像やBlobはこの状態へ含めません。通常actorは自分のフォロー中・フォロワー一覧だけを取得でき、プロフィール概要は公開件数と自分からのフォロー状態だけを返します。

~~~ts
const following = api.getFollowList('following');
const followers = api.getFollowList('followers');
const seller = api.getFollowSummary('seller_01');
const created = api.followUser('seller_01', { expectedStateVersion: seller.stateVersion });
api.unfollowUser('seller_01');
~~~

`followUser` と `unfollowUser` は現在のauthenticated actor本人として実行され、自己フォロー、存在しないactor、重複フォロー、未フォロー解除をドメインで拒否します。結果には `following`、対象の `summary`、更新後の `stateVersion`、通常操作では `mode: 'commit'` のmetaが含まれます。`ALREADY_FOLLOWING`、`NOT_FOLLOWING`、`CANNOT_FOLLOW_SELF`、`FOLLOW_TARGET_NOT_FOUND` は入力を修正してから再試行してください。

## 権限

- ローカルfixture: 認証なしで参照できます。
- seller: 下書き作成・自分の出品操作を実行できます。
- buyer/guest: 出品操作は AUTH_REQUIRED または FORBIDDEN です。
- admin/platform: sandbox-controlの状態バックアップ・審査操作を実行できます。
- D1接続時: 未認証は401、権限不足は403を返します。
