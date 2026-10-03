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
  assert.ok(!block.includes('UPDATE menus'), 'legacy compatibility migration must not mutate canonical Menu rows');
  assert.ok(!block.includes('INSERT INTO menus'), 'legacy compatibility migration must not create canonical Menu rows');
  assert.ok(!block.includes('UPDATE branch_menus'), 'legacy compatibility migration must not mutate Branch Menu adoption');
  assert.ok(!block.includes('INSERT INTO branch_menus'), 'legacy compatibility migration must not create Branch Menu adoption');
  assert.ok(!block.includes('UPDATE branch_menu_categories'), 'legacy compatibility migration must not mutate canonical Menu category membership');
  assert.ok(!block.includes('INSERT INTO branch_menu_categories'), 'legacy compatibility migration must not create canonical Menu category membership');
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
