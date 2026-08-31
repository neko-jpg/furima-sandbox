# Listing Photo Assistant Runbook

## Scope

furima-sandboxをフロントエンドとコードの正本にし、Team-Dの最新`main`（統合基準`cd7b42a207fc3912fdd5e8e76ac2e91f7f5f5abe`、初期基準`be5ee304febe14b280fa546fa3cc9704b84e6e8`から更新）から非UIバックエンドだけを移管します。Team-DのReact/Vite画面、CSS、Vite設定、Node APIは起動・配布しません。

移管先はUIを含む4サービスです。

```text
furima UI :3000
  └─ assistant-api :3001 (FastAPI)
       ├─ fixture providers (default)
       └─ live providers (explicit PROVIDER_MODE=live)
  └─ assistant-agent (LiveKit Agent, live profile)
       └─ LiveKit Cloud (external, live mode)
  └─ rembg (private sidecar, live profile)
```

Python依存関係はルートの`pyproject.toml`と`uv.lock`を正本にします。起動前に一度だけ次を実行し、ComposeとCIではlockfileを更新しない`--frozen`経路を使います。

```powershell
uv sync --frozen
```

`assistant-api`のCORSは`http://127.0.0.1:3000`と`http://localhost:3000`だけです。別originから確認する場合は、UI URLとallowlistを同じ変更で明示し、wildcard (`*`) を設定しないでください。

## Fixture smoke

外部資格情報なしで実行します。

```powershell
docker compose config --quiet
npm run qa:assistant-compose
docker compose up --build -d assistant-api ui
npm run smoke:assistant-compose
```

ブラウザで`http://127.0.0.1:3000`を開き、出品フローの写真ステップで「AI撮影アシスタント」を開きます。開始後、front、back、tagの3画像を順に追加し、採寸画像を選択します。AIが返す4端点を確認・編集し、画像内の5cmマーカーの一辺をpxで入力すると、cm換算と必要な射影補正はブラウザ内だけで行われます。着丈・身幅を確認または入力して「採寸値を明示承認」し、写真・採寸の承認完了を確認します。生成背景を使う場合は元画像と比較してから「この画像を明示承認して採用」を押します。

同じフローを2回連続で実行し、次を確認します。

- READY前でも手動カメラ／アルバム入力を使える。
- measurement画像が写真一覧、下書き、出品画像へ入らない。
- front、back、tagと承認済み採寸が揃う前に出品へ進めない。
- 未承認の背景プレビューは出品へ渡らない。
- 写真ステップを閉じるとLiveKit、Worker、Blob、object URLが破棄される。

## Deterministic fixture E2E

fixtureの縦スライスは、次の1コマンドで実行します。事前に`npm ci`、`uv sync --frozen`、PlaywrightのChromiumが利用できる状態にしてください。

```powershell
node scripts/run-listing-photo-assistant-fixture-e2e.mjs
```

このrunnerは空いているloopback portでFastAPIを`PROVIDER_MODE=fixture`として起動し、UIをfixture設定で起動してから、Chromium desktopの専用E2Eを1 workerで実行します。外部provider、LiveKit、実LLMには接続しません。各runではブラウザからHTTP guided-capture adapterと背景providerのfixture契約を直接呼び、背面の2回目だけを`GARMENT_CROPPED`にする決定的な判定応答を注入します。その後、ListingViewのfixture UIでfixture接続、front、back、tag、measurement画像の非保存、端点補正、採寸明示承認、mask、背景生成、比較、背景の明示承認、下書き保存を確認します。UIのfixture接続表示はLiveKit Room接続の代替ではなく、Vinextのfixture実行ではsourceのVITE runtime aliasがブラウザへ公開されない境界があるため、UI操作とHTTP adapter契約の証跡を分けて記録します。

テストが記録する証跡はHTTP endpointの回数、正規化したstate、採寸値、保存済みfront BlobのSHA-256だけです。画像本体、Blob、object URL、Data URL、secret、tokenはログ・report・documentationへ出力しません。出力hashは実行ごとの比較にだけ使い、値を運用記録へ転記しません。fixture transportはLiveKit Room接続の証明ではありません。

## OpenSpec 8.1〜8.8 対応表

| Task | QA証跡 | 判定 | 未実施・境界 |
| --- | --- | --- | --- |
| 8.1 | `node scripts/run-listing-photo-assistant-fixture-e2e.mjs` / `tests/e2e/listing-photo-assistant-fixture.spec.mjs` | fixture-not-run | HTTP adapter/provider契約とUI保存境界を2回比較するfixture E2Eを実装。今回の専用Playwrightは長時間化のため中断し完走未実施。UIはlocal fixture transport、LiveKit Roomとライブ助言も未実施。 |
| 8.2 | 下記「実LLM／LiveKit手動チェックリスト」 | manual-not-run | 実画像、基準iPhone、外部LiveKit、実LLMの操作・性能計測は未実施。 |
| 8.3 | failure matrix（FM-01〜FM-09）とfixtureのFM-04/FM-09 | fixture-not-run | HTTP adapterの理由付きretryと保存境界をfixture E2Eへ実装したが完走未実施。UI内LiveKit retry、切断、権限、mask、背景失敗は手動または別fixture注入が必要。 |
| 8.4 | 既存Playwrightのdesktop/mobile/WebKit設定 + 手動チェック | manual-not-run | Chromiumのviewport emulationはiPhone実機Safariの代替ではない。実機visual/accessibility QAは未実施。 |
| 8.5 | 専用E2Eのmeasurement非保存・Blob hash比較 | fixture-not-run | measurement非保存とBlob hash比較を実装したが専用E2E完走未実施。実Room、Worker、camera track、Worker終了を含む実機lifecycleも未実施。 |
| 8.6 | 専用runnerのfixture起動・health・cleanup | fixture-verified | OpenCV.js/WASM事前load、50mm印刷・実測、rembg prewarm、LiveKit起動は未実施。 |
| 8.7 | 本変更で実行した利用可能な検証コマンド | selected-checks | clean install一式、実機console 0件、外部接続の性能計測はこのQA実行の対象外。 |
| 8.8 | この表、`docs/qa/test-matrix.yaml`、`docs/wiki/Listing-Flow.md` | docs-verified | `openspec validate ...`はfurima-sandboxにCLI/configがないため未実行。 |

詳細な機械可読版は`docs/qa/test-matrix.yaml`の`openspec`と`failureMatrix`です。ステータスはfixtureの成功をlive成功へ読み替えないために分離しています。

## Failure matrix

| ID | 障害・注入点 | 期待する復帰 | この変更での状態 |
| --- | --- | --- | --- |
| FM-01 | LiveKit Room／Agent切断 | 現在step、受理済みslot、固定ガイド、手動撮影を維持し、再接続後に同期済みの新sequenceだけを採用する。 | not-run（manual-live） |
| FM-02 | 順序逆転、別session、期限切れGuidanceEvent | イベントを破棄し、助言とstepを巻き戻さない。 | not-run（manual-live-or-contract） |
| FM-03 | Canvas／Worker解析不可、カメラ権限拒否 | 固定ガイドと手動撮影を残し、端末の画像入力へ移る。 | not-run（manual-device） |
| FM-04 | 撮影後AIが`GARMENT_CROPPED`／retryまたはtimeout | HTTP adapter契約では対象slotだけを理由付きでretryし、UI fixtureでは他slotと画像の保存境界を確認する。timeout時は画像を保持し再試行を提示する。 | implemented-not-run（専用Playwright完走・UI LiveKit retry・timeoutは未実施） |
| FM-05 | marker missing／multiple／too small／occluded、segmentation／端点提案失敗 | 有限の理由、撮り直し、端点配置または手入力を提示し、未承認のままeditへ進めない。 | not-run（manual-fixture-or-live） |
| FM-06 | rembg timeout、空・全面・寸法不一致mask | previewを承認不可にし、再試行または正面原本採用を提示する。 | not-run（manual-live-or-injection） |
| FM-07 | 背景生成timeout、エラー、利用不能画像 | 4slotと承認済み採寸を保持し、再試行または固定背景・正面原本採用へ進む。 | not-run（manual-live-or-injection） |
| FM-08 | 終了、unmount、pagehide、再取得 | camera track、Room、Worker、object URLを解放し、画像・判定・助言・採寸値を永続出品データへ残さない。 | not-run（manual-device-or-live） |
| FM-09 | 同じfixture縦スライスを2回実行 | 正規化最終state、採寸値、保存frontのhashが一致し、measurement一時データが下書きへ入らない。 | implemented-not-run（専用Playwright完走未実施） |

障害確認時は、ログへリクエストbodyや画像をコピーせず、ID、status、有限error code、再現手順だけを記録します。

## Live smoke

秘密値はローカルのsecret managerまたは未追跡環境変数から設定します。ブラウザへ渡すのは`VITE_LISTING_ASSISTANT_API_URL`、公開LiveKit URL、短期tokenだけです。`LIVEKIT_API_SECRET`と`OPENAI_API_KEY`を`VITE_*`へ改名してはいけません。

```powershell
$env:PROVIDER_MODE = "live"
$env:VITE_LISTING_ASSISTANT_MODE = "live"
$env:LIVEKIT_URL = "wss://<your-livekit-host>"
$env:LIVEKIT_API_KEY = "<local-secret>"
$env:LIVEKIT_API_SECRET = "<local-secret>"
$env:OPENAI_API_KEY = "<local-secret>"
docker compose --profile live up --build
```

`--profile live`を付けないfixture起動では`assistant-agent`とrembgは起動しません。live profileではAgentが常に`PROVIDER_MODE=live`で動くため、FastAPI側にも必ず`PROVIDER_MODE=live`を設定してから起動します。資格情報不足やprovider障害をfixture成功へ置き換えないでください。

ログ、スクリーンショット、テスト結果へtoken、API key、API secret、画像Blob、Data URLを含めません。APIの`/api/livekit-token`レスポンスにsecretが含まれず、tokenの権限がcamera publish／data publishに限定されることを確認します。

## 実LLM／LiveKit手動チェックリスト（未実施）

このチェックリストは、fixture E2Eの合格を実LLM／LiveKitの合格とみなさないための実行手順です。今回のQAでは、実機iPhone、Safari実機、外部LiveKit、実LLM、実rembg、OpenCV.js/WASMの実ロード、50mmマーカーの印刷・定規実測を実施していません。

- [ ] 新しいterminal sessionで、秘密管理から`PROVIDER_MODE=live`、`VITE_LISTING_ASSISTANT_MODE=live`、LiveKitの接続設定、LLM設定を読み込む。値はshell history、ログ、Issue、スクリーンショットへ残さない。
- [ ] `uv sync --frozen`と`docker compose --profile live up --build`を実行し、FastAPI、`assistant-agent`、private rembgのhealth／起動状態を確認する。fixtureへ自動fallbackしていないことを確認する。
- [ ] `/api/health`が成功し、UIへ公開されるのが公開LiveKit URLと短期tokenだけで、LLM key、LiveKit secret、rembg URLがbrowser bundle／DOM／network logにないことを確認する。
- [ ] `/api/livekit-token`を1セッションで呼び、token自体を保存せずに、短いexpiry、session対応Room、一意identity、camera publishと必要なdata publishだけのgrantを確認する。
- [ ] 基準iPhoneのSafariでカメラ権限を許可し、browser participantがRoomへjoin、camera trackがpublish、AgentがsubscribeすることをLiveKit側のparticipant／track情報で確認する。映像frameや画像bodyは記録しない。
- [ ] `front`、`back`、`tag`で有限codeの助言がpushされ、同一codeの過剰反復がなく、`READY`以外でも手動撮影できることを確認する。別session・古いsequence・期限切れeventを破棄する。
- [ ] 撮影後AIがfront／back／tagだけを判定し、retry時は対象slotだけが戻り、採寸画像がShotAssessorへ送られないことをnetwork metadataで確認する。
- [ ] `4/4 採寸`で、背面Tシャツ、外形50.0mmマーカー、同一平面、30mm以上の間隔、真上撮影を確認する。印刷倍率100%と外形1辺50mmの実測結果だけを記録し、写真は記録しない。
- [ ] marker検証、OpenCV.js/WASMの射影補正、4端点提案、端点修正、着丈・身幅の明示承認を確認し、承認前に背景編集へ進めないことを確認する。
- [ ] rembg maskが元画像と同寸法で、空・全面でなく、背景生成へ商品画像／mask／tag／measurementが渡らないことをrequest metadataで確認する。元RGBが保持されることを比較する。
- [ ] 背景生成失敗、mask無効、Agent切断、LLM timeout、カメラ権限拒否を一つずつ再現し、FM-01〜FM-08の期待復帰を確認する。失敗時は画像bodyを保存しない。
- [ ] 390x844、375x812、430x932、200%文字拡大、safe area、screen reader、reduced motion、44px操作領域、visible focus、長い日本語、背景復帰を確認する。
- [ ] fixture／live各1回の計測で、端末内品質解析4Hz・同時1、Agent同時1、観測から助言表示までのp95、console未処理error 0件を秘密・画像なしの集計値だけで記録する。
- [ ] 終了後にcamera track=`ended`、Room切断、Agent／Worker終了、全object URL revoke、DB／localStorage／IndexedDBに画像・判定・助言・測定点・採寸値なしを確認し、`docker compose --profile live down`を実行する。

未実施項目を実施済みとして報告しないこと。実LLMまたはLiveKitの接続が不安定な場合に、成功fixtureへ差し替えず、原因・再試行可否・保持されたslotだけを報告します。

## Failure recovery

- Agent切断: 固定ガイド、手動撮影、受理済みslotを維持して再接続を表示する。
- API timeout／provider failure: 取得済みの写真は破棄せず、手動入力または再試行へ戻す。
- 権限拒否／secure context以外: 端末の`accept=image/* capture=environment`入力へフォールバックする。
- 画面終了: `docker compose down`後、ブラウザ側の一時sessionは再利用しない。既存メディアへ自動マージしない。

## Verification

```powershell
npm run docs:check
npm run qa:matrix
npm run docs:site
npm run docs:validate-public
npm run typecheck
npm run lint
npm test
npm run test:backend:fixture
npm run qa:assistant-compose
docker compose config --quiet
npm run docs:wiki:check
npm run assets:audit
npm audit --omit=dev
```

起動済みComposeのhealth/smokeは`npm run smoke:assistant-compose`で再実行できます。fixture backend単体は`npm run test:backend:fixture`で実行し、環境に残ったOpenAI／LiveKit／provider URLを空にしてからテストします。

Cloudflare Pagesへのデプロイ、Pagesプロジェクト`mercari-ui-kit-api-docs`、Cloudflare Access設定はこのRunbookのローカル統合では変更しません。デプロイが必要な場合は既存のCloudflare Pages Runbookに従い、先に全検証結果と影響範囲を記録します。
