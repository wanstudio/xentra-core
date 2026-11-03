'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ROOT = path.resolve(__dirname, '..');
const ITEM_EDITOR_PAGE_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/components/ItemEditorPage.jsx');
const SHELL_TSX_PATH = path.join(ROOT, 'packages/menu-editor-ui/src/shell/OwnerAppShell.tsx');
const BUNDLE_JS_PATH = path.join(ROOT, 'apps/owner-app/assets/bundles/menu-editor.js');
const db = require(path.join(ROOT, 'server/database/db.js'));
const registerAdminCatalogRoutes = require(path.join(ROOT, 'server/routes/admin-catalog.js'));
const registerAdminComposedMenuRoutes = require(path.join(ROOT, 'server/routes/admin-composed-menu.js'));

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'usr_test_owner', role: 'owner' };
    req.brand_id = req.headers['x-test-brand'] || 'brand_item_editor_test';
    req.organization_id = 'org_xentra_holding';
    next();
  });

  const router = express.Router();
  registerAdminCatalogRoutes(router, {
    db,
    requireAuth: () => (rq, rs, nxt) => nxt()
  });
  registerAdminComposedMenuRoutes(router, {
    requireAuth: () => (rq, rs, nxt) => nxt()
  });
  app.use('/api/v1', router);
  return app;
}

test('Owner Item Editor Redesign Suite (1:1 Figma Spec & Backend Contracts)', async (t) => {
  const code = fs.readFileSync(ITEM_EDITOR_PAGE_PATH, 'utf8');
  const shellTsx = fs.readFileSync(SHELL_TSX_PATH, 'utf8');
  const bundleJs = fs.readFileSync(BUNDLE_JS_PATH, 'utf8');

  await t.test('1. ItemEditorPage conforms 1:1 to Figma design tokens and elements', () => {
    assert.ok(fs.existsSync(ITEM_EDITOR_PAGE_PATH), 'ItemEditorPage.jsx must exist');
    assert.ok(code.includes('ci_arrow-left-sm.svg'), 'Must have ci_arrow-left-sm.svg back arrow');
    assert.ok(code.includes('Nama'), 'Must have Nama field');
    assert.ok(code.includes('#CBD5E1'), 'Must use #CBD5E1 input outlines');
    assert.ok(code.includes('Tipe stok'), 'Must have Tipe stok card');
    assert.ok(code.includes('Pakai Resep'), 'Must have Pakai Resep option');
    assert.ok(code.includes('Siap Jual (Non-Resep)'), 'Must have Siap Jual option');
    assert.ok(code.includes('#4285F4'), 'Pakai Resep avatar must be #4285F4');
    assert.ok(code.includes('#EA4335'), 'Siap Jual avatar must be #EA4335');
    assert.ok(code.includes('#00A637'), 'Switch toggle active color must be #00A637');
    assert.ok(code.includes('HPP bahan'), 'Must have HPP bahan section');
    assert.ok(code.includes('#1CA24B'), 'HPP per porsi color must be #1CA24B');
    assert.ok(code.includes('Lihat resep? →'), 'Must have Lihat resep link');
    assert.ok(code.includes('Harga modal (Rp)/pcs'), 'Must have Harga modal input');
    assert.ok(code.includes('Kelola stok (SKU)'), 'Must have Kelola stok (SKU) toggle');
    assert.ok(code.includes('Catatan'), 'Must have Catatan textarea');
    assert.ok(code.includes('0/250') || code.includes('/250'), 'Must have character counter');
    assert.ok(code.includes('Hapus item'), 'Must have Hapus item section in edit mode');
    assert.ok(code.includes('modern-item-editor-bottom-bar'), 'Must contain fixed bottom bar');
  });

  await t.test('2. OwnerAppShell wires catalog/products/new and catalog/products/:id/edit routes', () => {
    assert.ok(shellTsx.includes('import ItemEditorPage'), 'Shell must import ItemEditorPage');
    assert.ok(shellTsx.includes('catalog/products/new'), 'Shell must wire catalog/products/new');
    assert.ok(shellTsx.includes('catalog/products/'), 'Shell must wire catalog/products/:id/edit');
  });

  await t.test('3. Vite production bundle contains compiled ItemEditorPage', () => {
    assert.ok(bundleJs.includes('modern-item-editor-bottom-bar'), 'Bundle must contain bottom bar ID');
    assert.ok(bundleJs.includes('modern-item-editor-page-root'), 'Bundle must contain page root ID');
    assert.ok(bundleJs.includes('Pakai Resep'), 'Bundle must contain Pakai Resep text');
    assert.ok(bundleJs.includes('Siap Jual (Non-Resep)'), 'Bundle must contain Siap Jual text');
    assert.ok(bundleJs.includes('Kelola stok (SKU)'), 'Bundle must contain Kelola stok text');
  });

  await t.test('4. Backend API: POST creates product, PUT updates product, and DELETE removes product', async () => {
    const app = buildTestApp();
    const server = app.listen(0);
    const port = server.address().port;
    const brandId = 'brand_item_editor_test';

    try {
      // Seed test brand
      db.prepare('DELETE FROM products WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      db.prepare('INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
        brandId,
        'org_xentra_holding',
        'Brand Item Editor Test',
        'brand-item-editor-test'
      );

      // 4A. Create item
      const createRes = await fetch(`http://127.0.0.1:${port}/api/v1/admin/composed/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-brand': brandId,
        },
        body: JSON.stringify({
          name: 'Ayam Ungkep Bumbu',
          inventory_type: 'COOKED',
          cost_price: null,
          sku: 'AYAM-UNGKEP-01',
          description: 'Ayam ungkep berbumbu siap goreng',
        }),
      });

      const createData = await createRes.json();
      assert.equal(createRes.status, 201);
      assert.equal(createData.success, true);
      assert.ok(createData.product && createData.product.id);
      const createdId = createData.product.id;
      assert.equal(createData.product.name, 'Ayam Ungkep Bumbu');
      assert.equal(createData.product.inventory_type, 'COOKED');
      assert.equal(createData.product.sku, 'AYAM-UNGKEP-01');

      // 4B. Update item
      const updateRes = await fetch(`http://127.0.0.1:${port}/api/v1/admin/composed/products/${encodeURIComponent(createdId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-test-brand': brandId,
        },
        body: JSON.stringify({
          name: 'Ayam Ungkep Bumbu Spesial',
          inventory_type: 'DIRECT',
          cost_price: 25000,
          sku: 'AYAM-UNGKEP-SP',
          description: 'Ayam ungkep bumbu rempah spesial',
        }),
      });

      const updateData = await updateRes.json();
      assert.equal(updateRes.status, 200);
      assert.equal(updateData.success, true);
      assert.equal(updateData.product.name, 'Ayam Ungkep Bumbu Spesial');
      assert.equal(updateData.product.inventory_type, 'DIRECT');
      assert.equal(updateData.product.cost_price, 25000);

      // 4C. Delete item
      const deleteRes = await fetch(`http://127.0.0.1:${port}/api/v1/admin/products/${encodeURIComponent(createdId)}`, {
        method: 'DELETE',
        headers: {
          'x-test-brand': brandId,
        },
      });

      const deleteData = await deleteRes.json();
      assert.equal(deleteRes.status, 200);
      assert.equal(deleteData.success, true);

      // Verify deleted from db
      const check = db.prepare('SELECT id FROM products WHERE id = ?').get(createdId);
      assert.equal(check, undefined);
    } finally {
      db.prepare('DELETE FROM products WHERE brand_id = ?').run(brandId);
      db.prepare('DELETE FROM brands WHERE id = ?').run(brandId);
      server.close();
    }
  });

  await t.test('5. Card HPP Bahan is purely dynamic without hardcoded mock data', () => {
    // 5A. Must NOT contain hardcoded mock strings in source or bundle
    const forbidden = ['Sambal Geprek', '15.950', 'Cabai Setan', 'Bawang Merah', 'Bawang Putih'];
    for (const str of forbidden) {
      assert.equal(
        code.includes(str),
        false,
        `ItemEditorPage.jsx must NOT contain hardcoded mock text "${str}"`
      );
      assert.equal(
        bundleJs.includes(str),
        false,
        `menu-editor.js bundle must NOT contain hardcoded mock text "${str}"`
      );
    }

    // 5B. Must contain proper dynamic conditional rendering & GoBiz Chef Cat guided flow
    assert.ok(code.includes('hasRecipe'), 'Source must evaluate hasRecipe dynamically');
    assert.ok(code.includes('Buat resepnya dulu yuk') || code.includes('Bikin resepnya dulu yuk'), 'Source must have GoBiz Chef Cat empty state');
    assert.ok(code.includes('Buat resep'), 'Source must guide owner to create recipe');
    assert.ok(bundleJs.includes('Buat resepnya dulu yuk') || bundleJs.includes('Bikin resepnya dulu yuk'), 'Bundle must contain GoBiz Chef Cat empty state');
    assert.ok(bundleJs.includes('Buat resep'), 'Bundle must contain Buat resep CTA');

    // 5C. Must render real component lines dynamically
    assert.ok(code.includes('comp.material_name'), 'Source must bind dynamic component material_name');
    assert.ok(code.includes('comp.planned_quantity'), 'Source must bind dynamic component planned_quantity');
  });
});
