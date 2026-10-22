'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const db = require('../server/database/db');
const registerAdminCatalogRoutes = require('../server/routes/admin-catalog');
const registerAdminComposedMenuRoutes = require('../server/routes/admin-composed-menu');

const ROOT = path.resolve(__dirname, '..');
const SORT_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategorySortPage.jsx');
const MENU_SORT_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoryMenuSortPage.jsx');
const SHELL_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/shell/OwnerAppShell.tsx');
const CATEGORIES_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoriesPage.jsx');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.brand_id = req.headers['x-test-brand'] || 'brand_reorder_test';
    req.user = { id: 'u-owner-test', role: 'owner' };
    next();
  });
  const router = express.Router();
  registerAdminCatalogRoutes(router, {
    db,
    requireAuth: () => (req, _res, next) => next()
  });
  registerAdminComposedMenuRoutes(router, {
    requireAuth: () => (req, _res, next) => next()
  });
  app.use('/api/v1', router);
  return app;
}

test('Category Reorder Suite', async (t) => {
  const sortPageJsx = fs.readFileSync(SORT_PAGE_PATH, 'utf8');
  const shellTsx = fs.readFileSync(SHELL_PATH, 'utf8');
  const categoriesPageJsx = fs.readFileSync(CATEGORIES_PAGE_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

  await t.test('1. CategorySortPage component implementation matches design specs', () => {
    assert.ok(fs.existsSync(SORT_PAGE_PATH), 'CategorySortPage.jsx must exist');
    assert.ok(sortPageJsx.includes('Urutkan kategori'), 'Must display "Urutkan kategori" title');
    assert.ok(sortPageJsx.includes('Tekan dan geser untuk mengatur urutan kategori'), 'Must display guidance subheader');
    assert.ok(sortPageJsx.includes('ci_arrow-left-sm.svg'), 'Must use back arrow icon');
    assert.ok(sortPageJsx.includes('/api/v1/admin/categories/reorder'), 'Must send reordered array to reorder API');
    assert.ok(sortPageJsx.includes('modern-categories-sort-bottom-bar'), 'Must contain fixed bottom action bar');
    assert.ok(sortPageJsx.includes('Simpan'), 'Must have Simpan button');
  });

  await t.test('2. OwnerAppShell wires CategorySortPage route', () => {
    assert.ok(shellTsx.includes('import CategorySortPage'), 'Shell must import CategorySortPage');
    assert.ok(shellTsx.includes("catalog/categories/sort"), 'Shell must wire catalog/categories/sort route');
  });

  await t.test('3. CategoriesPage Urutkan button navigates to catalog/categories/sort', () => {
    assert.ok(categoriesPageJsx.includes("catalog/categories/sort"), 'CategoriesPage must navigate to catalog/categories/sort');
  });

  await t.test('4. Vite compiled bundle contains CategorySortPage', () => {
    assert.ok(bundleJs.includes('Tekan dan geser untuk mengatur urutan kategori'), 'Bundle must contain CategorySortPage hint text');
    assert.ok(bundleJs.includes('/api/v1/admin/categories/reorder'), 'Bundle must contain reorder API endpoint');
  });

  await t.test('5. PUT /api/v1/admin/categories/reorder updates sort_order in database', async () => {
    const app = buildTestApp();
    const server = app.listen(0);
    const port = server.address().port;

    const brandId = 'brand_reorder_test';
    // Clean & Seed test brand and categories
    try {
      db.prepare('DELETE FROM categories WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_xentra_holding', 'Test Brand', 'test-brand');

      db.prepare('INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)').run('cat_t1', brandId, 'Kategori 1', 'kategori-1', 1);
      db.prepare('INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)').run('cat_t2', brandId, 'Kategori 2', 'kategori-2', 2);
      db.prepare('INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)').run('cat_t3', brandId, 'Kategori 3', 'kategori-3', 3);

      // Reorder: 3, 1, 2
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/admin/categories/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-test-brand': brandId
        },
        body: JSON.stringify({ order: ['cat_t3', 'cat_t1', 'cat_t2'] })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      assert.equal(data.categories[0].id, 'cat_t3');
      assert.equal(data.categories[0].sort_order, 1);
      assert.equal(data.categories[1].id, 'cat_t1');
      assert.equal(data.categories[1].sort_order, 2);
      assert.equal(data.categories[2].id, 'cat_t2');
      assert.equal(data.categories[2].sort_order, 3);
    } finally {
      db.prepare('DELETE FROM categories WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      server.close();
    }
  });

  await t.test('6. CategoryMenuSortPage and PUT /api/v1/admin/menus/reorder work as expected', async () => {
    const menuSortJsx = fs.readFileSync(MENU_SORT_PAGE_PATH, 'utf8');
    assert.ok(menuSortJsx.includes('Urutkan menu'), 'Must display "Urutkan menu" title');
    assert.ok(menuSortJsx.includes('Kategori:'), 'Must display "Kategori:" subtitle');
    assert.ok(menuSortJsx.includes('Tekan dan geser untuk mengatur urutan menu'), 'Must display menu sort instruction');
    assert.ok(menuSortJsx.includes('/api/v1/admin/menus/reorder'), 'Must call /api/v1/admin/menus/reorder');
    assert.ok(bundleJs.includes('Tekan dan geser untuk mengatur urutan menu'), 'Bundle must contain CategoryMenuSortPage');

    const app = buildTestApp();
    const server = app.listen(0);
    const port = server.address().port;

    const brandId = 'brand_menu_reorder_test';
    try {
      db.prepare('DELETE FROM menus WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM categories WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(brandId, 'org_xentra_holding', 'Test Brand Menu', 'test-brand-menu');
      db.prepare('INSERT INTO categories (id, brand_id, name, slug, sort_order) VALUES (?, ?, ?, ?, ?)').run('cat_m1', brandId, 'Contoh kategori 1', 'contoh-kategori-1', 1);

      db.prepare('INSERT INTO menus (id, brand_id, category_id, package_name, selling_price, status) VALUES (?, ?, ?, ?, ?, ?)').run('m_t1', brandId, 'cat_m1', 'Menu A', 25000, 'ACTIVE');
      db.prepare('INSERT INTO menus (id, brand_id, category_id, package_name, selling_price, status) VALUES (?, ?, ?, ?, ?, ?)').run('m_t2', brandId, 'cat_m1', 'Menu B', 30000, 'ACTIVE');
      db.prepare('INSERT INTO menus (id, brand_id, category_id, package_name, selling_price, status) VALUES (?, ?, ?, ?, ?, ?)').run('m_t3', brandId, 'cat_m1', 'Menu C', 35000, 'ACTIVE');

      const res = await fetch(`http://127.0.0.1:${port}/api/v1/admin/menus/reorder`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-test-brand': brandId
        },
        body: JSON.stringify({
          category_id: 'cat_m1',
          order: ['m_t3', 'm_t1', 'm_t2']
        })
      });

      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.success, true);
      const catMenus = data.menus.filter((m) => m.category_id === 'cat_m1');
      assert.equal(catMenus[0].id, 'm_t3');
      assert.equal(catMenus[0].sort_order, 1);
      assert.equal(catMenus[1].id, 'm_t1');
      assert.equal(catMenus[1].sort_order, 2);
      assert.equal(catMenus[2].id, 'm_t2');
      assert.equal(catMenus[2].sort_order, 3);
    } finally {
      db.prepare('DELETE FROM menus WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM categories WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      server.close();
    }
  });
});
