'use strict';

/**
 * Canonical Order status contract — SINGLE SOURCE OF TRUTH.
 *
 * "Consuming" means the order actually went through: the branch ACCEPTED it
 * (confirmed) and it was never terminally failed. Per the locked promotion
 * rule, a reward/claim is only CONSUMED once its order reaches this phase;
 * a pending or failed order must release the claim so the customer can claim
 * it again.
 *
 * Non-consuming statuses (pending, cancelled, rejected, timeout, refunded,
 * expired, fulfillment_exception, reconciliation_pending, orphan, ...) never
 * consume a claim — including states that bypass the operational state machine
 * (e.g. payment reconciliation / stock-race exceptions).
 *
 * Every consumer of "did this order consume the reward?" must use this list so
 * the void logic and the eligibility counters can never drift apart again.
 */
const CONSUMING_ORDER_STATUSES = Object.freeze([
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed'
]);

function isConsumingOrderStatus(status) {
  return CONSUMING_ORDER_STATUSES.includes(String(status || ''));
}

module.exports = { CONSUMING_ORDER_STATUSES, isConsumingOrderStatus };
