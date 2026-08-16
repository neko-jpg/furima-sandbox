# Media and Drafts

画像はReact stateやlocalStorageにData URLで保存せず、IndexedDB media adapterへBlobとして保存します。Sandbox/D1には`ListingMediaRef`、`imageOrder`、`thumbnailRef`、寸法だけを保存します。

下書きはSandboxのdraftIdと端末側の互換draftを統合表示します。自動保存後も画像参照から復元し、古い参照が無い場合はfallbackを表示して再アップロードを促します。

WebP化の変更を行うときは、MIME実体検査、10MB入力上限、1600px変換、同時処理数制限、D1 payloadからのBlob除外を維持してください。`npm run assets:audit`と`tests/media-store.test.mjs`を実行します。
