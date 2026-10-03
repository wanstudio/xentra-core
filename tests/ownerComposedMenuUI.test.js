'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'apps/merchant-dashboard/assets/js/dashboard.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'apps/merchant-shared/css/dashboard.css'), 'utf8');

test('Owner exposes a dedicated canonical Master Menu workspace', () => {
  assert.ok(HTML.includes('data-route="catalog/master-menus"'));
  assert.ok(HTML.includes('<span>Menu Master</span>'));
  assert.ok(HTML.includes('id="tab-catalog-master-menus"'));
  assert.ok(HTML.includes('id="master-menu-list-view"'));
  assert.ok(HTML.includes('id="master-menu-editor-view"'));
  assert.ok(HTML.includes('id="btn-add-master-menu-single"'));
  assert.ok(HTML.includes('id="btn-add-master-menu-package"'));
});

test('Master Menu editor models Menu as the commercial entity', () => {
  assert.ok(HTML.includes('id="cm-product"'));
  assert.ok(HTML.includes('id="cm-category"'));
  assert.ok(HTML.includes('id="cm-sub-category"'));
  assert.ok(HTML.includes('id="cm-rasa"'));
  assert.ok(HTML.includes('id="cm-level"'));
  assert.ok(HTML.includes('id="cm-price"'));
  assert.ok(HTML.includes('Harga komersial berada di Menu, bukan di Product Master.'));
  assert.ok(!HTML.includes('id="cm-name"'));
  assert.ok(!HTML.includes('id="cm-regular-price"'));
});

test('Package editor exposes package composition controls and invariants', () => {
  assert.ok(HTML.includes('id="cm-package-name"'));
  assert.ok(HTML.includes('id="cm-package-components"'));
  assert.ok(HTML.includes('id="btn-cm-add-component"'));
  assert.ok(JS.includes('Satu Product tidak boleh muncul dua kali dalam paket.'));
  assert.ok(JS.includes('Menu Paket membutuhkan minimal 2 unit Product.'));
  assert.ok(JS.includes('Number.isSafeInteger(quantity)'));
});

test('Master Menu routing is deep-linkable and keeps the submenu active', () => {
  assert.ok(JS.includes("'catalog/master-menus': { title: 'Menu Master'"));
  assert.ok(JS.includes("'catalog-master-menus': 'catalog/master-menus'"));
  assert.ok(JS.includes("if (hash.indexOf('catalog/master-menus/') === 0)"));
  assert.ok(JS.includes("route === 'catalog/master-menus/new'"));
  assert.ok(JS.includes("/^catalog\\/master-menus\\/[^/]+\\/edit$/"));
  assert.ok(JS.includes("(isMasterMenuEditor && targetRoute === 'catalog/master-menus')"));
  assert.ok(JS.includes("return 'catalog/master-menus'"));
});

test('Master Menu controller uses canonical administration endpoints', () => {
  assert.ok(JS.includes("API_BASE + '/admin/menus'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/single'"));
  assert.ok(JS.includes("API_BASE + '/admin/menus/package'"));
  assert.ok(JS.includes("API_BASE + '/admin/sub-categories'"));
  assert.ok(JS.includes("API_BASE + '/admin/rasas'"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/level/ensure-defaults'"));
  assert.ok(JS.includes("API_BASE + '/admin/menu/components/level'"));
  assert.ok(JS.includes("API_BASE + '/admin/products'"));
  assert.ok(JS.includes("'/status'"));
  assert.ok(!JS.includes('/catalog/menu'));
});

test('Owner preview follows canonical customer identity rules', () => {
  assert.ok(JS.includes("title = sub ? sub.name : 'Pilih Sub Category'"));
  assert.ok(JS.includes("title = String(($('cm-package-name') && $('cm-package-name').value) || '').trim() || 'Nama Menu Paket'"));
  assert.ok(JS.includes('ownerMasterMenuRasaLabel'));
  assert.ok(JS.includes('priceEl.textContent = formatMoney'));
});

test('Master Menu workspace has dedicated mobile-first presentation styles', () => {
  assert.ok(CSS.includes('.x-master-menu-grid'));
  assert.ok(CSS.includes('.x-master-menu-card'));
  assert.ok(CSS.includes('.x-composed-menu-component-row'));
  assert.ok(CSS.includes('@media (max-width: 560px)'));
});
