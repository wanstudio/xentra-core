'use strict';

/**
 * POS Operational Repository
 *
 * Exposes persistence operations for POS terminal bindings, sync outbox queue,
 * and cross-channel inventory conflict logs.
 */
const DataAccess = require('../DataAccess');

class PosOperationalRepository {
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

  // --- TERMINAL BINDING ---
  findTerminalById(terminalId) {
    return this.db.queryOne('SELECT * FROM pos_terminals WHERE id = ?', [terminalId]);
  }

  findActiveTerminalByBranch(branchId) {
    return this.db.queryOne("SELECT * FROM pos_terminals WHERE branch_id = ? AND status = 'active' LIMIT 1", [branchId]);
  }

  insertTerminal({ id, branchId, deviceName, deviceIdentifier, configVersion = 1, createdAt, updatedAt }) {
    const now = createdAt || new Date().toISOString();
    return this.db.execute(`
      INSERT INTO pos_terminals (
        id, branch_id, device_name, device_identifier, status, config_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `, [id, branchId, deviceName, deviceIdentifier, configVersion, now, updatedAt || now]);
  }

  updateTerminalConfigVersion({ terminalId, configVersion, updatedAt }) {
    return this.db.execute(`
      UPDATE pos_terminals
      SET config_version = ?, updated_at = ?
      WHERE id = ?
    `, [configVersion, updatedAt || new Date().toISOString(), terminalId]);
  }

  updateTerminalLastSync({ terminalId, lastSyncAt }) {
    return this.db.execute(`
      UPDATE pos_terminals
      SET last_sync_at = ?, updated_at = ?
      WHERE id = ?
    `, [lastSyncAt || new Date().toISOString(), lastSyncAt || new Date().toISOString(), terminalId]);
  }

  deactivateTerminal(terminalId) {
    return this.db.execute(`
      UPDATE pos_terminals
      SET status = 'deactivated', updated_at = datetime('now')
      WHERE id = ?
    `, [terminalId]);
  }

  // --- SYNC OUTBOX QUEUE ---
  findQueueEntryById(queueId) {
    return this.db.queryOne('SELECT * FROM pos_sync_queue WHERE id = ?', [queueId]);
  }

  findQueueEntryByClientTxId(branchId, clientTransactionId) {
    return this.db.queryOne(`
      SELECT * FROM pos_sync_queue
      WHERE branch_id = ? AND client_transaction_id = ?
      LIMIT 1
    `, [branchId, clientTransactionId]);
  }

  findPendingQueueEntries(terminalId) {
    return this.db.queryMany(`
      SELECT * FROM pos_sync_queue
      WHERE terminal_id = ? AND status IN ('pending', 'failed')
      ORDER BY created_at ASC
    `, [terminalId]);
  }

  findPendingQueueEntriesByBranch(branchId) {
    return this.db.queryMany(`
      SELECT * FROM pos_sync_queue
      WHERE branch_id = ? AND status IN ('pending', 'failed')
      ORDER BY created_at ASC
    `, [branchId]);
  }

  insertQueueEntry({
    id,
    terminalId,
    branchId,
    clientTransactionId,
    operationType,
    payload,
    status = 'pending',
    createdAt
  }) {
    const now = createdAt || new Date().toISOString();
    return this.db.execute(`
      INSERT INTO pos_sync_queue (
        id, terminal_id, branch_id, client_transaction_id, operation_type,
        payload, status, retry_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      id,
      terminalId,
      branchId,
      clientTransactionId,
      operationType,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      status,
      now,
      now
    ]);
  }

  updateQueueStatus({ queueId, status, reconciledReferenceId = null, conflictId = null, lastError = null, syncedAt = null }) {
    return this.db.execute(`
      UPDATE pos_sync_queue
      SET status = ?,
          reconciled_reference_id = COALESCE(?, reconciled_reference_id),
          conflict_id = COALESCE(?, conflict_id),
          last_error = ?,
          synced_at = COALESCE(?, synced_at),
          updated_at = datetime('now')
      WHERE id = ?
    `, [status, reconciledReferenceId, conflictId, lastError, syncedAt, queueId]);
  }

  incrementQueueRetry({ queueId, lastError }) {
    return this.db.execute(`
      UPDATE pos_sync_queue
      SET retry_count = retry_count + 1,
          last_error = ?,
          status = 'failed',
          updated_at = datetime('now')
      WHERE id = ?
    `, [lastError, queueId]);
  }

  // --- INVENTORY CONFLICTS ---
  findConflictById(conflictId) {
    return this.db.queryOne('SELECT * FROM pos_inventory_conflicts WHERE id = ?', [conflictId]);
  }

  findPendingConflictsByBranch(branchId) {
    return this.db.queryMany(`
      SELECT * FROM pos_inventory_conflicts
      WHERE branch_id = ? AND status = 'pending_review'
      ORDER BY created_at DESC
    `, [branchId]);
  }

  insertConflict({
    id,
    branchId,
    productId,
    terminalId = null,
    clientTransactionId = null,
    posSaleReference = null,
    affectedOrderIds = [],
    posDemandQuantity,
    onlineDemandQuantity,
    availableStockAtReconciliation,
    createdAt
  }) {
    const now = createdAt || new Date().toISOString();
    return this.db.execute(`
      INSERT INTO pos_inventory_conflicts (
        id, branch_id, product_id, terminal_id, client_transaction_id,
        pos_sale_reference, affected_order_ids, pos_demand_quantity,
        online_demand_quantity, available_stock_at_reconciliation,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)
    `, [
      id,
      branchId,
      productId,
      terminalId,
      clientTransactionId,
      posSaleReference,
      JSON.stringify(affectedOrderIds),
      posDemandQuantity,
      onlineDemandQuantity,
      availableStockAtReconciliation,
      now,
      now
    ]);
  }

  resolveConflict({
    conflictId,
    resolutionDecision,
    resolvedBy,
    resolutionReason = null,
    resolvedAt = null
  }) {
    const now = resolvedAt || new Date().toISOString();
    return this.db.execute(`
      UPDATE pos_inventory_conflicts
      SET status = 'resolved',
          resolution_decision = ?,
          resolved_by = ?,
          resolution_reason = ?,
          resolved_at = ?,
          updated_at = ?
      WHERE id = ?
    `, [resolutionDecision, resolvedBy, resolutionReason, now, now, conflictId]);
  }
}

module.exports = PosOperationalRepository;
