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
  assert.match(html, /本サイトは「Mercari AI Agent Hackathon」提出用に作成したデモ・モックサイトです/);
  assert.doesNotMatch(html, /Starter Project|Building your site|SkeletonPreview/);
});

test("domain state and agent API invariants are covered by source-level contracts", async () => {
  const [context, types, detail, buyModal, listing, globals, app, header, home, category, shop, search] = await Promise.all([
    readFile(new URL("app/context/MercariContext.tsx", root), "utf8"),
    readFile(new URL("app/types/mercari.ts", root), "utf8"),
    readFile(new URL("app/components/views/ItemDetailView.tsx", root), "utf8"),
    readFile(new URL("app/components/modals/BuyModal.tsx", root), "utf8"),
    readFile(new URL("app/components/views/ListingView.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/components/MercariApp.tsx", root), "utf8"),
    readFile(new URL("app/components/Header.tsx", root), "utf8"),
    readFile(new URL("app/components/views/HomeView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/CategoryView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/ShopView.tsx", root), "utf8"),
    readFile(new URL("app/components/views/SearchView.tsx", root), "utf8"),
  ]);
  assert.match(context, /useState<string \| null>\(null\)/);
  assert.match(context, /const selectedItem = items\.find\(\(item\) => item\.id === selectedItemId\)/);
  assert.match(context, /const buyingItem = items\.find\(\(item\) => item\.id === buyingItemId\)/);
  assert.doesNotMatch(context, /buyingItem\.isSold\s*=/);
  assert.match(context, /const purchaseItem = \(itemId: string\)/);
  assert.match(context, /failure\('ALREADY_SOLD'/);
  assert.match(context, /window\.__MERCARI_API__ = api/);
  assert.match(context, /window\.__SHOP_API__ = api/);
  assert.match(context, /getSnapshot/);
  assert.match(context, /idempotencyKey/);
  assert.match(context, /getActionTrace/);
  assert.match(context, /resetScenario/);
  assert.match(types, /export type ActionResult/);
  assert.match(types, /createListingDraft/);
  assert.match(types, /submitListing/);
  assert.doesNotMatch(buyModal, /buyingItem\.isSold\s*=/);
  assert.match(buyModal, /purchaseItem\(buyingItem\.id\)/);
  assert.match(detail, /const isUnavailable = Boolean\(item\.isSold\)/);
  assert.doesNotMatch(detail, /className="fixed inset-0/);
  const formEnd = listing.lastIndexOf("</form>");
  const footerAfterForm = listing.indexOf("<Footer />", formEnd);
  assert.ok(formEnd >= 0 && footerAfterForm > formEnd, "Listing footer must not be inside the submit form");
  assert.match(listing, /id="listing-images" type="file"/);
  assert.match(listing, /setCategory\(''\)/);
  assert.match(globals, /var\(--font-noto-sans-jp\)/);
  assert.match(globals, /prefers-reduced-motion/);
  assert.doesNotMatch(globals, /user-select:\s*none/);
  assert.match(app, /case 'category'/);
  assert.match(app, /categoryName === 'ショップ' \? <ShopView \/> : <CategoryView \/>/);
  assert.match(header, /onCategory=\{navigateCategory\}/);
  assert.doesNotMatch(home, /openCategory\(category\.target\)/);
  assert.match(search, /setSearchQuery\(normalizedQuery\)/);
  assert.match(search, /tokenizeSearchQuery/);
  assert.match(search, /queryTokens\.every/);
  assert.match(search, /検索キーワードを入力/);
  assert.match(search, /を削除/);
  assert.match(header, /検索履歴/);
  assert.match(header, /画像からさがす/);
  assert.match(header, /検索条件を保存/);
  assert.match(context, /const isAuthenticated = true/);
  assert.match(category, /data-testid="category-view"/);
  assert.match(shop, /data-testid="shop-view"/);
  assert.match(shop, /openCategory\(`ショップカテゴリ:\$\{group\.name\}`\)/);
  assert.match(home, /openCategory\('PC'\)/);
});
