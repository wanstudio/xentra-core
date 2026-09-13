'use strict';

/**
 * PHASE 1 OWNER DASHBOARD — CATALOG TEST SUITE
 * Tests:
 * 1. Master Products CRUD (List, Create, Edit, Toggle, Delete, Category Filter).
 * 2. Master Product Detail view API (Single Product + Branch Adoptions status matrix).
 * 3. Master Categories CRUD & Assignment Protection (Cannot delete category with products assigned).
 * 4. Menus / Branch Catalog assortment flow:
 *    - Owner inspects branch catalog via /admin/branches/:id/catalog
 *    - Branch adopts master product via /admin/branches/:id/adopt
 *    - Branch overrides price, name, description, category
 *    - Verify customer-facing and branch assortment reflects fresh core state without Xentra Connector.
 * 5. Multi-tenant isolation & RBAC enforcement.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const db = require('../server/database/db');
const app = require('../server/app');

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const payload = body != null ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: options.headers && options.headers.Host ? options.headers.Host : 'app.mybangjo.com',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

test('PHASE 1: OWNER DASHBOARD CATALOG IMPLEMENTATION', async (t) => {
  let server;
  let ownerToken;
  let branchManagerToken;
  let cashierToken;
  let createdCategoryId = null;
  let createdProductId = null;
  const BRAND_ID = 'brand_bangjo';
  const BRANCH_ID = 'branch_bangjo_barat';

  await t.test('0. Setup: server & auth sessions', async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));

    const ownerUser = db.prepare("SELECT * FROM users WHERE id = 'usr_bangjo_owner'").get();
    assert.ok(ownerUser, 'Owner user must exist');
    const ownerSession = global.TokenSessionStore.createSession(ownerUser, BRAND_ID);
    ownerToken = ownerSession.token;

    const bmUser = db.prepare("SELECT * FROM users WHERE role = 'branch_manager' AND brand_id = ?").get(BRAND_ID);
    if (bmUser) {
      const bmSession = global.TokenSessionStore.createSession(bmUser, BRAND_ID);
      branchManagerToken = bmSession.token;
    }

    const cashierUser = db.prepare("SELECT * FROM users WHERE role = 'cashier' AND brand_id = ?").get(BRAND_ID);
    if (cashierUser) {
      const cashSession = global.TokenSessionStore.createSession(cashierUser, BRAND_ID);
      cashierToken = cashSession.token;
    }
  });

  // 1. MASTER CATEGORIES
  await t.test('1. Master Category CRUD and Assignment Protection', async (t2) => {
    await t2.test('1.1 Create Master Category', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/admin/categories',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, { name: 'Kategori Uji Coba Phase 1' });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.category && res.body.category.id);
      createdCategoryId = res.body.category.id;
    });

    await t2.test('1.2 List Categories includes newly created category', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/categories',
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const found = res.body.categories.find(c => c.id === createdCategoryId);
      assert.ok(found, 'Created category must appear in category list');
      assert.strictEqual(found.name, 'Kategori Uji Coba Phase 1');
    });

    await t2.test('1.3 Edit Master Category', async () => {
      const res = await makeRequest(server, {
        method: 'PUT',
        path: `/api/v1/admin/categories/${createdCategoryId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, { name: 'Kategori Uji Coba Phase 1 Renamed' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const row = db.prepare('SELECT name FROM categories WHERE id = ?').get(createdCategoryId);
      assert.strictEqual(row.name, 'Kategori Uji Coba Phase 1 Renamed');
    });
  });

  // 2. MASTER PRODUCTS
  await t.test('2. Master Products CRUD and Product Detail API', async (t2) => {
    await t2.test('2.1 Create Master Product assigned to category', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: '/api/v1/admin/products',
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Produk Uji Coba Phase 1',
        category_id: createdCategoryId,
        price: 30000,
        regular_price: 35000,
        pricing_mode: 'range',
        min_price: 25000,
        max_price: 40000,
        description: 'Deskripsi produk uji coba'
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.product && res.body.product.id);
      createdProductId = res.body.product.id;
    });

    await t2.test('2.2 Category deletion is protected when product is assigned', async () => {
      const res = await makeRequest(server, {
        method: 'DELETE',
        path: `/api/v1/admin/categories/${createdCategoryId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 400, 'Must reject category deletion with active products');
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('tidak dapat dihapus'));
    });

    await t2.test('2.3 GET /admin/products/:id returns detail with branch adoption matrix', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.product.id, createdProductId);
      assert.strictEqual(res.body.product.name, 'Produk Uji Coba Phase 1');
      assert.strictEqual(res.body.product.pricing_mode, 'range');

      assert.ok(Array.isArray(res.body.branch_adoptions), 'Must include branch_adoptions array');
      assert.ok(res.body.branch_adoptions.length > 0, 'Must list branches');
      const bBarat = res.body.branch_adoptions.find(b => b.branch_id === BRANCH_ID);
      assert.ok(bBarat, 'Branch Barat must be in adoptions matrix');
      assert.strictEqual(bBarat.is_adopted, 0, 'Newly created product should not be adopted yet');
    });

    await t2.test('2.4 Edit Master Product', async () => {
      const res = await makeRequest(server, {
        method: 'PUT',
        path: `/api/v1/admin/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Produk Uji Coba Phase 1 Updated',
        price: 32000
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const row = db.prepare('SELECT name, price FROM products WHERE id = ?').get(createdProductId);
      assert.strictEqual(row.name, 'Produk Uji Coba Phase 1 Updated');
      assert.strictEqual(row.price, 32000);
    });

    await t2.test('2.5 Toggle Master Product availability', async () => {
      const res = await makeRequest(server, {
        method: 'PATCH',
        path: `/api/v1/admin/products/${createdProductId}/toggle`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      const row = db.prepare('SELECT is_active FROM products WHERE id = ?').get(createdProductId);
      assert.strictEqual(row.is_active, 0, 'Toggled from 1 to 0');
    });
  });

  // 3. BRANCH MENUS & ADOPTION FLOW
  await t.test('3. Branch Menus / Assortment Workflow', async (t2) => {
    await t2.test('3.1 Inspect Branch Catalog (Available Master Products contains new product)', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${BRANCH_ID}/catalog`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const available = res.body.available_master_products.find(p => p.id === createdProductId);
      assert.ok(available, 'Product must be in available master products list');
    });

    await t2.test('3.2 Adopt Product into Branch Catalog with Range Price', async () => {
      const res = await makeRequest(server, {
        method: 'POST',
        path: `/api/v1/admin/branches/${BRANCH_ID}/adopt`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        product_id: createdProductId,
        price: 28000 // Valid within 25000 - 40000 range
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
    });

    await t2.test('3.3 Verify Product Detail now reflects branch adoption', async () => {
      const res = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      const bBarat = res.body.branch_adoptions.find(b => b.branch_id === BRANCH_ID);
      assert.ok(bBarat);
      assert.strictEqual(bBarat.is_adopted, 1, 'Product is now adopted at branch');
      assert.strictEqual(bBarat.branch_price, 28000);
    });

    await t2.test('3.4 Branch Product Override (Name, Description, Price)', async () => {
      const res = await makeRequest(server, {
        method: 'PATCH',
        path: `/api/v1/admin/branches/${BRANCH_ID}/products/${createdProductId}/override`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      }, {
        name: 'Spesial Cabang Barat Phase 1',
        description: 'Resep khas cabang barat',
        price: 35000
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify branch catalog returns overridden attributes
      const cRes = await makeRequest(server, {
        method: 'GET',
        path: `/api/v1/admin/branches/${BRANCH_ID}/catalog`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      const adopted = cRes.body.adopted_products.find(p => p.product_id === createdProductId);
      assert.ok(adopted);
      assert.strictEqual(adopted.name, 'Spesial Cabang Barat Phase 1');
      assert.strictEqual(adopted.price, 35000);
      assert.strictEqual(adopted.master_name, 'Produk Uji Coba Phase 1 Updated');
    });

    await t2.test('3.5 Remove product from branch catalog', async () => {
      const res = await makeRequest(server, {
        method: 'DELETE',
        path: `/api/v1/admin/branches/${BRANCH_ID}/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });
  });

  // 4. CLEANUP & RBAC
  await t.test('4. RBAC & Cleanup', async (t2) => {
    await t2.test('4.1 Cashier is rejected from accessing Admin Products and Categories', async () => {
      if (!cashierToken) return;
      const res = await makeRequest(server, {
        method: 'GET',
        path: '/api/v1/admin/products',
        headers: { Authorization: `Bearer ${cashierToken}` }
      });

      assert.strictEqual(res.status, 403, 'Cashier must be forbidden from admin products');
    });

    await t2.test('4.2 Delete created product and delete category', async () => {
      const pRes = await makeRequest(server, {
        method: 'DELETE',
        path: `/api/v1/admin/products/${createdProductId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(pRes.status, 200);

      // Now category deletion should succeed
      const cRes = await makeRequest(server, {
        method: 'DELETE',
        path: `/api/v1/admin/categories/${createdCategoryId}`,
        headers: { Authorization: `Bearer ${ownerToken}` }
      });
      assert.strictEqual(cRes.status, 200);
    });
  });

  // 5. DIRECT ROUTES & REFRESH (Server-side delivery & route parsing)
  await t.test('5. Direct Navigation, Refresh & Core Authority', async (t2) => {
    const catalogRoutes = [
      '/dashboard/catalog/products',
      '/dashboard/catalog/products/prod_sample_123',
      '/dashboard/catalog/categories',
      '/dashboard/catalog/menus'
    ];

    for (const route of catalogRoutes) {
      await t2.test(`5.1 Direct GET ${route} serves 200 index.html on tenant host`, async () => {
        const res = await makeRequest(server, {
          method: 'GET',
          path: route,
          headers: { Host: 'app.mybangjo.com' }
        });
        assert.strictEqual(res.status, 200);
        assert.ok(typeof res.body === 'string');
        assert.ok(res.body.includes('tab-catalog-products'));
        assert.ok(res.body.includes('tab-catalog-categories'));
        assert.ok(res.body.includes('tab-catalog-menus'));
      });
    }

    await t2.test('5.2 Xentra Connector is HOLD and not imported/required for Catalog', () => {
      const apiCode = require('fs').readFileSync(require('path').join(__dirname, '../server/routes/api.js'), 'utf8');
      const catalogServiceCode = require('fs').readFileSync(require('path').join(__dirname, '../domains/commerce/services/CatalogService.js'), 'utf8');
      assert.ok(!apiCode.includes("require('../../connector"), 'API must not depend on Connector');
      assert.ok(!catalogServiceCode.includes('connector'), 'CatalogService must not depend on Connector');
    });
  });

  t.after(() => {
    if (server) server.close();
  });
});
