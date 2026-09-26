'use strict';

/**
 * Persistence boundary for POS payment groups.
 *
 * A payment group combines multiple existing Commerce Orders for settlement
 * without merging, moving, or replacing those Orders.
 */
const DataAccess = require('../DataAccess');

class PosPaymentGroupRepository {
  constructor(dataAccess = DataAccess) { this.db = dataAccess; }

  beginTransaction() { return this.db.exec('BEGIN IMMEDIATE;'); }
  commitTransaction() { return this.db.exec('COMMIT;'); }
  rollbackTransaction() { return this.db.exec('ROLLBACK;'); }

  createGroup({ id, groupNumber, brandId, branchId, totalAmount, createdBy, now }) {
    return this.db.execute(`
      INSERT INTO pos_payment_groups (
        id, group_number, brand_id, branch_id, status, total_amount, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `, [id, groupNumber, brandId, branchId, totalAmount, createdBy, now, now]);
  }

  addOrder({ groupId, orderId, allocatedAmount, now }) {
    const id = 'pgo_' + require('crypto').randomBytes(6).toString('hex');
    return this.db.execute(`
      INSERT INTO pos_payment_group_orders (id, group_id, order_id, allocated_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, groupId, orderId, allocatedAmount, now, now]);
  }

  createPayment({ id, groupId, paymentMethod, provider, amount, amountTendered, changeAmount, actorId, shiftId, paymentStatus = 'settlement', settledAt, now }) {
    return this.db.execute(`
      INSERT INTO pos_payment_group_payments (
        id, group_id, payment_method, provider, amount, amount_tendered, change_amount,
        actor_id, shift_id, payment_status, settled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, groupId, paymentMethod, provider, amount, amountTendered, changeAmount, actorId, shiftId, paymentStatus, settledAt, now, now]);
  }

  markGroupSettled(groupId, now) {
    return this.db.execute(`
      UPDATE pos_payment_groups
      SET status = 'settled', payment_method = 'cash', settled_at = ?, updated_at = ?
      WHERE id = ? AND status = 'open'
    `, [now, now, groupId]);
  }

  findGroup(groupId) {
    return this.db.queryOne('SELECT * FROM pos_payment_groups WHERE id = ?', [groupId]);
  }

  findGroupOrders(groupId) {
    return this.db.queryMany(`
      SELECT
        pgo.group_id,
        pgo.order_id,
        pgo.allocated_amount,
        o.order_number,
        o.brand_id,
        o.branch_id,
        o.order_type,
        o.status,
        o.payment_method,
        o.payment_status,
        o.grand_total,
        o.table_number,
        o.customer_name
      FROM pos_payment_group_orders pgo
      JOIN orders o ON o.id = pgo.order_id
      WHERE pgo.group_id = ?
      ORDER BY pgo.created_at ASC, o.order_number ASC
    `, [groupId]);
  }

  findActiveGroupForOrder(orderId) {
    return this.db.queryOne(`
      SELECT pg.id, pg.group_number, pg.status, pg.total_amount
      FROM pos_payment_group_orders pgo
      JOIN pos_payment_groups pg ON pg.id = pgo.group_id
      WHERE pgo.order_id = ? AND pg.status = 'open'
      LIMIT 1
    `, [orderId]);
  }

  findEligibleCandidates({ branchId, currentOrderId }) {
    return this.db.queryMany(`
      SELECT
        o.id,
        o.order_number,
        o.brand_id,
        o.branch_id,
        o.order_type,
        o.status,
        o.payment_method,
        o.payment_status,
        o.grand_total,
        o.table_number,
        o.customer_name,
        o.created_at
      FROM orders o
      WHERE o.branch_id = ?
        AND o.id <> ?
        AND o.order_type = 'dine_in'
        AND o.status NOT IN ('pending', 'completed', 'cancelled', 'expired', 'rejected', 'timeout', 'fulfillment_exception')
        AND COALESCE(o.payment_status, 'pending') <> 'settlement'
        AND NOT EXISTS (
          SELECT 1
          FROM order_payments op
          WHERE op.order_id = o.id AND op.payment_status = 'settlement'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pos_check_payments cp
          WHERE cp.order_id = o.id AND cp.payment_status = 'settlement'
        )
        AND (
          SELECT COUNT(*)
          FROM pos_order_checks c
          WHERE c.order_id = o.id
        ) <= 1
        AND NOT EXISTS (
          SELECT 1
          FROM pos_payment_group_orders pgo
          JOIN pos_payment_groups pg ON pg.id = pgo.group_id
          WHERE pgo.order_id = o.id AND pg.status = 'open'
        )
      ORDER BY
        CASE WHEN o.table_number IS NULL OR o.table_number = '' THEN 1 ELSE 0 END,
        CAST(o.table_number AS INTEGER),
        o.created_at ASC
    `, [branchId, currentOrderId]);
  }
}

module.exports = PosPaymentGroupRepository;
