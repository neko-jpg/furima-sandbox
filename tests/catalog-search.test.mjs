import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG_ITEMS } from "../app/data/catalogData.ts";
import { filterCatalogItems, searchCatalogItems } from "../app/components/searchUtils.ts";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));

test("the curated catalog contains 50 fully classified items", () => {
  assert.equal(CATALOG_ITEMS.length, 50);
  for (const item of CATALOG_ITEMS) {
    assert.ok(item.category.length >= 3, `${item.id} needs a three-level category path`);
    assert.ok(item.productFamilyId, `${item.id} needs a product family`);
    assert.ok(item.variantId, `${item.id} needs a product variant`);
    assert.ok(item.searchTags?.length, `${item.id} needs search tags`);
    assert.ok(Object.keys(item.attributes ?? {}).length >= 2, `${item.id} needs structured attributes`);
    assert.equal(item.images.length, 1, `${item.id} should use one curated product image`);
    assert.match(item.images[0], /^\/images\/products\/pexels-selected\//u, `${item.id} must use a selected local image`);
    assert.ok(existsSync(join(publicRoot, item.images[0].slice(1))), `${item.id} image is missing`);
    assert.doesNotMatch(item.images[0], /^https?:\/\//iu, `${item.id} must not load a product image from the web`);
    assert.doesNotMatch(item.seller.avatar, /^https?:\/\//iu, `${item.id} must not load a seller avatar from the web`);
  }
});

test("PC, condition, and CPU vendor queries use AND semantics", () => {
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "PC 新品 intel").map((item) => item.id),
    ["demo-000010", "demo-000011"],
  );
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "パソコン 新品 インテル").map((item) => item.id),
    ["demo-000010", "demo-000011"],
  );
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "ノートPC Core i5").map((item) => item.id),
    ["demo-000011"],
  );
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "ノートPC -AMD").map((item) => item.id),
    ["demo-000010", "demo-000011"],
  );
});

test("Japanese category synonyms and domain tags find the intended items", () => {
  assert.equal(searchCatalogItems(CATALOG_ITEMS, "レディース バッグ").length, 2);
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "ゲーム PS5").map((item) => item.id),
    ["demo-000027"],
  );
  assert.deepEqual(
    searchCatalogItems(CATALOG_ITEMS, "インテル").map((item) => item.id),
    ["demo-000010", "demo-000011"],
  );
});

test("structured brand and category filters use the curated metadata", () => {
  assert.deepEqual(
    filterCatalogItems(CATALOG_ITEMS, { brand: "SONY" }).map((item) => item.id),
    ["demo-000005"],
  );
  assert.equal(
    filterCatalogItems(CATALOG_ITEMS, { category: "家電・スマホ", subcategory: "PC・タブレット" }).length,
    3,
  );
  assert.equal(filterCatalogItems(CATALOG_ITEMS, { category: "スマホ・タブレット・パソコン" }).length, 6);
  assert.equal(filterCatalogItems(CATALOG_ITEMS, { category: "テレビ・オーディオ・カメラ" }).length, 6);
  assert.equal(filterCatalogItems(CATALOG_ITEMS, { category: "家具・インテリア" }).length, 6);
});
