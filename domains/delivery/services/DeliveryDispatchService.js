'use strict';

const { events } = require('../../../core');
const { OrderRepository } = require('../../../core/data/repositories');
const OrderStateMachine = require('../../../server/services/OrderStateMachine');
const DeliveryModel = require('../models/DeliveryModel');
const BranchDriverProvider = require('../providers/BranchDriverProvider');

const orderRepository = new OrderRepository();

const DELIVERY_TRANSITIONS = Object.freeze({
  unassigned: Object.freeze(['assigned']),
  assigned: Object.freeze(['picked_up', 'failed', 'cancelled']),
  picked_up: Object.freeze(['on_delivery', 'failed', 'cancelled']),
  on_delivery: Object.freeze(['delivered', 'failed', 'cancelled']),
  delivered: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

class DeliveryDispatchService {
  static canTransition(currentStatus, targetStatus) {
    const allowed = DELIVERY_TRANSITIONS[String(currentStatus || '')] || [];
    return allowed.includes(String(targetStatus || ''));
  }

  /**
   * Assigns a delivery provider/driver to an order.
   *
   * Branch Manager owns assignment. Driver-owned execution begins after the
   * delivery job is assigned.
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

    throw new Error('[DeliveryDispatchService] Provider type "' + provider_type + '" belum didukung pada MVP.');
  }

  /**
   * Updates the Delivery Job lifecycle.
   *
   * Delivery 'delivered' is never written into orders.status; the canonical
   * Order becomes 'completed' only after the Delivery Job reaches delivered.
   * Driver execution: assigned -> picked_up -> on_delivery -> delivered.
   */
  static updateStatus({ order_id, status, notes = '', actor_id = null }) {
    if (!DeliveryModel.isValidStatus(status)) {
      throw new Error('[DeliveryDispatchService] Delivery status "' + status + '" tidak valid.');
    }

    const order = orderRepository.findById(order_id);
    if (!order) {
      throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    }

    if (order.order_type !== 'delivery') {
      throw new Error('[DeliveryDispatchService] Order "' + order_id + '" bukan Fulfillment Environment delivery.');
    }

    const currentDelivery = orderRepository.findDeliveryByOrderId(order_id);
    const currentDeliveryStatus = currentDelivery ? String(currentDelivery.status || 'unassigned') : 'unassigned';

    if (currentDeliveryStatus === status) {
      return {
        success: true,
        order_id,
        status,
        updated_at: currentDelivery && currentDelivery.updated_at ? currentDelivery.updated_at : new Date().toISOString(),
        idempotent: true
      };
    }

    if (!this.canTransition(currentDeliveryStatus, status)) {
      throw new Error(
        '[DeliveryDispatchService] Perubahan Delivery Job tidak valid: dari "' +
        currentDeliveryStatus + '" ke "' + status + '".'
      );
    }

    const now = new Date().toISOString();

    orderRepository.beginTransaction();
    try {
      const latestOrder = orderRepository.findById(order_id);
      if (!latestOrder) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');

      if (status === DeliveryModel.STATUS.ON_DELIVERY) {
        if (latestOrder.status !== 'ready') {
          throw new Error(
            '[DeliveryDispatchService] Driver hanya dapat memulai pengantaran setelah pesanan berstatus ready.'
          );
        }

        orderRepository.updateDeliveryStatus({
          orderId: order_id,
          status,
          updatedAt: now
        });

        OrderStateMachine.transition({
          order_id,
          target_status: 'out_for_delivery',
          actor_type: 'driver',
          actor_id,
          note: notes || 'Driver memulai pengantaran'
        }, { dbTransactionProvided: true });
      } else if (status === DeliveryModel.STATUS.DELIVERED) {
        if (latestOrder.status !== 'out_for_delivery') {
          throw new Error(
            '[DeliveryDispatchService] Delivery hanya dapat diselesaikan setelah status pengantaran dimulai.'
          );
        }

        orderRepository.updateDeliveryStatus({
          orderId: order_id,
          status,
          updatedAt: now
        });

        OrderStateMachine.transition({
          order_id,
          target_status: 'completed',
          actor_type: 'driver',
          actor_id,
          note: notes || 'Driver menyelesaikan pengantaran'
        }, { dbTransactionProvided: true });
      } else {
        orderRepository.updateDeliveryStatus({
          orderId: order_id,
          status,
          updatedAt: now
        });
      }

      orderRepository.commitTransaction();
    } catch (err) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    if (status === DeliveryModel.STATUS.DELIVERED) {
      events.EventBus.publish({
        type: 'delivery.completed',
        producer: 'delivery',
        payload: {
          order_id,
          order_number: order.order_number,
          branch_id: order.branch_id,
          completed_at: now,
          actor_id
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

  static getDelivery(order_id) {
    return orderRepository.findDeliveryByOrderId(order_id);
  }
}

module.exports = DeliveryDispatchService;
