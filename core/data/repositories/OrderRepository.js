'use strict';

/**
 * Order persistence adapter.
 *
 * Exposes semantic order persistence operations while keeping SQL/storage
 * details behind the data boundary. Business validation, pricing, fulfillment
 * and state-machine decisions remain in Core services.
 */
const DataAccess = require('../DataAccess');

class OrderRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
  }

  findActiveReservation({ branchId, customerPhone, reservationDate }) {
    return this.db.queryOne(`
      SELECT id
      FROM orders
      WHERE order_type = 'reservation'
        AND status NOT IN ('cancelled', 'completed')
        AND branch_id = ?
        AND customer_phone = ?
        AND (scheduled_slot_start = ? OR order_note LIKE ?)
      LIMIT 1
    `, [branchId, customerPhone, reservationDate, `%Tgl: ${reservationDate}%`]);
  }

  countActiveReservations({ branchId, reservationDate }) {
    const row = this.db.queryOne(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE order_type = 'reservation'
        AND status NOT IN ('cancelled', 'completed')
        AND branch_id = ?
        AND (scheduled_slot_start = ? OR order_note LIKE ?)
    `, [branchId, reservationDate, `%Tgl: ${reservationDate}%`]);
    return Number(row?.count || 0);
  }

  findOverduePending({ timeoutSeconds }) {
    return this.db.queryMany(`
      SELECT id, status, branch_id, created_at
      FROM orders
      WHERE status = 'pending'
        AND created_at <= datetime('now', ?)
      ORDER BY created_at ASC
    `, [`-${timeoutSeconds} seconds`]);
  }

  findByBranchTransactionId(branchId, clientTransactionId) {
    return this.db.queryOne(`
      SELECT *
      FROM orders
      WHERE branch_id = ? AND client_transaction_id = ?
      LIMIT 1
    `, [branchId, clientTransactionId]);
  }

  findById(orderId) {
    return this.db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  }

  findItems(orderId) {
    return this.db.queryMany('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  }

  findDeliveryByOrderId(orderId) {
    return this.db.queryOne('SELECT * FROM order_deliveries WHERE order_id = ?', [orderId]);
  }

  insertOrUpdateDeliveryAssignment({ orderId, driverName, driverPhone, updatedAt }) {
    const existing = this.findDeliveryByOrderId(orderId);
    if (existing) {
      return this.db.execute(`
        UPDATE order_deliveries
        SET driver_name = ?,
            driver_phone = ?,
            status = 'assigned',
            updated_at = ?
        WHERE order_id = ?
      `, [driverName, driverPhone, updatedAt, orderId]);
    }

    const deliveryId = `del_${Date.now()}`;
    return this.db.execute(`
      INSERT INTO order_deliveries (
        id, order_id, driver_name, driver_phone, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'assigned', ?, ?)
    `, [deliveryId, orderId, driverName, driverPhone, updatedAt, updatedAt]);
  }

  updateDeliveryStatus({ orderId, status, updatedAt }) {
    return this.db.execute(`
      UPDATE order_deliveries
      SET status = ?, updated_at = ?
      WHERE order_id = ?
    `, [status, updatedAt, orderId]);
  }

  markDelivered({ orderId, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'delivered', updated_at = ?
      WHERE id = ?
    `, [updatedAt, orderId]);
  }

  insertOrder({
    id, orderNumber, clientTransactionId, brandId, branchId, customerName, customerPhone,
    orderType, orderChannel, selectionMode, tableNumber, fulfillmentScheduleType,
    scheduledSlotStart, scheduledSlotEnd, subtotal, discountAmount, deliveryFee,
    grandTotal, paymentMethod, status, orderNote, diningSessionId, createdAt, updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO orders (
        id, order_number, client_transaction_id, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, selection_mode, table_number, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end,
        subtotal, discount_amount, delivery_fee, grand_total, payment_method, status, order_note, dining_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, orderNumber, clientTransactionId, brandId, branchId, customerName, customerPhone,
      orderType, orderChannel, selectionMode, tableNumber, fulfillmentScheduleType,
      scheduledSlotStart, scheduledSlotEnd, subtotal, discountAmount, deliveryFee,
      grandTotal, paymentMethod, status, orderNote, diningSessionId, createdAt, updatedAt
    ]);
  }

  insertReservation({
    id, orderNumber, brandId, branchId, customerName, customerPhone,
    orderChannel, selectionMode, reservationDate, orderNote, createdAt, updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO orders (
        id, order_number, brand_id, branch_id, customer_name, customer_phone,
        order_type, order_channel, selection_mode, table_number, scheduled_slot_start,
        subtotal, delivery_fee, grand_total, payment_method, status, order_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'reservation', ?, ?, NULL, ?, 0, 0, 0, 'cash', 'confirmed', ?, ?, ?)
    `, [
      id, orderNumber, brandId, branchId, customerName, customerPhone,
      orderChannel, selectionMode, reservationDate, orderNote, createdAt, updatedAt
    ]);
  }

  insertItem({ id, orderId, productId, productName, unitPrice, quantity, itemSubtotal, note }) {
    return this.db.execute(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, orderId, productId, productName, unitPrice, quantity, itemSubtotal, note]);
  }

  insertDelivery({
    id, orderId, destinationAddress, destinationLatitude, destinationLongitude,
    actualRoadDistanceMeters, actualDurationSeconds, chargeableDistanceKm,
    freeKmApplied, ratePerKmApplied, deliveryFeeCalculated
  }) {
    return this.db.execute(`
      INSERT INTO order_deliveries (
        id, order_id, destination_address, destination_latitude, destination_longitude,
        actual_road_distance_meters, actual_duration_seconds, chargeable_distance_km,
        free_km_applied, rate_per_km_applied, delivery_fee_calculated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, orderId, destinationAddress, destinationLatitude, destinationLongitude,
      actualRoadDistanceMeters, actualDurationSeconds, chargeableDistanceKm,
      freeKmApplied, ratePerKmApplied, deliveryFeeCalculated
    ]);
  }

  ensurePendingPayment({ paymentId, orderId, provider, paymentMethod, merchantId, amount, createdAt, updatedAt }) {
    return this.db.execute(`
      INSERT INTO order_payments (
        id, order_id, provider, payment_method, merchant_id, snap_token, payment_status, amount, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        amount = excluded.amount,
        payment_method = excluded.payment_method,
        provider = excluded.provider,
        updated_at = excluded.updated_at
    `, [paymentId, orderId, provider, paymentMethod, merchantId, amount, createdAt, updatedAt]);
  }

  convertReservationToDineIn({ orderId, tableNumber, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET order_type = 'dine_in', status = 'active_table', table_number = ?, updated_at = ?
      WHERE id = ?
    `, [String(tableNumber), updatedAt, orderId]);
  }

  cancelReservationNoShow({ orderId, reason, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'cancelled', order_note = COALESCE(order_note || ' | ', '') || ?, updated_at = ?
      WHERE id = ?
    `, [reason, updatedAt, orderId]);
  }

  findHeldById(heldOrderId) {
    return this.db.queryOne(
      'SELECT * FROM pos_held_orders WHERE id = ?',
      [heldOrderId]
    );
  }

  findActiveHeldByTable({ branchId, tableNumber }) {
    return this.db.queryOne(`
      SELECT *
      FROM pos_held_orders
      WHERE branch_id = ? AND table_number = ? AND status = 'held'
      ORDER BY created_at DESC
      LIMIT 1
    `, [branchId, String(tableNumber)]);
  }

  findPaymentSettlement(orderId) {
    return this.db.queryOne(`
      SELECT id, payment_status, amount, provider
      FROM order_payments
      WHERE order_id = ? AND payment_status = 'settlement'
    `, [orderId]);
  }

  updateStatusIfCurrent({ orderId, targetStatus, currentStatus }) {
    return this.db.execute(`
      UPDATE orders
      SET status = ?, updated_at = datetime('now')
      WHERE id = ? AND status = ?
    `, [targetStatus, orderId, currentStatus]);
  }

  insertStatusLog({ logId, orderId, previousStatus, newStatus, actorType, actorId, note }) {
    return this.db.execute(`
      INSERT INTO order_status_logs (id, order_id, previous_status, new_status, actor_type, actor_id, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [logId, orderId, previousStatus, newStatus, actorType, actorId, note]);
  }

  updatePaymentMethod({ orderId, paymentMethod, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET payment_method = ?, updated_at = ?
      WHERE id = ?
    `, [paymentMethod, updatedAt, orderId]);
  }

  markFulfillmentException({ orderId, note, updatedAt, paymentMethod = 'midtrans' }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'fulfillment_exception',
          payment_method = ?,
          order_note = COALESCE(order_note || ' | ', '') || ?,
          updated_at = ?
      WHERE id = ?
    `, [paymentMethod, note, updatedAt, orderId]);
  }

  cancelPendingOrder({ orderId, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `, [updatedAt, orderId]);
  }
}

module.exports = OrderRepository;
