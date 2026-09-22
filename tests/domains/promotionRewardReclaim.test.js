/**
 * Promotion reward reclaim lifecycle — targeted verification.
 *
 * Business rule: the system knows whether a reward was consumed.
 * - A claim is CONSUMED only once the order reached ACCEPTED (confirmed).
 * - Failed/never-accepted orders (cancelled / rejected / timeout / refunded /
 *   expired / fulfillment_exception / reconciliation_pending, and pending itself)
 *   must NOT burn the first-order privilege, and their redemptions are released
 *   (voided) → reclaimable.
 * - Orders that reached ACCEPTED keep consuming it (acceptance is final).
 *
 * PRL-01  countCustomerOrders counts ONLY the consuming-status whitelist
 * PRL-02  first-order reward grantable when counts are zero (post-void state)
 * PRL-03  first-order reward blocked after a consuming order exists
 * PRL-04  reward blocked when active redemptions hit the per-customer max
 * PRL-05  voided redemptions do not count toward the max (reclaim allowed)
 * PRL-06  every non-consuming status (incl. pending/expired/fulfillment_exception) is excluded
 * PRL-07  OrderStateMachine releases the claim only for never-accepted orders
 * PRL-08  payment exceptions that bypass the state machine also release the claim
 * PRL-09  one canonical consuming-status contract is shared by every consumer
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PromotionRepository = require('../../core/data/repositories/PromotionRepository');
const InstallIncentiveStrategy = require('../../domains/promotion/strategies/InstallIncentiveStrategy');
const { CONSUMING_ORDER_STATUSES, isConsumingOrderStatus } = require('../../core/domain/OrderStatusContract');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

test('PRL-01: countCustomerOrders counts ONLY consuming statuses (whitelist contract)', () => {
  const da = captureDataAccess();
  const repo = new PromotionRepository(da);
  repo.countCustomerOrders({ customerPhone: '0812', brandId: 'brand-1' });
  assert.equal(da.calls.one.length, 1);
  const { sql, params } = da.calls.one[0];
  assert.ok(/status IN \(/.test(sql), 'must whitelist consuming statuses');
  assert.ok(!/NOT IN/i.test(sql), 'must not use a blacklist (it silently missed failure states)');
  assert.deepEqual(params, ['0812', 'brand-1', ...CONSUMING_ORDER_STATUSES],
    'the whitelist must come from the canonical consuming-status contract');
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

// ── Consumed only at ACCEPTED (locked rule) ──────────────────────────────────
// A claim is final only once the order reached ACCEPTED. Failure states that
// bypass the operational state machine (fulfillment_exception, expired,
// reconciliation_pending) must release the claim too.

test('PRL-06: non-consuming statuses never burn the first-order privilege (real DB)', () => {
  const db = require('../../server/database/db');

// Suites assert against demo branches/products/promotions, which are not auto-seeded.
require('../helpers/demoFixtures.js')();
  try { db.seedDemoData(db); } catch (_) {}
  const repo = new PromotionRepository(); // real DataAccess

  const PHONE = '081299900077';
  const BRAND = 'brand_bangjo';
  const BRANCH = 'branch_bangjo_barat';
  const NON_CONSUMING = ['pending', 'cancelled', 'rejected', 'timeout', 'refunded', 'expired', 'fulfillment_exception', 'reconciliation_pending'];
  const insert = (id, status) => db.prepare(`
    INSERT OR REPLACE INTO orders
      (id, order_number, brand_id, branch_id, customer_name, customer_phone, order_type, status, subtotal, grand_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'ORD-' + id, BRAND, BRANCH, 'Test', PHONE, 'pickup', status, 10000, 10000);

  for (const s of NON_CONSUMING) insert('ord_nc_' + s, s);
  assert.equal(repo.countCustomerOrders({ customerPhone: PHONE, brandId: BRAND }), 0,
    'no non-consuming status (incl. pending / fulfillment_exception / expired) may count');

  for (const s of CONSUMING_ORDER_STATUSES) insert('ord_c_' + s, s);
  assert.equal(repo.countCustomerOrders({ customerPhone: PHONE, brandId: BRAND }), CONSUMING_ORDER_STATUSES.length,
    'every accepted-and-beyond status counts as consuming');
});

test('PRL-07: OrderStateMachine releases the claim for never-accepted orders only', () => {
  const sm = read('server/services/OrderStateMachine.js');
  assert.ok(sm.includes('isConsumingOrderStatus(target_status)') && sm.includes('isConsumingOrderStatus(currentStatus)'),
    'state machine must guard on the consuming contract (target AND current)');
  assert.ok(sm.includes('(never accepted)'),
    'an order that already reached ACCEPTED must keep the claim (release only when never accepted)');
  assert.ok(sm.includes('OrderStatusContract'),
    'state machine must use the single canonical status contract');
});

test('PRL-08: payment exceptions that bypass the state machine also release the claim', () => {
  const gw = read('domains/payment/services/PaymentGatewayService.js');
  assert.ok(gw.includes('releaseClaimIfNeverAccepted'),
    'settlement-after-terminal + stock/promo race must release a never-accepted claim');
  assert.ok(/fulfillment_exception/.test(gw), 'fulfillment_exception remains the reconciliation status');
  assert.ok(gw.includes('OrderStatusContract'),
    'gateway must use the single canonical status contract');
});

test('PRL-09: one canonical consuming-status contract is shared by every consumer', () => {
  assert.ok(Array.isArray(CONSUMING_ORDER_STATUSES) && CONSUMING_ORDER_STATUSES.length > 0);
  assert.ok(CONSUMING_ORDER_STATUSES.includes('confirmed'), 'ACCEPTED is consuming');
  for (const s of ['pending', 'cancelled', 'rejected', 'timeout', 'refunded', 'expired', 'fulfillment_exception', 'reconciliation_pending']) {
    assert.equal(isConsumingOrderStatus(s), false, `${s} must never be consuming`);
  }
  assert.equal(isConsumingOrderStatus('confirmed'), true);
  assert.equal(isConsumingOrderStatus(null), false);

  for (const f of [
    'core/data/repositories/PromotionRepository.js',
    'server/services/OrderStateMachine.js',
    'domains/payment/services/PaymentGatewayService.js'
  ]) {
    assert.ok(read(f).includes('OrderStatusContract'), `${f} must import the canonical contract`);
  }
});
