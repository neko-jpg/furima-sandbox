import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Furima Sandbox app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /shop-app-container/);
  assert.match(html, /Furima Sandbox - /);
  assert.match(html, /Furima Sandboxの動くフリマUIモック/);
  assert.match(html, /本サイトは「Mercari AI Agent Hackathon for PM」提出用に作成したデモ・モックサイトです/);
  assert.doesNotMatch(html, /Starter Project|Building your site|SkeletonPreview/);
});

test("UI contracts keep domain state, policy, search, and accessibility behavior wired", async () => {
  const [context, engine, executor, types, detail, buyModal, listing, globals, layout, app, header, home, category, shop, search, schema, sandboxRoute, shopImage, viteConfig, demoNotice, assetAudit] = await Promise.all([
    readFile(new URL("app/context/MercariContext.tsx", root), "utf8"),
    readFile(new URL("app/domain/sandboxEngine.ts", root), "utf8"),
    readFile(new URL("app/domain/commandExecutor.ts", root), "utf8"),
    readFile(new URL("app/types/mercari.ts", root), "utf8"),
    readFile(new URL("app/components/views/ItemDetailView.tsx", root), "utf8"),
    readFile(new URL("app/components/modals/BuyModal.tsx", root), "utf8"),
    readFile(new URL("app/components/views/ListingView.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/components/MercariApp.tsx", root), "utf8"),
    readFile(new URL("app/components/Header.tsx", root), "utf8"),
    readFile(new URL("app/components/views/HomeView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/CategoryView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/ShopView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/SearchView.tsx", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("app/api/sandbox/state/route.ts", root), "utf8"),
    readFile(new URL("app/components/ui/ShopImage.tsx", root), "utf8"),
    readFile(new URL("vite.config.ts", root), "utf8"),
    readFile(new URL("app/components/DemoNotice.tsx", root), "utf8"),
    readFile(new URL("scripts/audit-runtime-assets.mjs", root), "utf8"),
  ]);
  assert.match(context, /new SandboxEngine\(items/);
  assert.match(context, /const INITIAL_CATALOG_ITEMS = \[\.\.\.CATALOG_ITEMS\]/);
  assert.doesNotMatch(context, /const INITIAL_CATALOG_ITEMS = \[\.\.\.INITIAL_ITEMS\]/);
  assert.match(context, /sandboxEngine\.startPurchase/);
  assert.match(context, /runAgentMutation\('confirmPurchase',[\s\S]*working\.confirmPurchase/);
  assert.doesNotMatch(context, /runAgentMutation\('confirmPurchase',[^\n]*sandboxEngine\.confirmPurchase/);
  assert.match(context, /window\.__MERCARI_API__ = api/);
  assert.match(context, /window\.__SHOP_API__ = api/);
  assert.match(context, /addComment: \(itemId, text, options\)/);
  assert.match(executor, /IDEMPOTENCY_CONFLICT/);
  assert.match(executor, /const working = cloneEngine\(this\.engine\)/);
  assert.match(executor, /await this\.store\.commitCommand[\s\S]*this\.engine\.importState\(working\.exportState\(\)/);
  assert.match(context, /REMOTE_STATE_ENABLED/);
  assert.doesNotMatch(context, /window\.localStorage\.setItem\(SANDBOX_STATE_STORAGE_KEY, serialized\)/);
  assert.match(context, /new IndexedDbSandboxStateStore/);
  assert.match(context, /browserSandboxStore\.put/);
  assert.match(context, /if \(!REMOTE_STATE_ENABLED\) return;/);
  assert.match(context, /sandboxEngine\.importState\(serialized, BROWSER_STATE_RESTORE_OPTIONS\)/);
  assert.match(context, /catalogLoadRef\.current/);
  assert.doesNotMatch(context, /serializedDigest/);
  assert.doesNotMatch(context, /importState:\s*\(/);
  assert.match(context, /compactImagePayloadForFingerprint/);
  assert.doesNotMatch(context, /Sandbox stateのバックアップ/);
  assert.doesNotMatch(context, /exportState:\s*\(/);
  assert.match(context, /furima-sandbox-state-v2/);
  assert.match(context, /viewsCount: \(item\.viewsCount \?\? 0\) \+ 1/);
  assert.match(engine, /CONFIRMATION_REQUIRED/);
  assert.match(engine, /POLICY_BLOCKED/);
  assert.match(engine, /assertInvariants/);
  assert.match(engine, /loadScenario/);
  assert.match(engine, /advanceClock/);
  assert.match(engine, /releaseWalletHold/);
  assert.match(engine, /getVisibleInventoryMovements/);
  assert.match(engine, /LISTING_DRAFT_CREATED/);
  assert.match(types, /export type ActionResult/);
  assert.match(types, /TransactionRecord/);
  assert.match(types, /DomainEvent/);
  assert.match(types, /createListingDraft/);
  assert.match(types, /confirmPurchase/);
  assert.doesNotMatch(buyModal, /buyingItem\.isSold\s*=/);
  assert.match(buyModal, /result\.data\.orderId/);
  assert.match(detail, /const isUnavailable = Boolean\(item\.isSold\)/);
  assert.match(detail, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(detail, /className="fixed inset-0/);
  assert.doesNotMatch(listing, /<Footer\s*\/>/, "Listing flow must not render the site footer");
  assert.match(listing, /id="listing-images" type="file"/);
  assert.match(listing, /setCategory\(''\)/);
  assert.match(globals, /font-family:\s*var\(--shop-ui-font\)/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(shopImage, /unoptimized=\{process\.env\.NODE_ENV === 'development'\}/);
  assert.match(demoNotice, /furima-sandbox-notice\.webp/);
  assert.match(assetAudit, /legacyRasterFiles/);
  assert.match(viteConfig, /command === "build"/);
  assert.match(viteConfig, /FURIMA_LOCAL_FIXTURE_MODE \?\?= "true"/);
  assert.match(globals, /prefers-reduced-motion/);
  assert.doesNotMatch(globals, /user-select:\s*none/);
  assert.match(app, /case 'category'/);
  assert.doesNotMatch(app, /SandboxInspector/);
  assert.match(app, /const ListingView = React\.lazy/);
  assert.doesNotMatch(app, /import \{ ListingView \} from/);
  assert.doesNotMatch(context, /runUiControlCommand/);
  assert.match(app, /categoryName === 'ショップ' \? <ShopView \/> : <CategoryView \/>/);
  assert.match(header, /onCategory=\{navigateCategory\}/);
  assert.doesNotMatch(home, /openCategory\(category\.target\)/);
  assert.match(search, /setSearchQuery\(normalizedQuery\)/);
  assert.match(search, /tokenizeSearchQuery/);
  assert.match(search, /filterCatalogItems/);
  assert.match(category, /filterCatalogItems/);
  assert.match(schema, /sandboxUsers/);
  assert.match(schema, /domainEvents/);
  assert.match(sandboxRoute, /hasValidStateEnvelope/);
  assert.match(sandboxRoute, /else if \(existing\)/);
  assert.match(shop, /openCategory\(`ショップカテゴリ:\$\{group\.name\}`\)/);
  assert.match(home, /openCategory\('PC'\)/);
});
