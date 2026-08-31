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
