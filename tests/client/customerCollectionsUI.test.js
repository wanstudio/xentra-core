'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const storeSrc = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/store.js'), 'utf8');
const homeSrc = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/home.js'), 'utf8');
const homeCss = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/css/home.css'), 'utf8');
const routerSrc = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/core/router.js'), 'utf8');
const auxSrc = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/assets/js/pages/aux-pages.js'), 'utf8');
const indexSrc = fs.readFileSync(path.resolve(__dirname, '../../apps/customer-pwa/index.html'), 'utf8');

test('COL-01: Store implements collection persistence and reactivity methods', () => {
  assert.ok(storeSrc.includes('COLLECTIONS_KEY = PREFIX + \'collections\''), 'collections storage key defined');
  assert.ok(storeSrc.includes('function getCollections()'), 'getCollections defined');
  assert.ok(storeSrc.includes('function isSavedInCollections('), 'isSavedInCollections defined');
  assert.ok(storeSrc.includes('function toggleCollection('), 'toggleCollection defined');
  assert.ok(storeSrc.includes('function removeFromCollections('), 'removeFromCollections defined');
  assert.ok(storeSrc.includes('getCollections: getCollections'), 'getCollections exported');
  assert.ok(storeSrc.includes('isSavedInCollections: isSavedInCollections'), 'isSavedInCollections exported');
  assert.ok(storeSrc.includes('toggleCollection: toggleCollection'), 'toggleCollection exported');
  assert.ok(storeSrc.includes('removeFromCollections: removeFromCollections'), 'removeFromCollections exported');
});

test('COL-02: Home detail sheet matches Frame 241 design contracts', () => {
  // Rounded food image wrap
  assert.ok(homeSrc.includes('x-detail-image-wrap'), 'image wrap class exists');
  // Title and subtitle
  assert.ok(homeSrc.includes('x-detail-name'), 'title element exists');
  assert.ok(homeSrc.includes('x-detail-subtitle'), 'subtitle element exists');
  // Price row and Promo badge
  assert.ok(homeSrc.includes('x-detail-price-row'), 'price row exists');
  assert.ok(homeSrc.includes('x-detail-promo-badge'), 'promo badge exists');
  // Dual action pills: Simpan and Share
  assert.ok(homeSrc.includes('x-detail-btn-save'), 'save pill button exists');
  assert.ok(homeSrc.includes('x-detail-btn-share'), 'share pill button exists');
  assert.ok(homeSrc.includes('Simpan'), 'Simpan text exists');
  assert.ok(homeSrc.includes('Share'), 'Share text exists');
  // Primary CTA Add to cart
  assert.ok(homeSrc.includes('Add to cart'), 'Add to cart CTA button text exists');
  const detailAddMatch = homeCss.match(/\.x-detail-add\s*\{([^}]+)\}/);
  assert.ok(detailAddMatch, '.x-detail-add CSS rule exists');
  const detailAddBody = detailAddMatch[1];
  assert.ok(detailAddBody.includes('background: var(--x-primary);'), '.x-detail-add uses theme token --x-primary');
  assert.ok(detailAddBody.includes('color: var(--x-primary-text, #111111);'), '.x-detail-add uses theme token --x-primary-text');
  assert.ok(detailAddBody.includes('border-radius: var(--x-radius-pill, 999px);'), '.x-detail-add uses pill border radius');
  assert.ok(!detailAddBody.includes('box-shadow'), 'no glow shadow on .x-detail-add');
  assert.ok(!homeCss.includes('background: #1ca24b;'), 'no hardcoded #1ca24b in home.css');
  // Global export
  assert.ok(homeSrc.includes('window.openProductDetail = openProductDetail'), 'openProductDetail exposed globally');
});

test('COL-03: Router recognizes and navigates to collections view', () => {
  assert.ok(routerSrc.includes("if (hash.startsWith('#collections') || window.location.pathname.startsWith('/collections')) {"), 'route pattern detected');
  assert.ok(routerSrc.includes("return 'collections';"), 'returns collections view');
  assert.ok(routerSrc.includes("window.location.hash = '#collections';"), 'navigates to #collections hash');
});

test('COL-04: index.html wires collections view container and lazy controller', () => {
  assert.ok(indexSrc.includes('id="xentra-collections-view"'), 'collections container element exists in DOM');
  assert.ok(indexSrc.includes("collections: '/assets/js/pages/aux-pages.js'"), 'CONTROLLER_SRC includes collections');
  assert.ok(indexSrc.includes('window.XentraAuxPages.mountCollections(collectionsEl)'), 'updateViews mounts collections page');
});

test('COL-05: aux-pages.js implements My Collections page with Profile entry point', () => {
  // Entry point in Profil Saya
  assert.ok(auxSrc.includes('id="x-profile-btn-collections"'), 'My collections button in Profile');
  assert.ok(auxSrc.includes('My Collections'), 'Title My Collections present');
  // mountCollections controller function
  assert.ok(auxSrc.includes('function mountCollections(container)'), 'mountCollections function defined');
  assert.ok(auxSrc.includes('mountCollections: mountCollections'), 'mountCollections exported on XentraAuxPages');
  // Empty state handling
  assert.ok(auxSrc.includes('Belum Ada Menu Disimpan'), 'Empty state header');
  assert.ok(auxSrc.includes('id="x-collections-explore-btn"'), 'Explore CTA on empty state');
});
