'use strict';

/**
 * Xentra Fulfillment Environment Service
 *
 * Canonical backend boundary for purchase-type-specific operational transition
 * compatibility. It does not own HTTP authorization; routes/auth middleware and
 * actor-specific services remain responsible for who may perform an action.
 *
 * One Commerce Order remains canonical. This service prevents the universal
 * OrderStateMachine from accidentally applying transitions that do not belong
 * to the order's fulfillment environment.
 */

const ENVIRONMENTS = Object.freeze({
  delivery: Object.freeze({
    phases: Object.freeze(['accepted', 'preparing', 'ready', 'delivering', 'completed']),
    transitions: Object.freeze({
      pending: Object.freeze(['confirmed', 'cancelled', 'rejected', 'timeout']),
      confirmed: Object.freeze(['preparing', 'cancelled']),
      preparing: Object.freeze(['ready', 'cancelled']),
      ready: Object.freeze(['out_for_delivery', 'cancelled']),
      out_for_delivery: Object.freeze(['completed', 'cancelled']),
      completed: Object.freeze([])
    })
  }),
  pickup: Object.freeze({
    phases: Object.freeze(['accepted', 'preparing', 'ready', 'completed']),
    transitions: Object.freeze({
      pending: Object.freeze(['confirmed', 'cancelled', 'rejected', 'timeout']),
      confirmed: Object.freeze(['preparing', 'cancelled']),
      preparing: Object.freeze(['ready', 'cancelled']),
      ready: Object.freeze(['completed', 'cancelled']),
      completed: Object.freeze([])
    })
  }),
  dine_in: Object.freeze({
    phases: Object.freeze(['accepted', 'preparing', 'ready', 'completed']),
    transitions: Object.freeze({
      pending: Object.freeze(['confirmed', 'cancelled', 'rejected', 'timeout']),
      confirmed: Object.freeze(['preparing', 'cancelled']),
      preparing: Object.freeze(['ready', 'cancelled']),
      ready: Object.freeze(['completed', 'cancelled']),
      completed: Object.freeze([])
    })
  }),
  reservation: Object.freeze({
    phases: Object.freeze(['created', 'confirmed', 'arrival']),
    transitions: Object.freeze({
      pending: Object.freeze(['confirmed', 'cancelled', 'rejected', 'timeout']),
      confirmed: Object.freeze(['cancelled']),
      active_table: Object.freeze([])
    })
  })
});

const TERMINAL_OR_EXCEPTION = Object.freeze([
  'cancelled',
  'rejected',
  'timeout',
  'refunded',
  'expired',
  'fulfillment_exception',
  'reconciliation_pending',
  'orphan'
]);

function normalizeType(type) {
  const value = String(type || '').trim().toLowerCase();
  return value === 'dinein' ? 'dine_in' : value;
}

function getEnvironment(type) {
  const normalized = normalizeType(type);
  return ENVIRONMENTS[normalized] || null;
}

function canTransition(orderType, currentStatus, targetStatus) {
  const env = getEnvironment(orderType);
  if (!env) return false;
  const from = String(currentStatus || '');
  const to = String(targetStatus || '');
  const allowed = env.transitions[from] || [];
  return allowed.includes(to);
}

function assertTransition(orderType, currentStatus, targetStatus) {
  if (!canTransition(orderType, currentStatus, targetStatus)) {
    const type = normalizeType(orderType) || 'unknown';
    throw new Error(
      '[FULFILLMENT_ENVIRONMENT_TRANSITION_REJECTED] ' +
      type + ': perubahan status tidak sesuai environment dari "' +
      currentStatus + '" ke "' + targetStatus + '".'
    );
  }
  return true;
}

function isTerminalStatus(status) {
  return TERMINAL_OR_EXCEPTION.includes(String(status || ''));
}

module.exports = {
  ENVIRONMENTS,
  TERMINAL_OR_EXCEPTION,
  normalizeType,
  getEnvironment,
  canTransition,
  assertTransition,
  isTerminalStatus
};