'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const db = require('../server/database/db');
const registerAdminCatalogRoutes = require('../server/routes/admin-catalog');

const ROOT = path.resolve(__dirname, '..');
const CATEGORIES_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/CategoriesPage.jsx');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.brand_id = req.headers['x-test-brand'] || 'brand_status_test';
    req.user = { id: 'u-owner-test', role: 'owner' };
    next();
  });
  const router = express.Router();
  registerAdminCatalogRoutes(router, {
    db,
    requireAuth: () => (req, _res, next) => next()
  });
  app.use('/api/v1', router);
  return app;
}

test('Category Status Toggle Suite', async (t) => {
  const categoriesPageJsx = fs.readFileSync(CATEGORIES_PAGE_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');
  const app = buildTestApp();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;

  t.after(() => {
    server.close();
  });

  const testBrandId = 'brand_status_test';
  try {
    db.prepare('DELETE FROM categories WHERE brand_id = ?').run(testBrandId);
    db.prepare('DELETE FROM brands WHERE id = ?').run(testBrandId);
    db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(testBrandId, 'org_xentra_holding', 'Test Status Brand', 'test-status-brand');
    db.prepare(`
      INSERT INTO categories (id, brand_id, name, slug, is_active, sort_order)
      VALUES ('cat-status-1', ?, 'Kategori Uji Status', 'kategori-uji-status', 1, 1)
    `).run(testBrandId);
  } catch (e) {}

  await t.test('1. CategoriesPage.jsx sends Content-Type and handles /status and fallback', () => {
    assert.ok(categoriesPageJsx.includes('/status'), 'Must attempt /status endpoint');
    assert.ok(categoriesPageJsx.includes('/toggle'), 'Must have fallback /toggle endpoint');
    assert.ok(categoriesPageJsx.includes("'Content-Type': 'application/json'"), 'Must include JSON Content-Type');
    assert.ok(categoriesPageJsx.includes('is_active: nextActive ? 1 : 0'), 'Must send is_active payload');
  });

  await t.test('2. PATCH /api/v1/admin/categories/:id/status updates status explicitly', async () => {
    const resDeactivate = await fetch(`${baseUrl}/admin/categories/cat-status-1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-test-brand': testBrandId
      },
      body: JSON.stringify({ is_active: 0 })
    });
    assert.equal(resDeactivate.status, 200);
    const dataDeactivate = await resDeactivate.json();
    assert.equal(dataDeactivate.success, true);
    assert.equal(dataDeactivate.category.is_active, 0);

    const row1 = db.prepare('SELECT is_active FROM categories WHERE id = ?').get('cat-status-1');
    assert.equal(row1.is_active, 0);

    // Reactivate
    const resActivate = await fetch(`${baseUrl}/admin/categories/cat-status-1/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-test-brand': testBrandId
      },
      body: JSON.stringify({ is_active: 1 })
    });
    assert.equal(resActivate.status, 200);
    const dataActivate = await resActivate.json();
    assert.equal(dataActivate.success, true);
    assert.equal(dataActivate.category.is_active, 1);

    const row2 = db.prepare('SELECT is_active FROM categories WHERE id = ?').get('cat-status-1');
    assert.equal(row2.is_active, 1);
  });

  await t.test('3. PATCH /api/v1/admin/categories/:id/toggle flips status', async () => {
    const resToggle1 = await fetch(`${baseUrl}/admin/categories/cat-status-1/toggle`, {
      method: 'PATCH',
      headers: { 'x-test-brand': testBrandId }
    });
    assert.equal(resToggle1.status, 200);
    const data1 = await resToggle1.json();
    assert.equal(data1.success, true);
    assert.equal(data1.category.is_active, 0);

    const resToggle2 = await fetch(`${baseUrl}/admin/categories/cat-status-1/toggle`, {
      method: 'PATCH',
      headers: { 'x-test-brand': testBrandId }
    });
    assert.equal(resToggle2.status, 200);
    const data2 = await resToggle2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.category.is_active, 1);
  });

  await t.test('4. Production bundle contains category status handling', () => {
    assert.ok(bundleJs.includes('/status'), 'Bundle must include /status endpoint');
    assert.ok(bundleJs.includes('Gagal mengubah status kategori'), 'Bundle must include error toast text');
  });
});
