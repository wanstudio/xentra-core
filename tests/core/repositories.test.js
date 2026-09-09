'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CatalogRepository = require('../../core/data/repositories/CatalogRepository');
const PromotionRepository = require('../../core/data/repositories/PromotionRepository');

function makeDataAccess(expected) {
  return {
    queryOne(sql, params) {
      expected.one.push({ sql, params });
      return expected.oneResult;
    },
    queryMany(sql, params) {
      expected.many.push({ sql, params });
      return expected.manyResult || [];
    },
    execute(sql, params) {
      expected.execute.push({ sql, params });
      return expected.executeResult || { changes: 1 };
    }
  };
}

test('CatalogRepository exposes semantic catalog operations instead of raw SQL to callers', () => {
  const calls = { one: [], many: [], execute: [], oneResult: { id: 'branch-1' } };
  const repo = new CatalogRepository(makeDataAccess(calls));

  assert.equal(repo.branchBelongsToBrand('branch-1', 'brand-1'), true);
  assert.equal(calls.one.length, 1);
  assert.deepEqual(calls.one[0].params, ['branch-1', 'brand-1']);

  calls.oneResult = { is_available: 1, name: 'Nasi Goreng', price: 25000, regular_price: 25000 };
  const reward = repo.findRewardProduct('branch-1', 'product-1');
  assert.equal(reward.name, 'Nasi Goreng');
});

test('PromotionRepository provides typed promotion and ledger operations', () => {
  const calls = { one: [], many: [], execute: [], manyResult: [{ id: 'promo-1' }], oneResult: { count: 2 } };
  const repo = new PromotionRepository(makeDataAccess(calls));

  assert.equal(repo.findActivePromotions('brand-1').length, 1);
  assert.equal(repo.countCustomerOrders({ customerPhone: '0812', brandId: 'brand-1' }), 2);
  repo.recordRedemption({
    redemptionId: 'rdm-1',
    promotionId: 'promo-1',
    orderId: 'order-1',
    brandId: 'brand-1',
    branchId: 'branch-1',
    customerPhone: '0812',
    benefitAmount: 25000
  });
  assert.equal(calls.execute.length, 1);
  assert.match(calls.execute[0].sql, /promotion_redemptions/);
});
