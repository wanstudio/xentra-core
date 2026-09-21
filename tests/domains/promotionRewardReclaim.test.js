/**
 * Promotion reward reclaim lifecycle — targeted verification.
 *
 * Business rule: the system knows whether a reward was consumed.
 * - Failed orders (cancelled / rejected / timeout / refunded) must NOT burn
 *   the first-order privilege and their redemptions are voided → reclaimable.
 * - Orders past cancellation (accepted and beyond) keep consuming it.
 *
 * PRL-01  countCustomerOrders excludes all non-consuming terminal states
 * PRL-02  first-order reward grantable when counts are zero (post-void state)
 * PRL-03  first-order reward blocked after a consuming order exists
 * PRL-04  reward blocked when active redemptions hit the per-customer max
 * PRL-05  voided redemptions do not count toward the max (reclaim allowed)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const PromotionRepository = require('../../core/data/repositories/PromotionRepository');
const InstallIncentiveStrategy = require('../../domains/promotion/strategies/InstallIncentiveStrategy');

function captureDataAccess() {
  const calls = { one: [], oneResult: { count: 0 } };
  return {
    calls,
    queryOne(sql, params) { calls.one.push({ sql, params }); return calls.oneResult; },
    queryMany() { return []; },
    execute() { return { changes: 1 }; }
  };
}

function firstOrderPromo() {
  return {
    id: 'prm-welcome',
    is_active: 1,
    capability_type: 'install_incentive',
    max_redemptions_per_customer: 1,
    rules: [{ rule_type: 'eligibility', rule_payload: JSON.stringify({ requires_pwa_installed: true, first_order_only: true }) }],
    rewards: [{ target_product_id: 'prod-gift', amount_in_cents: 0, presentation_payload: {} }]
  };
}

function evalCtx(overrides = {}) {
  return Object.assign({
    customer_redemptions_count: 0,
    customer_orders_count: 0,
    customer_phone: '08123456789',
    is_pwa_installed: true
  }, overrides);
}

test('PRL-01: countCustomerOrders excludes all non-consuming terminal states', () => {
  const da = captureDataAccess();
  const repo = new PromotionRepository(da);
  repo.countCustomerOrders({ customerPhone: '0812', brandId: 'brand-1' });
  assert.equal(da.calls.one.length, 1);
  const sql = da.calls.one[0].sql;
  for (const s of ['cancelled', 'rejected', 'timeout', 'refunded']) {
    assert.ok(sql.includes(`'${s}'`), `SQL must exclude '${s}'`);
  }
  assert.deepEqual(da.calls.one[0].params, ['0812', 'brand-1']);
});

test('PRL-02: first-order reward grantable when counts are zero (post-void state)', () => {
  const strategy = new InstallIncentiveStrategy();
  const res = strategy.evaluate(firstOrderPromo(), evalCtx());
  assert.equal(res.isEligible, true);
  assert.equal(res.should_grant_reward, true);
});

test('PRL-03: first-order reward blocked after a consuming order exists', () => {
  const strategy = new InstallIncentiveStrategy();
  const res = strategy.evaluate(firstOrderPromo(), evalCtx({ customer_orders_count: 1 }));
  assert.equal(res.isEligible, false);
  assert.match(res.reason, /first-time orders only/);
});

test('PRL-04: reward blocked when active redemptions hit the per-customer max', () => {
  const strategy = new InstallIncentiveStrategy();
  const res = strategy.evaluate(firstOrderPromo(), evalCtx({ customer_redemptions_count: 1 }));
  assert.equal(res.isEligible, false);
  assert.match(res.reason, /maximum redemption limit/);
});

test('PRL-05: voided redemptions do not count (count query only sees active)', () => {
  const da = captureDataAccess();
  const repo = new PromotionRepository(da);
  repo.countCustomerRedemptions({ promotionId: 'prm-welcome', customerPhone: '0812' });
  const sql = da.calls.one[0].sql;
  assert.ok(sql.includes("status = 'active'"), 'redemption count must only see active rows');
});
