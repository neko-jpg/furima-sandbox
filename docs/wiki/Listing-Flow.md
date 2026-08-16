# Listing Flow

出品フローは写真、商品情報、条件・配送・価格、公開前確認の4段階です。

- 写真はカメラ撮影またはアルバム選択、最大20枚
- カメラはsecure contextの`getUserMedia`、拒否時は`capture="environment"`入力へフォールバック
- JPEG/PNG/WebP/AVIF/GIFを検査し、最大1600pxのWebP等へ変換
- 追加順、削除、表紙指定、並べ替え、再試行を提供
- 商品名40文字、説明1,000文字、価格300〜9,999,999円

出品画面と商品詳細はbodyスクロールをロックし、デバイスフレームではabsolute、通常画面ではfixedです。下部ナビとInspectorが重ならないようsafe-area込みの余白を確保します。
