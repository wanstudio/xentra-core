'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

describe('Owner Modern Mobile Architecture Parity Suite (7 Parameters Across All Pages)', () => {
  let app;
  let server;
  let baseUrl;
  const brandId = 'brand_demo_01';

  before(async () => {
    app = express();
    app.use(express.json());

    // Mock auth middleware providing owner brand context
    const mockAuth = () => (req, res, next) => {
      req.user = { id: 'usr_owner', role: 'owner', organization_id: 'org_demo' };
      req.brand_id = brandId;
      req.organization_id = 'org_demo';
      next();
    };

    // In-memory mock db mimicking sqlite db.prepare().all() / get() / run()
    const mockDb = {
      prepare: (sql) => {
        return {
          all: (...args) => {
            if (/FROM categories/i.test(sql)) {
              return [
                { id: 'cat_1', brand_id: brandId, name: 'Makanan', sort_order: 1, is_active: 1 },
                { id: 'cat_2', brand_id: brandId, name: 'Minuman', sort_order: 2, is_active: 1 },
              ];
            }
            if (/FROM products/i.test(sql)) {
              return [
                { id: 'prod_1', brand_id: brandId, name: 'Ayam Goreng', price: 20000, is_active: 1, sort_order: 1 },
              ];
            }
            return [];
          },
          get: (...args) => {
            if (/COUNT\(\*\)/i.test(sql)) {
              return { count: 3 };
            }
            if (/FROM categories/i.test(sql)) {
              const id = args[0];
              if (id === 'cat_1') {
                return { id: 'cat_1', brand_id: brandId, name: 'Makanan', sort_order: 1, is_active: 1 };
              }
              return null;
            }
            if (/FROM products/i.test(sql)) {
              const id = args[0];
              if (id === 'prod_1') {
                return { id: 'prod_1', brand_id: brandId, name: 'Ayam Goreng', price: 20000, is_active: 1 };
              }
              return null;
            }
            return null;
          },
          run: () => ({ changes: 1 })
        };
      }
    };

    // Register admin catalog routes
    const registerAdminCatalogRoutes = require('../server/routes/admin-catalog');
    const router = express.Router();
    registerAdminCatalogRoutes(router, { db: mockDb, requireAuth: mockAuth });
    app.use('/', router);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('1. Category Endpoints: GET /admin/categories & GET /admin/categories/:id have Cache-Control: no-store', async () => {
    const listRes = await fetch(`${baseUrl}/admin/categories`);
    assert.strictEqual(listRes.status, 200);
    const listHeaders = listRes.headers.get('cache-control') || '';
    assert.match(listHeaders, /no-store/i, 'List endpoint must set Cache-Control: no-store');
    const listJson = await listRes.json();
    assert.strictEqual(listJson.success, true);
    assert.strictEqual(listJson.categories.length, 2);

    // Test GET /admin/categories/:id detail endpoint
    const detailRes = await fetch(`${baseUrl}/admin/categories/cat_1`);
    assert.strictEqual(detailRes.status, 200);
    const detailHeaders = detailRes.headers.get('cache-control') || '';
    assert.match(detailHeaders, /no-store/i, 'Detail endpoint must set Cache-Control: no-store');
    const detailJson = await detailRes.json();
    assert.strictEqual(detailJson.success, true);
    assert.strictEqual(detailJson.category.name, 'Makanan');
    assert.strictEqual(detailJson.category.product_count, 3);

    // Test 404 for non-existent category
    const notFoundRes = await fetch(`${baseUrl}/admin/categories/cat_nonexistent`);
    assert.strictEqual(notFoundRes.status, 404);
  });

  test('2. Product Endpoints: GET /admin/products & GET /admin/products/:id have Cache-Control: no-store', async () => {
    const listRes = await fetch(`${baseUrl}/admin/products`);
    assert.strictEqual(listRes.status, 200);
    const listHeaders = listRes.headers.get('cache-control') || '';
    assert.match(listHeaders, /no-store/i, 'Products list endpoint must set Cache-Control: no-store');
    const listJson = await listRes.json();
    assert.strictEqual(listJson.success, true);

    const detailRes = await fetch(`${baseUrl}/admin/products/prod_1`);
    assert.strictEqual(detailRes.status, 200);
    const detailHeaders = detailRes.headers.get('cache-control') || '';
    assert.match(detailHeaders, /no-store/i, 'Products detail endpoint must set Cache-Control: no-store');
  });

  test('3. Service Worker: bypasses /api/, /admin/, and uses bumped CACHE_NAME v1.8.x', () => {
    const swPath = path.join(__dirname, '../apps/owner-app/sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    assert.match(swContent, /mybangjo-owner-v1\.8\.\d+/, 'SW cache name must be bumped to v1.8.x');
    assert.match(swContent, /url\.pathname\.startsWith\('\/admin\/'\)/, 'SW must bypass /admin/ as network-only');
    assert.match(swContent, /url\.pathname\.startsWith\('\/api\/'\)/, 'SW must bypass /api/ as network-only');
  });

  test('4. CategoriesPage.jsx: implements reactive sync on categories-updated & cache-buster fetch', () => {
    const filePath = path.join(__dirname, '../packages/menu-editor-ui/src/components/CategoriesPage.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.match(content, /categories-updated/, 'CategoriesPage must listen to categories-updated event');
    assert.match(content, /cache:\s*'no-store'/, 'CategoriesPage fetch must specify cache: no-store');
    assert.match(content, /_t=\$\{Date\.now\(\)\}/, 'CategoriesPage fetch must include dynamic timestamp cache-buster');
  });

  test('5. CategoryEditorPage.jsx & AddCategoryBottomSheet.jsx: dispatch reactive sync events', () => {
    const editorPath = path.join(__dirname, '../packages/menu-editor-ui/src/components/CategoryEditorPage.jsx');
    const editorContent = fs.readFileSync(editorPath, 'utf8');
    assert.match(editorContent, /window\.dispatchEvent\(new CustomEvent\('categories-updated'/, 'CategoryEditorPage must dispatch categories-updated on save/delete');

    const sheetPath = path.join(__dirname, '../packages/menu-editor-ui/src/components/AddCategoryBottomSheet.jsx');
    const sheetContent = fs.readFileSync(sheetPath, 'utf8');
    assert.match(sheetContent, /window\.dispatchEvent\(new CustomEvent\('categories-updated'/, 'AddCategoryBottomSheet must dispatch categories-updated on create');
  });

  test('6. ItemMasterPage.jsx: implements reactive sync on items-updated & cache-buster fetch', () => {
    const filePath = path.join(__dirname, '../packages/menu-editor-ui/src/components/ItemMasterPage.jsx');
    const content = fs.readFileSync(filePath, 'utf8');

    assert.match(content, /items-updated/, 'ItemMasterPage must listen to items-updated event');
    assert.match(content, /cache:\s*'no-store'/, 'ItemMasterPage fetch must specify cache: no-store');
    assert.match(content, /_t=\$\{Date\.now\(\)\}/, 'ItemMasterPage fetch must include dynamic timestamp cache-buster');
  });

  test('7. ItemEditorPage.jsx: dispatches items-updated on save and delete', () => {
    const editorPath = path.join(__dirname, '../packages/menu-editor-ui/src/components/ItemEditorPage.jsx');
    const editorContent = fs.readFileSync(editorPath, 'utf8');

    assert.match(editorContent, /window\.dispatchEvent\(new CustomEvent\('items-updated'/, 'ItemEditorPage must dispatch items-updated on save');
    assert.match(editorContent, /_deleted:\s*true/, 'ItemEditorPage must dispatch items-updated with _deleted: true on delete');
  });

  test('8. CategoryDetailPage.jsx: implements direct detail fetch and reactive categories-updated listener', () => {
    const detailPath = path.join(__dirname, '../packages/menu-editor-ui/src/components/CategoryDetailPage.jsx');
    const detailContent = fs.readFileSync(detailPath, 'utf8');

    assert.match(detailContent, /categories-updated/, 'CategoryDetailPage must listen to categories-updated event');
    assert.match(detailContent, /cache:\s*'no-store'/, 'CategoryDetailPage must fetch with cache: no-store');
  });
});
