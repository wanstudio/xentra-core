'use strict';

const DataAccess = require('../DataAccess');

class OrderAdditionRepository {
  constructor(dataAccess = DataAccess) { this.db = dataAccess; }

  findById(id) {
    return this.db.queryOne('SELECT * FROM order_addition_batches WHERE id = ?', [id]);
  }

  findByOrderId(orderId) {
    return this.db.queryMany('SELECT * FROM order_addition_batches WHERE order_id = ? ORDER BY sequence_no ASC, created_at ASC', [orderId]);
  }

  countPendingByOrderId(orderId) {
    const row = this.db.queryOne(
      "SELECT COUNT(*) AS count FROM order_addition_batches WHERE order_id = ? AND status = 'pending_acceptance'",
      [orderId]
    );
    return Number(row?.count || 0);
  }

  nextSequence(orderId) {
    const row = this.db.queryOne(
      'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM order_addition_batches WHERE order_id = ?',
      [orderId]
    );
    return Number(row?.next_sequence || 1);
  }

  findByClientTransactionId(orderId, clientTransactionId) {
    if (!clientTransactionId) return null;
    return this.db.queryOne(
      'SELECT * FROM order_addition_batches WHERE order_id = ? AND client_transaction_id = ? LIMIT 1',
      [orderId, clientTransactionId]
    );
  }

  insertBatch({ id, orderId, branchId, diningSessionId, sequenceNo, sourceChannel, createdBy, clientTransactionId = null, itemsPayload, subtotal, createdAt, updatedAt }) {
    return this.db.execute(
      "INSERT INTO order_addition_batches (id, order_id, branch_id, dining_session_id, sequence_no, source_channel, created_by, client_transaction_id, items_payload, subtotal, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_acceptance', ?, ?)",
      [id, orderId, branchId, diningSessionId, sequenceNo, sourceChannel, createdBy || null, clientTransactionId || null, itemsPayload, Number(subtotal || 0), createdAt, updatedAt]
    );
  }

  markAccepted({ id, acceptedAt, updatedAt }) {
    return this.db.execute(
      "UPDATE order_addition_batches SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_acceptance'",
      [acceptedAt, updatedAt, id]
    );
  }

  markRejected({ id, reason, rejectedAt, updatedAt }) {
    return this.db.execute(
      "UPDATE order_addition_batches SET status = 'rejected', rejection_reason = ?, rejected_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_acceptance'",
      [reason || '', rejectedAt, updatedAt, id]
    );
  }
}

module.exports = OrderAdditionRepository;
