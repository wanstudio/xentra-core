'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const merchantApp = fs.readFileSync(
  path.join(ROOT, 'apps/merchant-app/assets/js/branch-catalog-ui.js'),
  'utf8'
);
const ownerDashboard = fs.readFileSync(
  path.join(ROOT, 'apps/merchant-dashboard/assets/js/branch-catalog-ui.js'),
  'utf8'
);
const catalogClient = fs.readFileSync(
  path.join(ROOT, 'apps/merchant-shared/js/catalog-client.js'),
  'utf8'
);

test('Forward Branch Catalog UI is Menu-only and does not call legacy Product override writes', () => {
  for (const source of [merchantApp, ownerDashboard]) {
    assert.ok(!source.includes('CatalogClient.updateBranchProductOverride'),
      'forward Branch Catalog UI must not call the legacy Product override endpoint');
    assert.ok(!source.includes('CatalogClient.adoptProduct'),
      'forward Branch Catalog UI must not use Product-centric adoption');
    assert.ok(source.includes('CatalogClient.setBranchMenuAvailability'),
      'forward Branch Catalog UI must use canonical Menu availability');
    assert.ok(source.includes('CatalogClient.removeBranchMenu'),
      'forward Branch Catalog UI must use canonical Menu removal');
    assert.ok(source.includes('CatalogClient.adoptMenu'),
      'forward Branch Catalog UI must use canonical Menu adoption');
  }
});

test('Merchant App inline Menu actions pass menu_id, never component product_id', () => {
  assert.match(
    merchantApp,
    /toggleBranchMenuAvailability\([^)]*p\.menu_id/,
    'availability toggle must receive the Menu ID'
  );
  assert.match(
    merchantApp,
    /removeBranchMenu\([^)]*p\.menu_id/,
    'remove action must receive the Menu ID'
  );
  assert.doesNotMatch(
    merchantApp,
    /toggleBranchMenuAvailability\(\\'\s*\+\s*p\.product_id/,
    'availability must not receive Product ID'
  );
  assert.doesNotMatch(
    merchantApp,
    /removeBranchMenu\(\\'\s*\+\s*p\.product_id/,
    'remove must not receive Product ID'
  );
});

test('Owner Branch Menu removal confirmation uses the declared Menu name variable', () => {
  const start = ownerDashboard.indexOf('window.removeBranchMenu = async function');
  const end = ownerDashboard.indexOf('Legacy Product Override editor is intentionally removed', start);
  assert.ok(start >= 0 && end > start, 'canonical remove handler must exist');
  const handler = ownerDashboard.slice(start, end);
  assert.ok(handler.includes('menuName = menuName ||'));
  assert.ok(handler.includes(' + menuName + '));
  assert.ok(!handler.includes('productName'));
});

test('Legacy Product transport remains available only as an explicit compatibility adapter', () => {
  assert.ok(catalogClient.includes('function updateBranchProductOverride('));
  assert.ok(catalogClient.includes('Legacy Product transport aliases'));
  assert.ok(catalogClient.includes('Forward Merchant Menu code must use the Menu methods above'));
});
