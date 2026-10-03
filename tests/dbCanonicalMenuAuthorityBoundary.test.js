'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const dbSource = fs.readFileSync(path.join(ROOT, 'server/database/db.js'), 'utf8');
const composedResolver = fs.readFileSync(
  path.join(ROOT, 'domains/catalog/services/ComposedMenuResolver.js'),
  'utf8'
);
const historicalPlan = fs.readFileSync(
  path.join(ROOT, 'docs/decisions/xentra-master-menu-composition-implementation-plan-v1.md'),
  'utf8'
);
const legacyMigrationCli = fs.readFileSync(
  path.join(ROOT, 'tools/migrate-master-menu.js'),
  'utf8'
);

test('Legacy branch-product startup migration cannot become canonical Menu authority', () => {
  const start = dbSource.indexOf('// LEGACY BRANCH-PRODUCT COMPATIBILITY MIGRATION ONLY.');
  const end = dbSource.indexOf('// Authoritative separation: Schema initialization only provisions essential tenant structure', start);
  assert.ok(start >= 0 && end > start, 'legacy branch-product migration block must be explicitly delimited');

  const block = dbSource.slice(start, end);

  assert.ok(block.includes('UPDATE branch_products'), 'legacy compatibility migration may update branch_products');
  assert.ok(block.includes('branch_product_categories'), 'legacy Product-category reconciliation may remain');
  const canonicalMutation = /(?:UPDATE|INSERT(?:\s+OR\s+(?:IGNORE|REPLACE))?|DELETE\s+FROM)\s+(?:menus|branch_menus|branch_menu_categories)\b/i;
  assert.ok(!canonicalMutation.test(block), 'legacy compatibility migration must not execute mutations against canonical Menu tables');
});

test('Canonical Menu resolver prices from menus.selling_price, not Product or branch Product price', () => {
  assert.ok(
    composedResolver.includes('price: Number(menu.selling_price)'),
    'canonical resolver must expose Menu selling_price'
  );
  assert.ok(!composedResolver.includes('branch_products.price'));
  assert.ok(!composedResolver.includes('product.price'));
  assert.ok(!composedResolver.includes('products.price'));
});

test('Old Product-centric implementation plan is visibly superseded', () => {
  assert.ok(historicalPlan.includes('Status:** SUPERSEDED'));
  assert.ok(historicalPlan.includes('docs/proposals/xentra-taxonomy-composed-menu-v1.md'));
  assert.ok(historicalPlan.includes('Do not use its Product-centric composition/pricing/category model as current implementation authority'));
});

test('DB comments explicitly classify branch_products.price as a legacy compatibility shadow', () => {
  assert.ok(dbSource.includes('Legacy pricing compatibility shadow only'));
  assert.ok(dbSource.includes('Canonical Menu selling price is menus.selling_price'));
  assert.ok(dbSource.includes('branch_products.price MUST NOT be treated as authority by new Menu code'));
});

test('Superseded Product-centric migration CLI fails closed', () => {
  assert.ok(legacyMigrationCli.includes('LEGACY_MASTER_MENU_MIGRATION_DISABLED'));
  assert.ok(legacyMigrationCli.includes('Product → Menu → Inventory'));
  assert.ok(!legacyMigrationCli.includes("require('../core/data/DataAccess')"));
  assert.ok(!legacyMigrationCli.includes('ProductMenuMigrationService.reconcile'));
  assert.ok(!legacyMigrationCli.includes('ProductMenuMigrationService.verify'));
});


test('Forward Customer/POS/Checkout paths stay on the canonical Menu boundary', () => {
  const route = fs.readFileSync(path.join(ROOT, 'server/routes/catalog.js'), 'utf8');
  const home = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/home.js'), 'utf8');
  const pos = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
  const checkout = fs.readFileSync(path.join(ROOT, 'apps/customer-pwa/assets/js/pages/checkout.js'), 'utf8');
  const composedCheckout = fs.readFileSync(
    path.join(ROOT, 'domains/commerce/services/ComposedMenuCheckoutService.js'),
    'utf8'
  );

  assert.ok(route.includes("router.get('/catalog/composed-menu'"), 'canonical catalog route must exist');
  assert.ok(route.includes('ComposedMenuResolver.resolveBranchMenu'), 'canonical catalog route must use ComposedMenuResolver');
  assert.ok(route.includes("router.get(['/catalog/menu', '/home']"), 'legacy catalog route must remain isolated as compatibility');
  assert.ok(route.includes('CatalogService.getMenu'), 'legacy CatalogService must remain behind the compatibility route');

  for (const [name, source] of [['Customer Home', home], ['POS', pos], ['Checkout', checkout]]) {
    assert.ok(source.includes('/catalog/composed-menu'), name + ' must consume the canonical composed-menu endpoint');
    assert.ok(
      !/(?:["'\`])\/catalog\/menu(?:[?'"\`]|$)/.test(source),
      name + ' must not call the legacy /catalog/menu endpoint'
    );
  }

  assert.ok(
    composedCheckout.includes("require('../../catalog/services/ComposedMenuResolver')"),
    'canonical checkout verification must resolve through ComposedMenuResolver'
  );
  assert.ok(composedCheckout.includes('menu.selling_price'), 'canonical checkout pricing must come from Menu selling_price');
});


test('Checkout keeps MasterMenuResolver strictly behind the legacy Product fallback', () => {
  const gate = fs.readFileSync(
    path.join(ROOT, 'domains/commerce/services/PrePaymentVerificationGate.js'),
    'utf8'
  );
  const canonicalGuard = "if (item.menu_id) continue;";
  const masterCall = "MasterMenuResolver.resolveBranchMenu({";
  const guardIndex = gate.indexOf(canonicalGuard);
  const masterIndex = gate.indexOf(masterCall);

  assert.ok(guardIndex >= 0, 'canonical menu items must exit the legacy Product verification loop');
  assert.ok(masterIndex > guardIndex, 'MasterMenuResolver fallback must occur only after canonical menu items are skipped');
  assert.ok(
    gate.includes('const nonRewardLegacyItems = items.filter'),
    'checkout must explicitly separate legacy Product items from canonical Menu items'
  );
  assert.ok(
    gate.includes("status: 'MIXED_MENU_MODELS'"),
    'checkout must reject mixing canonical Menu and legacy Product cart models'
  );
});


test('Forward Merchant surfaces do not read legacy branch-product catalog endpoints', () => {
  const merchantBranchCatalog = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-app/assets/js/branch-catalog-ui.js'),
    'utf8'
  );
  const merchantMenu = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-app/assets/js/menu.js'),
    'utf8'
  );
  const merchantToday = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-app/assets/js/hari-ini.js'),
    'utf8'
  );
  const ownerBranchCatalog = fs.readFileSync(
    path.join(ROOT, 'apps/merchant-dashboard/assets/js/branch-catalog-ui.js'),
    'utf8'
  );

  for (const [name, source] of [
    ['Merchant Branch Catalog', merchantBranchCatalog],
    ['Merchant Menu', merchantMenu],
    ['Merchant Hari Ini', merchantToday],
    ['Owner Branch Catalog', ownerBranchCatalog]
  ]) {
    assert.ok(
      !source.includes('/admin/branches/'),
      name + ' must not hard-code legacy branch-product admin transport'
    );
    assert.ok(
      !source.includes('updateBranchProductOverride'),
      name + ' must not call the legacy Product override transport'
    );
  }

  assert.ok(
    merchantToday.includes('/admin/branches/" + encodeURIComponent(branchId) + "/menu'),
    'Merchant Hari Ini must read canonical Branch Menu state'
  );
});
