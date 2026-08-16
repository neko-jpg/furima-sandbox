# Sandbox性能調査

ブラウザ側の読み込みは`tests/e2e/performance.spec.mjs`でNavigation Timing、Resource Timing、転送量を測る。HTTP側は`npm run load:smoke`（PR）と`npm run load:full`（Nightly／提出前）で同じ20 actor・100 req/sシナリオを測る。

Node/VinextのCPUプロファイルは、remote D1へ書き込まないlocal buildで取得する。

```powershell
New-Item -ItemType Directory -Force output/cpu-prof | Out-Null
node --cpu-prof --cpu-prof-dir=output/cpu-prof node_modules/vinext/dist/cli.js build
```

WorkerとD1境界を確認する場合は、`npm run db:migrate:local`後に`npm run dev:edge`を使う。`py-spy`／Python profilerはこのNode/Vinext実行経路には使用しない。結果は`output/load/latest.json`と`output/cpu-prof/*.cpuprofile`を提出前またはNightly artifactとして保存する。
