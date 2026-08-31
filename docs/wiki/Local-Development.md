# Local Development

```powershell
npm ci
npm run dev
```

UIだけを軽く確認する場合は`npm run dev`、Cloudflare/D1境界まで確認する場合は`npm run dev:edge`を使います。

Docker上のUI/fixtureを確認する場合は、通常起動に次を使います。

```powershell
docker compose up --build
```

撮影アシスタントを含むfixture縦スライスも同じComposeで起動します。Python依存関係はルートの`pyproject.toml`と`uv.lock`を正本にし、起動前に`uv sync --frozen`を実行します。標準の`PROVIDER_MODE=fixture`ではAIキー、LiveKit資格情報、rembgの起動は不要です。ブラウザの公開URLは`http://127.0.0.1:3001`ですが、provider secretはブラウザへ設定しません。

```powershell
docker compose config --quiet
npm run qa:assistant-compose
docker compose up --build -d assistant-api ui
npm run smoke:assistant-compose
```

実LiveKit／実AI／rembgを確認するときだけ、ローカルの秘密管理から環境変数を読み込み、live profileを明示します。値そのものをリポジトリ、Wiki、ログへ書き出さないでください。

```powershell
$env:PROVIDER_MODE = "live"
$env:VITE_LISTING_ASSISTANT_MODE = "live"
$env:LIVEKIT_URL = "wss://<your-livekit-host>"
$env:LIVEKIT_API_KEY = "<local-secret>"
$env:LIVEKIT_API_SECRET = "<local-secret>"
$env:OPENAI_API_KEY = "<local-secret>"
docker compose --profile live up --build
```

`assistant-api`は`3001`、UIは`3000`で別プロセスです。`assistant-agent`と`rembg`は`live` profileに含まれ、通常のfixture起動で資格情報不足の再起動ループを起こしません。終了時は`docker compose --profile live down`を実行し、撮影途中のsessionデータを永続化しないでください。

Assistant APIのCORSは`http://127.0.0.1:3000`と`http://localhost:3000`だけです。`*`は使用しません。live profileではAgentが`PROVIDER_MODE=live`で動作するため、FastAPI側にも同じ値を設定し、資格情報不足をfixtureへフォールバックさせないでください。

編集中のソースをDockerへ自動同期する場合は、Docker Compose 2.22以降のWatchを使います。

```powershell
docker compose up --build --watch
```

Composeはホストのソースをbind mountせず、イメージ内のソースを起動時に使います。`--watch`を付けた場合だけソースを同期し、`package.json`または`package-lock.json`の変更時はイメージを再buildします。

## 必須チェック

```powershell
npm run docs:check
npm run qa:matrix
npm run docs:site
npm run docs:validate-public
npm run typecheck
npm run lint
npm test
npm run e2e
npm run test:backend:fixture
npm run qa:assistant-compose
docker compose config --quiet
npm run docs:wiki:check
```

撮影アシスタントの純粋関数テストは次で実行します。

```powershell
npm run test:guided-capture
npm run test:backend:fixture
```

API参照サイトは`npm run docs:site`で`output/docs-site`へ生成し、`npm run docs:validate-public`で公開前検査を行います。Wiki資材は`npm run docs:wiki:check`で検証します。

Cloudflare Pagesへの本番デプロイは、API関連差分が`main`へ入ったとき、または明示的な手動実行時だけ`.github/workflows/docs-cloudflare-pages.yml`から実行されます。それ以外の差分ではdeployをskipし、`docs-status`が正常終了を記録します。進行中のdeploymentは後続runで中断せず直列に処理します。canonical URLと`*.mercari-ui-kit-api-docs.pages.dev`は別々のCloudflare Access Applicationで保護し、最新deployment URLも未認証で拒否されることを確認します。詳細は[Cloudflare Pages APIドキュメントRunbook](https://github.com/neko-jpg/furima-sandbox/blob/main/docs/runbooks/cloudflare-pages-docs.md)を参照してください。
