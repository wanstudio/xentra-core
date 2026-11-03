'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DETAIL_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoryDetailPage.jsx');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');
const OWNER_INDEX_PATH = path.join(ROOT, 'apps/owner-app/index.html');

test('CategoryDetailPage Searchbar Contract Suite', async (t) => {
  const detailJsx = fs.readFileSync(DETAIL_PAGE_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');
  const ownerIndexHtml = fs.readFileSync(OWNER_INDEX_PATH, 'utf8');

  await t.test('1. CategoryDetailPage includes search input, search state, and clear CTA', () => {
    assert.match(detailJsx, /const\s*\[searchQuery,\s*setSearchQuery\]\s*=\s*useState\(''\)/, 'Must have searchQuery state');
    assert.match(detailJsx, /id="cat-detail-search-input"/, 'Must have dedicated input element id');
    assert.match(detailJsx, /placeholder="Cari nama menu\.\.\."/, 'Must provide clear Indonesian placeholder');
    assert.match(detailJsx, /aria-label="Cari nama menu"/, 'Must provide accessible label');
    assert.match(detailJsx, /aria-label="Bersihkan pencarian"/, 'Must have clear button when searchQuery is active');
  });

  await t.test('2. filteredMenus filters by active/inactive status AND searchQuery (title, subtitle, sku)', () => {
    assert.match(detailJsx, /const q = searchQuery\.toLowerCase\(\)\.trim\(\)/, 'Must normalize search query');
    assert.match(detailJsx, /title\.includes\(q\)\s*\|\|\s*subtitle\.includes\(q\)\s*\|\|\s*sku\.includes\(q\)/, 'Must search across title, subtitle, and SKU');
    assert.match(detailJsx, /Tidak ada menu yang cocok dengan "\$\{searchQuery\}"/, 'Empty state must reflect active search query');
  });

  await t.test('3. Compiled bundle contains CategoryDetailPage searchbar implementation', () => {
    assert.match(bundleJs, /cat-detail-search-input/, 'Compiled bundle must include search input ID');
    assert.match(bundleJs, /Cari nama menu\.\.\./, 'Compiled bundle must include placeholder');
  });

  await t.test('4. apps/owner-app/index.html loads menu-editor bundle with bumped cache query', () => {
    assert.match(ownerIndexHtml, /\/owner\/assets\/bundles\/menu-editor\.js\?v=1\.1\.\d+/, 'Owner app must reference versioned bundle');
  });
});
