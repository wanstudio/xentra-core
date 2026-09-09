'use strict';

const { events } = require('../../../core');
const { OrderRepository } = require('../../../core/data/repositories');
const DeliveryModel = require('../models/DeliveryModel');

const orderRepository = new OrderRepository();

class BranchDriverProvider {
  /**
   * MVP Provider: Dispatches order to an internal branch driver.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} params.driver_name
   * @param {string} params.driver_phone
   * @param {string} [params.assigned_by]
   * @returns {Object} Dispatch assignment result
   */
  static assignDriver({ order_id, driver_name, driver_phone, assigned_by = null }) {
    if (!order_id || !driver_name || !driver_phone) {
      throw new Error('[BranchDriverProvider] "order_id", "driver_name", and "driver_phone" are required.');
    }

    const order = orderRepository.findById(order_id);
    if (!order) {
      throw new Error(`[BranchDriverProvider] Order "${order_id}" tidak ditemukan.`);
    }

    const now = new Date().toISOString();
    const normalizedDriverName = driver_name.trim();
    const normalizedDriverPhone = driver_phone.trim();

    orderRepository.insertOrUpdateDeliveryAssignment({
      orderId: order_id,
      driverName: normalizedDriverName,
      driverPhone: normalizedDriverPhone,
      updatedAt: now
    });

    events.EventBus.publish({
      type: 'delivery.driver.assigned',
      producer: 'delivery',
      payload: {
        order_id,
        order_number: order.order_number,
        branch_id: order.branch_id,
        provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
        driver_name: normalizedDriverName,
        driver_phone: normalizedDriverPhone,
        assigned_by
      }
    }).catch(() => {});

    return {
      success: true,
      provider: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
      order_id,
      driver_name: normalizedDriverName,
      driver_phone: normalizedDriverPhone,
      status: 'assigned'
    };
  }
}

module.exports = BranchDriverProvider;
