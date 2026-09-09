'use strict';

/**
 * POS shift persistence adapter.
 *
 * Persistence-only boundary for cashier shift reads and cash mutations.
 * Shift authorization, financial policy, and operational decisions remain in POS services.
 */
const DataAccess = require('../DataAccess');

class PosShiftRepository {
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

  findById(shiftId) {
    return this.db.queryOne('SELECT * FROM pos_shifts WHERE id = ?', [shiftId]);
  }

  findStatusById(shiftId) {
    return this.db.queryOne('SELECT status FROM pos_shifts WHERE id = ?', [shiftId]);
  }

  findOpenByCashier(cashierId) {
    return this.db.queryOne(`
      SELECT *
      FROM pos_shifts
      WHERE cashier_id = ? AND status = 'open'
      LIMIT 1
    `, [cashierId]);
  }

  insertShift({ shiftId, branchId, cashierId, startingFloat, openedAt }) {
    return this.db.execute(`
      INSERT INTO pos_shifts (
        id, branch_id, cashier_id, starting_float, total_cash_sales,
        total_cash_in, total_cash_out, expected_cash, status, opened_at
      ) VALUES (?, ?, ?, ?, 0.0, 0.0, 0.0, ?, 'open', ?)
    `, [shiftId, branchId, cashierId, startingFloat, startingFloat, openedAt]);
  }

  insertCashMovement({ movementId, shiftId, type, amount, reason, createdAt }) {
    return this.db.execute(`
      INSERT INTO pos_cash_movements (id, shift_id, type, amount, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [movementId, shiftId, type, amount, reason, createdAt]);
  }

  incrementCashIn({ shiftId, amount }) {
    return this.db.execute(`
      UPDATE pos_shifts
      SET total_cash_in = total_cash_in + ?, expected_cash = expected_cash + ?
      WHERE id = ? AND status = 'open'
    `, [amount, amount, shiftId]);
  }

  incrementCashOut({ shiftId, amount }) {
    return this.db.execute(`
      UPDATE pos_shifts
      SET total_cash_out = total_cash_out + ?, expected_cash = expected_cash - ?
      WHERE id = ? AND status = 'open'
    `, [amount, amount, shiftId]);
  }

  closeShift({ shiftId, expectedCash, actualCash, variance, closedAt }) {
    return this.db.execute(`
      UPDATE pos_shifts
      SET
        expected_cash = ?,
        actual_cash = ?,
        variance = ?,
        status = 'closed',
        closed_at = ?
      WHERE id = ? AND status = 'open'
    `, [expectedCash, actualCash, variance, closedAt, shiftId]);
  }

  closeDisasterRecovery({ shiftId, actualCash, variance, closedAt }) {
    return this.db.execute(`
      UPDATE pos_shifts
      SET
        actual_cash = ?,
        variance = ?,
        status = 'closed',
        closed_at = ?
      WHERE id = ? AND status = 'open'
    `, [actualCash, variance, closedAt, shiftId]);
  }

  incrementCashSales({ shiftId, branchId, amount }) {
    return this.db.execute(`
      UPDATE pos_shifts
      SET total_cash_sales = total_cash_sales + ?,
          expected_cash = expected_cash + ?
      WHERE id = ? AND branch_id = ? AND status = 'open'
    `, [amount, amount, shiftId, branchId]);
  }
}

module.exports = PosShiftRepository;
