'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/database/db');
const { UomConversionService } = require('../../domains/uom');
const MaterialService = require('../../domains/material/services/MaterialService');

test.before(async () => {
  await db.readyPromise;
});

test('UOM master is seeded with reference UOMs and conversion factors', () => {
  const mass = db.prepare('SELECT reference_uom_id FROM uom_categories WHERE code = ?').get('MASS');
  const kg = db.prepare('SELECT conversion_factor, allows_fraction, quantity_precision FROM uoms WHERE code = ?').get('kg');
  const g = db.prepare('SELECT conversion_factor FROM uoms WHERE code = ?').get('g');

  assert.equal(mass.reference_uom_id, 'uom_kg');
  assert.equal(Number(kg.conversion_factor), 1);
  assert.equal(Number(kg.allows_fraction), 1);
  assert.equal(Number(kg.quantity_precision), 6);
  assert.equal(Number(g.conversion_factor), 0.001);
});

test('UOM conversion normalizes 5,000 g to 5 kg and rounds once at the target boundary', () => {
  const result = UomConversionService.convertQuantity({
    quantity: 5000,
    sourceUomId: 'uom_g',
    targetUomId: 'uom_kg'
  });

  assert.equal(result.target_quantity, 5);
  assert.equal(result.rounding_mode, 'HALF_UP');
  assert.equal(result.target_precision, 6);
});

test('UOM conversion rejects cross-category conversion and fractional whole-unit quantity', () => {
  assert.throws(
    () => UomConversionService.convertQuantity({
      quantity: 1,
      sourceUomId: 'uom_kg',
      targetUomId: 'uom_l'
    }),
    error => error && error.code === 'UOM_CATEGORY_MISMATCH'
  );

  assert.throws(
    () => UomConversionService.convertQuantity({
      quantity: 1,
      sourceUomId: 'uom_pcs',
      targetUomId: 'uom_dozen'
    }),
    error => error && error.code === 'UOM_FRACTION_NOT_ALLOWED'
  );
});

test('UOM conversion uses target precision for HALF_UP posting rounding', () => {
  const result = UomConversionService.convertQuantity({
    quantity: 1.2345,
    sourceUomId: 'uom_kg',
    targetUomId: 'uom_kg'
  });

  assert.equal(result.target_quantity, 1.2345);
  assert.equal(result.target_precision, 6);
});

test('Material Service creates Organization-scoped Material with canonical Base Stock UOM', () => {
  const org = 'org_material_service_test';
  db.prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)').run(
    org, 'Material Service Test Org', 'material-service-test-org'
  );

  const material = MaterialService.createMaterial({
    organizationId: org,
    materialCode: 'RICE-001',
    name: 'Rice Premium',
    baseUomId: 'uom_kg',
    status: 'ACTIVE'
  });

  assert.equal(material.organization_id, org);
  assert.equal(material.material_code, 'RICE-001');
  assert.equal(material.base_uom_id, 'uom_kg');
  assert.equal(material.status, 'ACTIVE');

  assert.throws(
    () => MaterialService.createMaterial({
      organizationId: org,
      materialCode: 'RICE-001',
      name: 'Duplicate Rice',
      baseUomId: 'uom_kg'
    }),
    error => error && error.code === 'MATERIAL_CODE_ALREADY_EXISTS'
  );

  db.prepare('DELETE FROM materials WHERE id = ?').run(material.id);
  db.prepare('DELETE FROM organizations WHERE id = ?').run(org);
});
