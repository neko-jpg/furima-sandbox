import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('listing flow exposes both photo inputs and the 20-image contract', async () => {
  const source = await read('app/components/views/ListingView.tsx');
  assert.match(source, /id="listing-camera" type="file" accept="image\/\*" capture="environment"/);
  assert.match(source, /id="listing-images" type="file" accept="image\/\*" multiple/);
  assert.match(source, /MAX_LISTING_IMAGES = 20/);
  assert.match(source, /aria-posinset/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /onDragStart/);
  assert.doesNotMatch(source, /<Footer\s*\/>/);
  assert.match(source, /hasDraftContent/);
  assert.match(source, /権限が反映されるまで/);
  assert.match(source, /imageRefs/);
  assert.match(source, /imageOrder/);
  assert.match(source, /getUserMedia/);
  assert.match(source, /MediaStreamTrack/);
  assert.match(source, /captureCameraFrame/);
  assert.match(source, /fixed.*inset-0/);
});

test('mobile home tabs and sandbox account contracts are shared and documented', async () => {
  const tabs = await read('app/components/homeTabs.ts');
  const types = await read('app/types/mercari.ts');
  const context = await read('app/context/MercariContext.tsx');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(tabs, /recommend.*おすすめ/s);
  assert.match(tabs, /mylist.*マイリスト/s);
  assert.match(tabs, /auction.*オークション/s);
  assert.match(types, /DEPOSIT.*WITHDRAWAL.*HOLD/s);
  assert.match(context, /depositWallet/);
  assert.match(context, /updateProfile/);
  assert.match(myPage, /利用可能/);
  assert.match(myPage, /プロフィール編集/);
});

test('desktop account menu routes to the five user destinations', async () => {
  const header = await read('app/components/Header.tsx');
  const context = await read('app/context/MercariContext.tsx');
  const types = await read('app/types/mercari.ts');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(header, /data-testid="account-menu-trigger"/);
  assert.match(header, /role="menu"/);
  assert.match(header, /マイページ/);
  assert.match(header, /プロフィール/);
  assert.match(header, /フォローリスト/);
  assert.match(header, /購入した商品/);
  assert.match(header, /ログアウト/);
  assert.match(header, /switchActor\('guest'\)/);
  assert.match(context, /openMyPagePanel/);
  assert.match(context, /myPagePanel/);
  assert.match(types, /export type MyPagePanel/);
  assert.match(myPage, /setMyPagePanel/);
});

test('listing domain enforces official price and condition bounds', async () => {
  const source = await read('app/domain/sandboxEngine.ts');
  assert.match(source, /MAX_LISTING_PRICE = 9_999_999/);
  assert.match(source, /全体的に状態が悪い/);
  assert.match(source, /imageReferenceError/);
});

test('API source of truth and docs checks are wired', async () => {
  const workflow = await read('.github/workflows/verify.yml');
  const packageJson = JSON.parse(await read('package.json'));
  const catalogItemRoute = await read('app/api/catalog/[itemId]/route.ts');
  assert.match(workflow, /npm run docs:check/);
  assert.equal(packageJson.scripts['docs:check'], 'node scripts/validate-api-docs.mjs');
  assert.match(catalogItemRoute, /ITEM_NOT_FOUND/);
  assert.match(catalogItemRoute, /If-None-Match|if-none-match/);
});

test('mobile navigation stays in the viewport and does not sit under the inspector', async () => {
  const bottomNav = await read('app/components/BottomNav.tsx');
  const inspector = await read('app/components/SandboxInspector.tsx');
  const context = await read('app/context/MercariContext.tsx');
  const app = await read('app/components/MercariApp.tsx');
  const detail = await read('app/components/views/ItemDetailView.tsx');
  const myPage = await read('app/components/views/MyPageView.tsx');
  assert.match(bottomNav, /fixed inset-x-0 bottom-0 md:hidden/);
  assert.match(bottomNav, /absolute inset-x-0 bottom-0/);
  assert.match(inspector, /bottom-\[calc\(58px\+env\(safe-area-inset-bottom\)\+0\.75rem\)\]/);
  assert.match(context, /history\.pushState/);
  assert.match(context, /ITEM_ROUTE_PREFIX/);
  assert.match(context, /window\.history\.back\(\)/);
  assert.match(app, /onClose=\{closeItem\}/);
  assert.match(app, /!isListingFlowOpen && mainTab !== 'sell' && <SandboxInspector \/>/);
  assert.match(detail, /\$\{isDeviceFrame \? 'absolute' : 'fixed'\}/);
  assert.match(detail, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(myPage, /出品した商品/);
  assert.match(myPage, /売却済み/);
  assert.match(myPage, /下書き一覧/);
  assert.match(myPage, /furima-listing-open-draft-id/);
});
