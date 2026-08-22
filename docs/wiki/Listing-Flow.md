# Listing Flow

## 状態遷移

~~~mermaid
stateDiagram-v2
  [*] --> Photos
  Photos --> ProductInfo: 1枚以上 / 最大20枚
  ProductInfo --> ShippingAndPrice: title 1-40 / description <=1000
  ShippingAndPrice --> Review: condition 6段階 / price 300-9999999
  Review --> Draft: 下書き保存
  Draft --> Photos: 再開・復元
  Review --> Active: ポリシー確認して出品
  Active --> Paused: 停止
  Paused --> Active: 再開
  Active --> Reserved: 購入予約
  Reserved --> Sold: 取引開始・購入完了
  Reserved --> Active: 予約解放
  Sold --> [*]
~~~

## 画面ルール

出品中はアプリ内のフルスクリーンルートに切り替えます。ヘッダー・BottomNavは表示せず、フォーム内のスクロール領域を1つだけ設けます。開始時とステップ変更時にその領域を先頭へ戻し、フォーカスは preventScroll: true で移動します。bodyはロックし、終了時は開始前のスクロール位置とフォーカスへ戻します。

## 写真

- 「カメラで撮影」: secure contextではgetUserMediaの背面カメラプレビューを表示し、Canvasで撮影画像を作成する。権限拒否・非対応端末・非secure環境はaccept=image/* capture=environmentの通常入力へフォールバック。
- カメラを閉じる、切り替える、出品画面をアンマウントする時はMediaStreamTrackを必ず停止する。
- 「アルバムから選択」: accept=image/* multiple。
- 最大20枚、モバイル4列・広い画面5列。
- 追加順番号、表紙指定、削除、ドラッグ並べ替え、左右キー並べ替えを提供。
- 1枚10MB以下。JPEG/PNG/WebP/AVIF/GIFを許可し、SVG・外部URL・MIME不一致を拒否。
- 画像処理は同時2枚まで。処理中、失敗、再試行を表示する。
- 1枚目が表紙。表紙指定は配列順を更新し、ListingImageOrderと一致させる。
- 画像本体はBlobとしてIndexedDBへ保存し、画面のプレビューはObject URLを使う。Sandbox/D1へはimageRefsだけを渡し、Data URL・blob URLは保存前に除外する。

## スクロールとフォーカス

出品フローは通常画面ではfixed、デバイスフレームではabsoluteのフルスクリーンルートです。フォーム内のスクロール領域は1つだけで、開始時・ステップ切替時に先頭へ戻します。背景とbodyのスクロールをロックし、フォーカス移動はpreventScrollを使います。終了時だけ開始前のスクロール位置へ復元します。

## 画像解析デモ（モック）

実際のAI審査ではなく、画像ファイル名と固定ルールを使ったモック候補です。title、description、category、condition、colorの各候補は個別に採用・破棄でき、入力済みのユーザー値を上書きしません。公開前に必ず人が確認します。

## 完了条件

公開前に以下をすべて確認します。

1. 商品名、説明、価格、カテゴリー、サブカテゴリー、状態、配送方法。
2. 禁止出品物、外部誘導、個人情報、説明不足。
3. 下書き保存と復元に失敗していないこと。
4. 出品者がポリシーを確認したこと。
