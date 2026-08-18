import assert from "node:assert/strict";
import test from "node:test";

const records = new Map();
const fakeIndexedDb = {
  open() {
    const request = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    const database = {
      objectStoreNames: { contains: (name) => name === "media" },
      createObjectStore() { return {}; },
      transaction() {
        const transaction = { oncomplete: null, onerror: null, objectStore() {
          return {
            put(value) { records.set(value.id, value); return requestFor(value, transaction); },
            get(id) { return requestFor(records.get(id) ?? null, transaction); },
            delete(id) { records.delete(id); return requestFor(undefined, transaction); },
          };
        } };
        return transaction;
      },
      close() {},
    };
    request.result = database;
    queueMicrotask(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  },
};

function requestFor(value, transaction) {
  const request = { result: value, onsuccess: null, onerror: null };
  queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()); });
  return request;
}

test("listing media works through fake IndexedDB and memory fallback", async () => {
  globalThis.window = { indexedDB: fakeIndexedDb };
  const media = await import(`../app/media/listingMediaStore.ts?media-test=${Date.now()}`);
  const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: "image/jpeg" });
  await media.putListingMedia("media_test", blob);
  assert.equal(records.has("media_test"), true);
  const preview = await media.getListingMedia("media_test");
  assert.match(preview ?? "", /^blob:/);
  await media.deleteListingMedia("media_test");
  assert.equal(await media.getListingMedia("media_test"), null);

  delete globalThis.window;
  await media.putListingMedia("media_memory", blob);
  assert.match((await media.getListingMedia("media_memory")) ?? "", /^blob:/);
  await media.deleteListingMedia("media_memory");
});

test("listing media rejects a MIME/signature mismatch before persistence", async () => {
  globalThis.window = { indexedDB: fakeIndexedDb };
  const media = await import(`../app/media/listingMediaStore.ts?media-test-invalid=${Date.now()}`);
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "fake.jpg", { type: "image/jpeg" });
  await assert.rejects(() => media.prepareListingMedia(file, "album"), /image-mime-mismatch/);
  assert.equal(records.size, 0);
  delete globalThis.window;
});
