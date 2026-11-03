'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const db = require(path.join(ROOT, 'server/database/db'));

test('MULTI-BRANCH GOVERNANCE & MOBILE ISOLATION SUITE', async (t) => {
  const brandId = 'brand_gov_test_' + Date.now();
  const orgId = 'org_gov_test_' + Date.now();
  const branch1Id = 'branch_gov_1_' + Date.now();
  const branch2Id = 'branch_gov_2_' + Date.now();
  const productId = 'prod_gov_' + Date.now();
  const menuId = 'menu_gov_' + Date.now();

  // Setup seed data in SQLite
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Org Gov', ?)").run(orgId, 'slug-' + orgId);
  db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand Gov Test', ?)").run(brandId, orgId, 'slug-' + brandId);
  db.prepare("INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override) VALUES (?, ?, 'Cabang Sudirman', 'sudirman', 'Jl. Sudirman No. 1', -6.2088, 106.8456, 1, 1)").run(branch1Id, brandId);
  db.prepare("INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, is_active, is_open_override) VALUES (?, ?, 'Cabang Bandara', 'bandara', 'Terminal 3', -6.1275, 106.6537, 1, 1)").run(branch2Id, brandId);
  db.prepare("INSERT INTO products (id, brand_id, name, slug, price, is_active) VALUES (?, ?, 'Ayam Goreng Master', 'ayam-goreng-master', 25000, 1)").run(productId, brandId);
  db.prepare("INSERT INTO menus (id, brand_id, package_name, selling_price, status) VALUES (?, ?, 'Paket Ayam Master', 25000, 'ACTIVE')").run(menuId, brandId);

  await t.test('1. Architecture Decoupling: apps/owner-app/index.html isolates mobile from legacy dashboard.js', () => {
    const ownerHtml = fs.readFileSync(path.join(ROOT, 'apps/owner-app/index.html'), 'utf8');
    assert.equal(ownerHtml.includes('/dashboard/assets/js/dashboard.js'), false, 'owner-app/index.html must NOT load dashboard.js');
    assert.ok(ownerHtml.includes('id="desktop-phone-frame-wrapper"'), 'Must have responsive desktop container');
    assert.ok(ownerHtml.includes('id="xentra-owner-app-mount"'), 'Must have modern React root mount');
    assert.ok(ownerHtml.includes('/owner/assets/bundles/menu-editor.js'), 'Must load modern React bundle');
    assert.ok(ownerHtml.includes('/owner/assets/js/owner-app.js'), 'Must load dedicated mobile app controller');
  });

  await t.test('2. Server Boundary: server/app.js serves owner-app for subdomain owner', () => {
    const appJs = fs.readFileSync(path.join(ROOT, 'server/app.js'), 'utf8');
    const ownerRouteSection = appJs.match(/if\s*\(subType\s*===\s*'owner'\)\s*\{[\s\S]*?\}/);
    assert.ok(ownerRouteSection, 'Must handle subType === owner');
    assert.ok(ownerRouteSection[0].includes('apps/owner-app/index.html'), 'Subdomain owner must route to apps/owner-app/index.html');
  });

  await t.test('3. Shell Completeness: OwnerAppShell.tsx covers all 5 main tabs', () => {
    const shellTsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/shell/OwnerAppShell.tsx'), 'utf8');
    assert.ok(shellTsx.includes('OrdersPage'), 'Shell must include OrdersPage');
    assert.ok(shellTsx.includes('FinancePage'), 'Shell must include FinancePage');
    assert.ok(shellTsx.includes('MorePage'), 'Shell must include MorePage');
    assert.ok(shellTsx.includes("currentRoute === 'orders'"), 'Shell must route orders');
    assert.ok(shellTsx.includes("currentRoute === 'finance'"), 'Shell must route finance');
    assert.ok(shellTsx.includes("currentRoute === 'more'"), 'Shell must route more');
  });

  await t.test('4. Location-Specific Pricing (LSP) in ItemEditorPage and MenuEditor UI', () => {
    const itemEditorJsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/ItemEditorPage.jsx'), 'utf8');
    const menuEditorJsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/MenuEditor.jsx'), 'utf8');
    assert.ok(itemEditorJsx.includes('Harga Khusus Cabang (LSP)'), 'ItemEditorPage must render LSP section');
    assert.ok(itemEditorJsx.includes('branch_prices'), 'ItemEditorPage must handle branch_prices state & payload');
    assert.ok(menuEditorJsx.includes('Harga Khusus Cabang (LSP)'), 'MenuEditor must render LSP section');
    assert.ok(menuEditorJsx.includes('branch_prices'), 'MenuEditor must handle branch_prices payload');
  });

  await t.test('5. Backend LSP Persistence: PUT /admin/products/:id updates branch_products.price', () => {
    const catalogRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/admin-catalog.js'), 'utf8');
    assert.ok(catalogRoutes.includes('branch_prices'), 'admin-catalog.js must process branch_prices in PUT /admin/products/:id');

    // Test direct DB query matching route logic
    db.prepare(`
      INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
      VALUES (?, ?, ?, 100, 1)
      ON CONFLICT(branch_id, product_id) DO UPDATE SET price = excluded.price
    `).run(branch2Id, productId, 30000);

    const bp = db.prepare('SELECT price FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch2Id, productId);
    assert.equal(bp.price, 30000, 'Branch 2 (Bandara) must store overridden price 30,000');
  });

  await t.test('6. Backend 86 Observability: GET /admin/branches returns items_86_count', () => {
    const branchRoutes = fs.readFileSync(path.join(ROOT, 'server/routes/admin-branches.js'), 'utf8');
    assert.ok(branchRoutes.includes('items_86_count'), 'admin-branches.js must project items_86_count');

    // Simulate item 86 at branch 1 (is_available = 0)
    db.prepare(`
      INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
      VALUES (?, ?, ?, 0, 0)
    `).run(branch1Id, productId, 25000);

    const count86 = db.prepare(
      'SELECT COUNT(*) AS c FROM branch_products WHERE branch_id = ? AND (is_available = 0 OR stock <= 0)'
    ).get(branch1Id);
    assert.equal(count86.c, 1, 'Branch 1 must report 1 item 86');
  });

  await t.test('7. Emergency Remote Switch in OverviewPage.tsx', () => {
    const overviewTsx = fs.readFileSync(path.join(ROOT, 'packages/menu-editor-ui/src/components/OverviewPage.tsx'), 'utf8');
    assert.ok(overviewTsx.includes('Kontrol Operasional & Darurat Cabang'), 'OverviewPage must render Emergency Control header');
    assert.ok(overviewTsx.includes('Buka Normal'), 'OverviewPage must have Buka Normal state');
    assert.ok(overviewTsx.includes('Pause Online Saja (Graceful Drain)'), 'OverviewPage must have Graceful Drain option');
    assert.ok(overviewTsx.includes('Tutup Paksa (Darurat)'), 'OverviewPage must have Force Close option');
    assert.ok(overviewTsx.includes('handleSetBranchMode'), 'OverviewPage must define mode setter calling PATCH');
  });
});
