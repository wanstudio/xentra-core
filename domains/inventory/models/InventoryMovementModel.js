'use strict';

class InventoryMovementModel {
  static MOVEMENT_TYPES = {
    PURCHASE_IN: 'purchase_in',
    TRANSFER_IN: 'transfer_in',
    RETURN_IN: 'return_in',
    SALE_DEDUCTION: 'sale_deduction',
    TRANSFER_OUT: 'transfer_out',
    WASTE_SPOILAGE: 'waste_spoilage',
    AUDIT_ADJUSTMENT: 'audit_adjustment'
  };

  /**
   * Validates movement type string.
   * 
   * @param {string} type
   * @returns {boolean}
   */
  static isValidMovementType(type) {
    return Object.values(this.MOVEMENT_TYPES).includes(type);
  }
}

module.exports = InventoryMovementModel;
