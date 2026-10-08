'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const MaterialRepository = require('../../core/data/repositories/MaterialRepository');
const UomRepository = require('../../core/data/repositories/UomRepository');

const materials = new MaterialRepository();
const uoms = new UomRepository();

const ORG = 'org_material_schema_test';
const BRAND = 'brand_material_schema_test';
const BRANCH = 'branch_material_schema_test';
const LOCATION = 'location_material_schema_test';
const MATERIAL = 'material_material_schema_test';

test.before(async () => {
  await db.readyPromise;
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    ORG, 'Material Schema Test Org', 'material-schema-test-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    BRAND, ORG, 'Material Schema Test Brand', 'material-schema-test-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(BRANCH, BRAND, 'Material Schema Branch', 'material-schema-branch', 'Test', 0, 0);
  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(LOCATION, ORG, BRANCH, 'MAT-SCHEMA', 'Material Location', 'BRANCH');
  db.prepare(
    'INSERT OR IGNORE INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(MATERIAL, ORG, 'MAT-001', 'Test Material', 'uom_kg', 'ACTIVE');
});

test.after(() => {
  db.prepare('DELETE FROM material_stock_movements WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM material_stock_balances WHERE stock_location_id = ?').run(LOCATION);
  db.prepare('DELETE FROM materials WHERE id = ?').run(MATERIAL);
  db.prepare('DELETE FROM stock_locations WHERE id = ?').run(LOCATION);
  db.prepare('DELETE FROM branches WHERE id = ?').run(BRANCH);
  db.prepare('DELETE FROM brands WHERE id = ?').run(BRAND);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(ORG);
});

test('Material requires a valid active Base Stock UOM', () => {
  assert.throws(
    () => db.prepare(
      'INSERT INTO materials (id, organization_id, material_code, name, base_uom_id, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('material-bad-uom', ORG, 'MAT-BAD', 'Bad', 'not-a-uom', 'ACTIVE'),
    /MATERIAL_BASE_UOM_INVALID/
  );

  assert.equal(uoms.findById('uom_kg').code, 'kg');
  assert.equal(materials.findById(MATERIAL).base_uom_id, 'uom_kg');
});

test('Material Base Stock UOM cannot be changed after canonical stock exists', () => {
  db.prepare(
    'INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 1, 10000, 10000, ?, 0)'
  ).run(LOCATION, MATERIAL, 'AVAILABLE');

  assert.throws(
    () => db.prepare('UPDATE materials SET base_uom_id = ? WHERE id = ?').run('uom_g', MATERIAL),
    /MATERIAL_BASE_UOM_CHANGE_REQUIRES_MIGRATION/
  );
});

test('Material and Stock Location remain Organization-scoped', () => {
  const otherOrg = 'org_material_schema_other';
  const otherBrand = 'brand_material_schema_other';
  const otherBranch = 'branch_material_schema_other';
  const otherLocation = 'location_material_schema_other';

  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    otherOrg, 'Other Org', 'other-material-schema-org'
  );
  db.prepare('INSERT OR IGNORE INTO brands (id, organization_id, name, slug) VALUES (?, ?, ?, ?)').run(
    otherBrand, otherOrg, 'Other Brand', 'other-material-schema-brand'
  );
  db.prepare(
    'INSERT OR IGNORE INTO branches (id, brand_id, name, slug, address_text, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(otherBranch, otherBrand, 'Other Branch', 'other-material-schema-branch', 'Test', 0, 0);
  db.prepare(
    'INSERT OR IGNORE INTO stock_locations (id, organization_id, branch_id, code, name, location_type, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).run(otherLocation, otherOrg, otherBranch, 'OTHER-MAT', 'Other Location', 'BRANCH');

  assert.throws(
    () => db.prepare(
      'INSERT INTO material_stock_balances (stock_location_id, material_id, quantity_base, carrying_value, moving_average_unit_cost, cost_availability_status, valuation_version) VALUES (?, ?, 1, 10000, 10000, ?, 0)'
    ).run(otherLocation, MATERIAL, 'AVAILABLE'),
    /MATERIAL_STOCK_LOCATION_SCOPE_INVALID/
  );

  db.prepare('DELETE FROM stock_locations WHERE id = ?').run(otherLocation);
  db.prepare('DELETE FROM branches WHERE id = ?').run(otherBranch);
  db.prepare('DELETE FROM brands WHERE id = ?').run(otherBrand);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(otherOrg);
});
