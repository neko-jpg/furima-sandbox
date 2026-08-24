# Cloudflare Pages APIドキュメントRunbook

## 構成

- 正本: `docs/api/openapi.yaml`
- 生成コマンド: `npm run docs:site`
- 生成先: `output/docs-site`
- Pagesプロジェクト: `mercari-ui-kit-api-docs`
- 本番URL: `https://mercari-ui-kit-api-docs.pages.dev/`
- Access: canonical hostname用と`*.mercari-ui-kit-api-docs.pages.dev`用の2つのSelf-hosted Applicationで保護する
- Scalar: 本番では閲覧専用。Test RequestとAgentは無効。
- Wiki: チーム向けの内部運用資料

Pagesのcanonical hostnameにCloudflare Accessを設定していても、個別のdeployment URL（`*.pages.dev`）やPreview hostnameは自動では保護されません。このプロジェクトではcanonical hostnameを完全一致のApplication、個別deployment/Preview hostnameを`*.mercari-ui-kit-api-docs.pages.dev`のpublic destinationを持つApplicationで保護し、両方に同じメール限定Allow policyを設定します。監査ではcanonical hostnameと最新deployment URLの両方が未認証でCloudflare Accessへリダイレクトされることを確認します。

## 初回構築

1. Cloudflare MCPの`cloudflare-api`でPagesプロジェクトの存在を確認する。
2. 存在しない場合だけ`mercari-ui-kit-api-docs`を作成する。
3. production branchが`main`であることを確認する。現在のDirect Upload workflowは`main`だけへdeployするため、非mainのPreview deploymentは作成しない。
4. Cloudflare Zero Trustを有効化する。
5. PagesプロジェクトのSettings > General > `Enable access policy`を選択する。
6. 作成されたAccess policyの`Manage`からAccess > Applications > 対象アプリをConfigureし、Public hostnameのSubdomainにある`*`を削除して本番ホスト名だけに変更する。必要ならアプリ名を変更して保存する。
7. 個別deployment/Preview URL用にSelf-hosted Applicationを作成し、public destinationを`*.mercari-ui-kit-api-docs.pages.dev`、App Launcher表示を無効にする。canonical用とワイルドカード用の2つのApplicationが存在することを確認する。
8. 両ApplicationのAllow policyのIncludeに、チームから受け取った同じ招待メールだけを登録する。全員許可やドメイン全体許可は設定しない。
9. 未招待アカウントで拒否されることを確認する。
10. 招待アカウントでトップページと`api/openapi.yaml`を確認する。
11. Accessとdeployment/Preview URLの保護を確認してから初回デプロイを行う。

Access許可メール一覧やAPIトークンは、リポジトリ、Wiki、Issue、ログへ保存しません。

## ローカル確認

```powershell
npm ci
npm run docs:check
npm run qa:matrix
npm run docs:site
npm run docs:validate-public
```

Scalarは`output/docs-site/index.html`、`assets/scalar.js`、`assets/scalar.css`から確認できます。

## CIデプロイ

`.github/workflows/docs-cloudflare-pages.yml`は、`main`へのpushに対する`verify` workflowが成功した後に同じコミットをcheckoutします。`docs/api`、Scalarとサイトのエントリ、favicon、サイト生成スクリプト、npmの依存定義のいずれかが直前のコミットから変わった場合だけdocs検証とdeployを実行します。UI、CI、Runbook、Wikiだけの変更ではdeployジョブをスキップし、`docs-status`がデプロイ不要の正常終了を記録します。手動実行は明示的なデプロイ指示として扱い、常にこのworkflow自身のdocs検証を通過してからdeployします。

同じconcurrency groupのrunは直列に処理し、後続runから進行中のdeploymentをcancelしません。`docs-status`は変更検出の失敗、必要なdeploymentの失敗、不要なdeploymentの誤実行を失敗として扱います。手動cancelで残ったGitHub Environmentの履歴はCloudflare deploymentの失敗と区別し、再実行で不要な本番デプロイを発生させません。

必要なGitHub Environment Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Environment `cloudflare-pages`が存在しない場合は、GitHubのSettings > Environmentsで作成してからSecretsを登録します。Secret値はリポジトリやWikiへ書き込まず、登録後は名前だけを`gh secret list --env cloudflare-pages`で確認します。

APIトークンはPagesデプロイに必要な最小権限で作成し、GitHub Actionsのログへ出力しません。

## デプロイ確認

```powershell
npx wrangler pages deployment list --project-name mercari-ui-kit-api-docs
```

確認項目:

- 最新deploymentが成功している
- Scalarトップページが表示される
- OpenAPI YAMLが取得できる
- Access未認証では拒否される
- 招待済みユーザーでは閲覧できる
- 最新deployment URLとPreview URLも未認証ではCloudflare Accessへリダイレクトされる

## 障害対応

1. GitHub Actionsの生成・検証ログを確認する。
2. Pages deploymentログを確認する。
3. 生成物をローカルで再確認する。
4. 同じ原因での連続再試行を避ける。
5. 必要な場合はCloudflare Pagesの前回成功deploymentへロールバックする。
6. 原因、影響、復旧結果をこのRunbookとWikiへ追記する。

リポジトリ側のAPI正本を巻き戻す場合は、先にPRまたはコミット単位で影響範囲を確認します。Cloudflareリソースの削除は行わず、まず前回deploymentへの復旧を優先します。

## GitHub Pages

このリポジトリにはGitHub Pages workflowを置いていません。Cloudflare Pagesが利用できない場合に別ホスティングへ切り替えるときは、公開範囲・Access相当の認証・URLを先に決め、RunbookとWikiを同じ変更で更新します。
