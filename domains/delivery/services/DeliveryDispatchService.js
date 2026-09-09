'use strict';

const { events } = require('../../../core');
const { OrderRepository } = require('../../../core/data/repositories');
const DeliveryModel = require('../models/DeliveryModel');
const BranchDriverProvider = require('../providers/BranchDriverProvider');

const orderRepository = new OrderRepository();

class DeliveryDispatchService {
  /**
   * Assigns a delivery provider/driver to an order.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} [params.provider_type='branch_driver']
   * @param {string} params.driver_name
   * @param {string} params.driver_phone
   * @param {string} [params.assigned_by]
   * @returns {Object}
   */
  static assign({
    order_id,
    provider_type = DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
    driver_name,
    driver_phone,
    assigned_by = null
  }) {
    if (provider_type === DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER) {
      return BranchDriverProvider.assignDriver({
        order_id,
        driver_name,
        driver_phone,
        assigned_by
      });
    }

    throw new Error(`[DeliveryDispatchService] Provider type "${provider_type}" belum didukung pada MVP.`);
  }

  /**
   * Updates delivery fulfillment lifecycle status.
   * 
   * @param {Object} params
   * @param {string} params.order_id
   * @param {string} params.status - 'assigned' | 'picked_up' | 'on_delivery' | 'delivered' | 'failed'
   * @param {string} [params.notes]
   * @returns {Object}
   */
  static updateStatus({ order_id, status, notes = '' }) {
    if (!DeliveryModel.isValidStatus(status)) {
      throw new Error(`[DeliveryDispatchService] Delivery status "${status}" tidak valid.`);
    }

    const order = orderRepository.findById(order_id);
    if (!order) {
      throw new Error(`[DeliveryDispatchService] Order "${order_id}" tidak ditemukan.`);
    }

    const now = new Date().toISOString();

    orderRepository.updateDeliveryStatus({
      orderId: order_id,
      status,
      updatedAt: now
    });

    // If delivered, advance order status
    if (status === DeliveryModel.STATUS.DELIVERED) {
      orderRepository.markDelivered({
        orderId: order_id,
        updatedAt: now
      });

      events.EventBus.publish({
        type: 'delivery.completed',
        producer: 'delivery',
        payload: {
          order_id,
          order_number: order.order_number,
          branch_id: order.branch_id,
          completed_at: now
        }
      }).catch(() => {});
    }

    return {
      success: true,
      order_id,
      status,
      updated_at: now
    };
  }

  /**
   * Retrieves delivery details for an order.
   * 
   * @param {string} order_id
   * @returns {Object}
   */
  static getDelivery(order_id) {
    return orderRepository.findDeliveryByOrderId(order_id);
  }
}

module.exports = DeliveryDispatchService;
