'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('legacy vocabulary quarantine: canonical menu consumers do not fall back to package_name or generic Menu labels', () => {
  const resolver = read('domains/catalog/services/ComposedMenuResolver.js');
  const branchMenu = read('server/routes/admin-branch-menu.js');
  const customerHome = read('apps/customer-pwa/assets/js/pages/home.js');
  const checkout = read('apps/customer-pwa/assets/js/pages/checkout.js');
  const pos = read('apps/pos-app/assets/js/pos-app.js');
  const merchantMenu = read('apps/merchant-app/assets/js/menu.js');

  assert.doesNotMatch(
    resolver,
    /if\s*\(!title\)\s*return\s*['"]Menu['"]/,
    'Resolver must not synthesize a Menu title when canonical title data is absent'
  );

  assert.doesNotMatch(
    resolver,
    /menu\.package_name/,
    'Canonical Menu resolver must not use package_name as title/identity fallback'
  );

  for (const [name, source] of [
    ['admin branch menu', branchMenu],
    ['customer home', customerHome],
    ['checkout', checkout],
    ['POS', pos],
    ['merchant menu', merchantMenu]
  ]) {
    assert.doesNotMatch(
      source,
      /menu\.title\s*\|\|\s*menu\.package_name/,
      name + ' must not fall back from canonical title to package_name'
    );
    assert.doesNotMatch(
      source,
      /menu\.title\s*\|\|\s*['"]Menu['"]/,
      name + ' must not synthesize generic Menu identity'
    );
  }

  assert.doesNotMatch(
    customerHome,
    /menu\.menu_type\s*===\s*['"]SINGLE['"]/,
    'Customer Home must not derive Product identity from legacy menu_type'
  );
  assert.doesNotMatch(
    pos,
    /menu\.menu_type\s*===\s*['"]SINGLE['"]/,
    'POS must not derive Product identity from legacy menu_type'
  );
});

test('legacy costing vocabulary is quarantined from the current canonical Catalog services', () => {
  const files = [
    'domains/catalog/services/ComposedMenuService.js',
    'domains/catalog/services/ComposedProductService.js',
    'domains/catalog/services/ComposedMenuResolver.js',
    'server/routes/admin-composed-menu.js'
  ];

  for (const relativePath of files) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /\bcostPrice\b|\bcost_price\b/,
      relativePath + ' must not establish legacy cost_price as a new canonical Catalog authority'
    );
  }

  const merchantDashboard = read('apps/merchant-dashboard/index.html');
  assert.doesNotMatch(
    merchantDashboard,
    /HPP item terjual/i,
    'Legacy ambiguous HPP item terjual label must not remain in the active dashboard'
  );
});

test('legacy menu_type may remain only as bounded compatibility data, not as a fallback rule', () => {
  const home = read('apps/customer-pwa/assets/js/pages/home.js');
  const pos = read('apps/pos-app/assets/js/pos-app.js');
  const checkout = read('apps/customer-pwa/assets/js/pages/checkout.js');

  assert.match(home, /menu_snapshot\s*:/, 'Home may preserve transaction snapshot compatibility');
  assert.match(pos, /menu_snapshot\s*=/, 'POS may preserve transaction snapshot compatibility');
  assert.match(checkout, /menu_snapshot\s*:/, 'Checkout may preserve transaction snapshot compatibility');

  assert.doesNotMatch(
    home,
    /menu_type\s*:\s*menu\.menu_type\s*\|\|\s*['"]SINGLE['"]/,
    'Home must not invent SINGLE as a canonical default'
  );
  assert.doesNotMatch(
    pos,
    /menu_type\s*:\s*p\.menu_type\s*\|\|\s*['"]SINGLE['"]/,
    'POS must not invent SINGLE as a canonical default'
  );
});

test('legacy vocabulary quarantine: canonical costing/production paths do not establish legacy cost authority', () => {
  const canonicalSources = [
    'domains/inventory/services/CostResolutionService.js',
    'domains/inventory/services/GoodsReceiptCostPostingService.js',
    'domains/inventory/services/InventoryProductionPostingService.js',
    'domains/inventory/services/InventorySalePostingService.js',
    'domains/production/services/ProductionService.js',
    'domains/costing/services/MenuCompositionCostService.js',
    'domains/costing/services/CostOfSalesService.js'
  ];

  for (const relativePath of canonicalSources) {
    const source = read(relativePath);
    assert.doesNotMatch(
      source,
      /\bcostPrice\b|\bcost_price\b|\bMenu HPP\b|\bProduct HPP\b|\bRecipe HPP\b|HPP item terjual/i,
      relativePath + ' must not use legacy costing vocabulary as runtime authority'
    );
  }

  const costingSource = read('domains/costing/services/MenuCompositionCostService.js');
  assert.match(costingSource, /ACTUAL_OUTPUT/);
  assert.match(costingSource, /THEORETICAL_RECIPE/);
  assert.match(costingSource, /MENU_COST_BASIS_REQUIRED/);

  const cogsSource = read('domains/costing/services/CostOfSalesService.js');
  assert.match(cogsSource, /product_stock_movements/);
  assert.doesNotMatch(cogsSource, /inventory_movements/);
});
