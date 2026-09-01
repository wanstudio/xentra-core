'use strict';

class PaymentModel {
  static STATUSES = {
    PENDING: 'pending',
    RECONCILIATION_PENDING: 'reconciliation_pending',
    SETTLEMENT: 'settlement',
    CHALLENGE: 'challenge',
    DENY: 'deny',
    CANCEL: 'cancel',
    EXPIRE: 'expire',
    REFUNDED: 'refunded'
  };

  static METHODS = {
    CASH: 'cash',
    MIDTRANS: 'midtrans'
  };

  /**
   * Authoritative Payment State Machine Transitions
   * Terminal states (deny, expire, refunded) cannot transition to new states.
   */
  static VALID_TRANSITIONS = {
    pending: ['settlement', 'challenge', 'cancel', 'deny', 'expire', 'reconciliation_pending'],
    reconciliation_pending: ['settlement', 'challenge', 'cancel', 'deny', 'expire'],
    challenge: ['settlement', 'cancel', 'deny', 'expire'],
    settlement: ['refunded'],
    cancel: [],
    deny: [],
    expire: [],
    refunded: []
  };

  /**
   * Checks if a transition from currentStatus to targetStatus is valid.
   * 
   * @param {string} currentStatus
   * @param {string} targetStatus
   * @returns {boolean}
   */
  static canTransition(currentStatus, targetStatus) {
    const allowed = this.VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(targetStatus);
  }

  /**
   * Validates payment creation parameters.
   * 
   * @param {Object} params
   * @returns {{ is_valid: boolean, errors: Array<string> }}
   */
  static validatePaymentParams(params) {
    const errors = [];
    if (!params.order_id) errors.push('"order_id" is required.');
    if (!params.amount || Number(params.amount) <= 0) errors.push('"amount" must be greater than 0.');
    if (!params.provider || !['cash', 'midtrans'].includes(params.provider)) {
      errors.push('"provider" must be either "cash" or "midtrans".');
    }

    return {
      is_valid: errors.length === 0,
      errors
    };
  }
}

module.exports = PaymentModel;
