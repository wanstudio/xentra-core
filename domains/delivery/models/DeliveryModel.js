'use strict';

class DeliveryModel {
  static STATUS = {
    UNASSIGNED: 'unassigned',
    ASSIGNED: 'assigned',
    PICKED_UP: 'picked_up',
    ON_DELIVERY: 'on_delivery',
    DELIVERED: 'delivered',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  static PROVIDER_TYPES = {
    BRANCH_DRIVER: 'branch_driver',
    XENTRA_DRIVER: 'xentra_driver',
    EXTERNAL_API: 'external_api'
  };

  /**
   * Validates if status is valid.
   * 
   * @param {string} status
   * @returns {boolean}
   */
  static isValidStatus(status) {
    return Object.values(this.STATUS).includes(status);
  }
}

module.exports = DeliveryModel;
