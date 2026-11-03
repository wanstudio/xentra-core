'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ITEM_MASTER_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/ItemMasterPage.jsx');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

test('Item Master Redesign Suite (1:1 Figma Spec)', async (t) => {
  const code = fs.readFileSync(ITEM_MASTER_PAGE_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

  await t.test('1. Header has back arrow, Item Master title, and spacing matching CategoriesPage', () => {
    assert.ok(code.includes('Item Master'), 'Must display title "Item Master"');
    assert.ok(code.includes('ci_arrow-left-sm.svg'), 'Must use ci_arrow-left-sm.svg icon');
    assert.ok(code.includes("color: '#0F172A'"), 'Title color must be #0F172A');
    assert.ok(code.includes('mb-6'), 'Header must have mb-6 matching CategoriesPage');
    assert.ok(code.includes('w-9 h-9 flex items-center justify-center -ml-2 rounded-full'), 'Back button styling must match CategoriesPage');
  });

  await t.test('2. Main Card and Search Bar conform to Figma spec', () => {
    assert.ok(code.includes('Cari nama atau kode item'), 'Placeholder must be "Cari nama atau kode item"');
    assert.ok(code.includes("height: '48px'"), 'Search bar height must be 48px');
    assert.ok(code.includes("borderRadius: '14px'"), 'Search bar radius must be 14px');
    assert.ok(code.includes('#CBD5E1'), 'Outline color must match #CBD5E1');
    assert.ok(code.includes('#D9D9D9'), 'Main card outline must match #D9D9D9');
  });

  await t.test('3. Filter pills use 75x30 pills with Aktif and Nonaktif', () => {
    assert.ok(code.includes('Aktif'), 'Must have Aktif tab');
    assert.ok(code.includes('Nonaktif'), 'Must have Nonaktif tab');
    assert.ok(code.includes("width: '75px'"), 'Pill width must be 75px');
    assert.ok(code.includes("height: '30px'"), 'Pill height must be 30px');
    assert.ok(code.includes("borderRadius: '20px'"), 'Pill radius must be 20px');
    assert.ok(code.includes('#0F172A'), 'Active pill color must be #0F172A');
  });

  await t.test('4. Item card structure matches Figma tokens (45x45 avatar, 10px SKU, 10px price)', () => {
    assert.ok(code.includes("width: '45px'"), 'Avatar width 45px');
    assert.ok(code.includes("height: '45px'"), 'Avatar height 45px');
    assert.ok(code.includes("borderRadius: '12px'"), 'Card radius 12px');
    assert.ok(code.includes('#979797'), 'SKU font color #979797');
    assert.ok(code.includes("fontSize: '10px'"), 'SKU & price font size 10px');
    assert.ok(code.includes("fontSize: '16px'"), 'Item title font size 16px');
    assert.ok(code.includes('formatMoney'), 'Uses formatted rupiah price');
  });

  await t.test('5. Toggle switch uses 35x21 pill with #00A637, 21x21 thumb and 90deg tick', () => {
    assert.ok(code.includes("width: '35px'"), 'Toggle width 35px');
    assert.ok(code.includes("height: '21px'"), 'Toggle height 21px');
    assert.ok(code.includes('#00A637'), 'Toggle active color #00A637');
    assert.ok(code.includes("width: '21px'"), 'Toggle thumb width 21px');
    assert.ok(code.includes('rotate(90deg)'), 'Tick mark rotated 90deg');
  });

  await t.test('6. Fixed Bottom Action Bar with Tambah button portaled to body', () => {
    assert.ok(code.includes('createPortal('), 'Must use createPortal');
    assert.ok(code.includes('modern-item-master-bottom-bar'), 'Must have modern-item-master-bottom-bar ID');
    assert.ok(code.includes('Tambah'), 'Button label must be Tambah');
    assert.ok(code.includes("borderRadius: '9999px'"), 'Pill button radius 9999px');
    assert.ok(code.includes('#00A637'), 'Button background #00A637');
  });

  await t.test('7. Production bundle contains compiled ItemMasterPage redesign', () => {
    assert.ok(bundleJs.includes('Cari nama atau kode item'), 'Bundle must contain new placeholder');
    assert.ok(bundleJs.includes('modern-item-master-bottom-bar'), 'Bundle must contain bottom bar ID');
    assert.ok(bundleJs.includes('modern-item-master-page-root'), 'Bundle must contain page root ID');
  });
});
