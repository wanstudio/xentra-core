'use strict';

const db = require('../../../server/database/db');
const { events } = require('../../../core');
const DeliveryModel = require('../models/DeliveryModel');

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

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (!order) {
      throw new Error(`[BranchDriverProvider] Order "${order_id}" tidak ditemukan.`);
    }

    const now = new Date().toISOString();

    const existingDelivery = db.prepare('SELECT id FROM order_deliveries WHERE order_id = ?').get(order_id);
    if (existingDelivery) {
      db.prepare(`
        UPDATE order_deliveries
        SET driver_name = ?,
            driver_phone = ?,
            status = 'assigned',
            updated_at = ?
        WHERE order_id = ?
      `).run(driver_name.trim(), driver_phone.trim(), now, order_id);
    } else {
      const deliveryId = `del_${Date.now()}`;
      db.prepare(`
        INSERT INTO order_deliveries (
          id, order_id, driver_name, driver_phone, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'assigned', ?, ?)
      `).run(deliveryId, order_id, driver_name.trim(), driver_phone.trim(), now, now);
    }

    // Emit event: delivery.driver.assigned
    events.EventBus.publish({
      type: 'delivery.driver.assigned',
      producer: 'delivery',
      payload: {
        order_id,
        order_number: order.order_number,
        branch_id: order.branch_id,
        provider_type: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
        driver_name,
        driver_phone,
        assigned_by
      }
    }).catch(() => {});

    return {
      success: true,
      provider: DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
      order_id,
      driver_name,
      driver_phone,
      status: 'assigned'
    };
  }
}

module.exports = BranchDriverProvider;
