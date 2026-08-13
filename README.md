# Furima Sandbox

Furima Sandbox は、Human・NPC・AI Agent が同じ C2C 市場へ参加し、Operator がその因果関係を追跡できる Marketplace Simulation & Agent Evaluation Sandbox です。

見た目だけのフリマ UI ではありません。出品、Like、値下げ依頼、購入、エスクロー、発送、配送、相互評価、売上確定を一つの Application Core で扱い、全状態変更を World Event と Wallet Ledger に残します。NPC の行動計画には [Mesa](https://github.com/mesa/mesa) 3.5.1 を使用します。

## 現在できること

- 4 人の Human ペルソナと多数の NPC が一つの Default World を共有
- seed 付き World を Play / Pause / Step、1x / 10x で進行
- Human / NPC / AI Agent / System を同じ marketplace command に接続
- append-only Event Timeline を actor、target、correlation ごとに観測
- Buyer → Escrow → Seller / Platform を Wallet Ledger で追跡
- Buyer Agent が「1万円以内でカメラ」などのゴールを検索・比較・値下げ依頼し、Human の確認後に購入
- Operator Console で市場 KPI、イベント、Wallet、Agent Run を確認
- D1 の World Snapshot へ市場状態とシミュレーション状態を保存
- Mesa sidecar が利用できない環境では、同じ command contract の決定論的ブラウザ実行へ自動フォールバック

Mesa はデータベースを直接変更しません。Mesa が返す ordered command intents を TypeScript の Application Core が検証・適用するため、Human / NPC / AI Agent のルールが分岐しません。

```text
Marketplace snapshot -> Mesa MarketplaceModel -> ordered command intents
                                              -> metrics / synthetic events
command intents -> MarketplaceSandbox -> MarketplaceDomain -> state + event + ledger
```

## ローカル起動

Node.js 22.13 以上と Python 3.12 以上、[uv](https://docs.astral.sh/uv/) が必要です。

ターミナル 1 — Mesa sidecar:

```powershell
cd simulation
uv sync --locked
uv run uvicorn furima_sim.api:app --host 127.0.0.1 --port 8010
```

ターミナル 2 — Web app:

```powershell
npm install
npm run dev
```

`http://localhost:3000` を開き、上部の「AIに依頼」または「運営コンソール」を選びます。Web app は開発時に `http://127.0.0.1:8010` を既定の Mesa API として使用します。別 URL へ接続する場合は `.env.local` に次を設定します。

```dotenv
NEXT_PUBLIC_MESA_API_URL=https://your-mesa-service.example.com
```

## 強いデモ導線

1. World を Play し、NPC の閲覧・Like・値下げ依頼・購入 activity を確認する。
2. 「AIに依頼」から「1万円以内で状態の良いカメラを探して。少しなら値下げ交渉して」を実行する。
3. 候補 3 件、選定理由、offer を確認し、購入を承認する。
4. Wallet で Buyer → Escrow を確認する。
5. Step または 10x で発送、配送、評価まで進める。
6. Operator へ切り替え、同じ取引を Event Timeline と Ledger で因果順に追う。
7. Reset して seed `12345` の初期状態を再現する。

## 検証

```powershell
npm run lint
npm run build
npm test

cd simulation
uv run pytest
```

Python テストには、seed の再現性、API contract、Human が NPC として自動行動しないこと、intent の安定 ID / 順序が含まれます。TypeScript テストには、二重購入拒否、Wallet / Escrow / Fee の整合、Event causality、同一 command path、状態復元が含まれます。

## Mesa API

- `GET /health` — Mesa version と engine status
- `POST /worlds/bootstrap` — snapshot と seed から World を初期化
- `POST /worlds/{world_id}/step` — NPC を進め、ordered command intents と metrics を返す
- `POST /worlds/{world_id}/agent-goal` — 決定論的 Buyer Agent plan を返す

詳しい payload と設計境界は [simulation/README.md](simulation/README.md) を参照してください。

## Browser Agent API

`window.__FURIMA_SANDBOX_API__` から Human と同じ UI / Domain 操作へアクセスできます。後方互換のため `window.__SHOP_API__` と `window.__MERCARI_API__` も同じオブジェクトです。

主な API:

- `getWorldState()`, `getSnapshot()`, `getActivity()`, `getActionTrace()`
- `switchPersona()`, `search()`, `openItem()`, `setLiked()`, `setSaved()`
- `createListingDraft()`, `submitListing()`, `listItem()`
- `startPurchase()`, `confirmPurchase()`, `completePayment()`
- `markAsShipped()`, `advanceShipment()`, `rateTransaction()`
- `resetScenario()`

操作結果は `ActionResult` で返り、`requestId` と `idempotencyKey` による重複実行防止に対応します。
