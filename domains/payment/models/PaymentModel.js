'use strict';

class PaymentModel {
  static STATUSES = {
    PENDING: 'pending',
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
