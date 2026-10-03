'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LegacyDataReadinessService,
  STATUS
} = require('../domains/catalog/services/LegacyDataReadinessService');

function fakeDataAccess(responses) {
  const calls = [];
  return {
    calls,
    queryMany(sql, params) {
      calls.push({ method: 'queryMany', sql, params });
      const next = responses.shift();
      if (!next || next.method !== 'queryMany') throw new Error('UNEXPECTED_QUERY_MANY');
      return next.value;
    },
    queryOne(sql, params) {
      calls.push({ method: 'queryOne', sql, params });
      const next = responses.shift();
      if (!next || next.method !== 'queryOne') throw new Error('UNEXPECTED_QUERY_ONE');
      return next.value;
    }
  };
}

test('Legacy readiness inventory is read-only and classifies unresolved mappings', () => {
  const db = fakeDataAccess([
    {
      method: 'queryMany',
      value: [
        { status: 'legacy', schema_version: 1, count: 3 },
        { status: 'migrated', schema_version: 2, count: 2 }
      ]
    },
    {
      method: 'queryOne',
      value: {
        total_products: 5,
        products_with_canonical_menu: 2,
        products_without_canonical_menu: 3,
        canonical_menu_count: 2
      }
    },
    {
      method: 'queryMany',
      value: [
        {
          promotion_id: 'promo-legacy',
          promotion_name: 'Legacy Promo',
          target_product_id: '401',
          canonical_menu_candidates: 2
        },
        {
          promotion_id: 'promo-ready',
          promotion_name: 'Migratable Promo',
          target_product_id: '402',
          canonical_menu_candidates: 1
        }
      ]
    },
    {
      method: 'queryMany',
      value: [
        {
          branch_id: 'branch-1',
          branch_name: 'Cabang 1',
          product_id: '401',
          product_name: 'Nasi Goreng',
          canonical_menu_candidates: 0
        },
        {
          branch_id: 'branch-1',
          branch_name: 'Cabang 1',
          product_id: '402',
          product_name: 'Mie Goreng',
          canonical_menu_candidates: 1
        }
      ]
    },
    {
      method: 'queryOne',
      value: { total_legacy_branch_products: 4 }
    },
    {
      method: 'queryOne',
      value: { count: 6 }
    },
    {
      method: 'queryMany',
      value: []
    }
  ]);

  const report = LegacyDataReadinessService.inspect({
    brandId: 'brand-1',
    includeRows: true,
    dataAccess: db
  });

  assert.equal(report.status, STATUS.NEEDS_REVIEW);
  assert.equal(report.products.total, 5);
  assert.equal(report.products.with_canonical_menu, 2);
  assert.equal(report.products.without_canonical_menu, 3);
  assert.equal(report.promotions.legacy_product_target_count, 2);
  assert.equal(report.promotions.unresolved_or_ambiguous_count, 1);
  assert.equal(report.branches.legacy_branch_product_count, 4);
  assert.equal(report.branches.unresolved_or_ambiguous_branch_product_count, 1);
  assert.equal(report.branches.legacy_branch_product_category_count, 6);
  assert.equal(report.retirement.compatibility_data_present, true);
  assert.equal(report.retirement.safe_to_retire_legacy_data, false);
  assert.equal(report.unresolved.promotions.length, 1);
  assert.equal(report.unresolved.branch_products.length, 1);

  assert.ok(db.calls.length > 0);
  for (const call of db.calls) {
    assert.match(call.sql.trim(), /^SELECT/i, 'inventory must issue SELECT only');
    assert.notMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/i);
  }
});

test('Canonical-ready report permits retirement only when compatibility data is absent', () => {
  const db = fakeDataAccess([
    { method: 'queryMany', value: [{ status: 'verified', schema_version: 2, count: 4 }] },
    { method: 'queryOne', value: { total_products: 4, products_with_canonical_menu: 4, products_without_canonical_menu: 0, canonical_menu_count: 4 } },
    { method: 'queryMany', value: [] },
    { method: 'queryMany', value: [] },
    { method: 'queryOne', value: { total_legacy_branch_products: 0 } },
    { method: 'queryOne', value: { count: 0 } },
    { method: 'queryMany', value: [] }
  ]);

  const report = LegacyDataReadinessService.inspect({ dataAccess: db });

  assert.equal(report.status, STATUS.CANONICAL_READY);
  assert.equal(report.retirement.compatibility_data_present, false);
  assert.equal(report.retirement.safe_to_retire_legacy_data, true);
});