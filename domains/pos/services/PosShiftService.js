/**
 * Xentra POS Shift Service
 * Orchestrates cashier shift operations: Open Shift, Cash In, Cash Out, and Close Shift with Variance Auditing.
 */
const crypto = require('crypto');
const db = require('../../../server/database/db');
const { events } = require('../../../core');
const PosShiftModel = require('../models/PosShiftModel');

class PosShiftService {
  /**
   * Opens a new Cashier Shift.
   * 
   * @param {Object} params
   * @param {string} params.branch_id
   * @param {string} params.cashier_id
   * @param {number} params.starting_float
   * @returns {Object} Active Shift record
   */
  static openShift({ branch_id, cashier_id, starting_float = 0 }) {
    if (!branch_id || !cashier_id) {
      throw new Error('[PosShiftService] "branch_id" and "cashier_id" are required to open a shift.');
    }

    // Check if cashier already has an active open shift in this branch
    const existingOpenShift = db.prepare(`
      SELECT * FROM pos_shifts WHERE branch_id = ? AND cashier_id = ? AND status = 'open'
    `).get(branch_id, cashier_id);

    if (existingOpenShift) {
      throw new Error(`[PosShiftService] Kasir sudah memiliki shift aktif (ID: ${existingOpenShift.id}). Tutup shift lama terlebih dahulu.`);
    }

    const shiftId = `shift_${crypto.randomBytes(6).toString('hex')}`;
    const startingFloat = Number(starting_float) || 0;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO pos_shifts (
        id, branch_id, cashier_id, starting_float, total_cash_sales,
        total_cash_in, total_cash_out, expected_cash, status, opened_at
      ) VALUES (?, ?, ?, ?, 0.0, 0.0, 0.0, ?, 'open', ?)
    `).run(shiftId, branch_id, cashier_id, startingFloat, startingFloat, now);

    // Emit event: pos.shift.opened
    events.EventBus.publish({
      type: 'pos.shift.opened',
      producer: 'pos',
      payload: {
        shift_id: shiftId,
        branch_id,
        cashier_id,
        starting_float: startingFloat,
        opened_at: now
      }
    }).catch(() => {});

    return {
      id: shiftId,
      branch_id,
      cashier_id,
      starting_float: startingFloat,
      expected_cash: startingFloat,
      status: 'open',
      opened_at: now
    };
  }

  /**
   * Records a manual Cash Movement (Cash In or Cash Out).
   * 
   * @param {Object} params
   * @param {string} params.shift_id
   * @param {'in'|'out'} params.type
   * @param {number} params.amount
   * @param {string} [params.reason='']
   * @returns {Object} Updated shift summary
   */
  static recordCashMovement({ shift_id, type, amount, reason = '' }) {
    if (!shift_id || !type || !amount) {
      throw new Error('[PosShiftService] "shift_id", "type", and "amount" are required.');
    }

    const shift = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shift_id);
    if (!shift || shift.status !== 'open') {
      throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    }

    const moveAmount = Number(amount);
    if (moveAmount <= 0) {
      throw new Error('[PosShiftService] Jumlah kas harus lebih besar dari 0.');
    }

    const movementId = `move_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO pos_cash_movements (id, shift_id, type, amount, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(movementId, shift_id, type, moveAmount, reason, now);

    if (type === 'in') {
      db.prepare(`
        UPDATE pos_shifts
        SET total_cash_in = total_cash_in + ?, expected_cash = expected_cash + ?
        WHERE id = ?
      `).run(moveAmount, moveAmount, shift_id);
    } else {
      db.prepare(`
        UPDATE pos_shifts
        SET total_cash_out = total_cash_out + ?, expected_cash = expected_cash - ?
        WHERE id = ?
      `).run(moveAmount, moveAmount, shift_id);
    }

    return db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shift_id);
  }

  /**
   * Closes an active Cashier Shift and calculates Variance.
   * 
   * @param {Object} params
   * @param {string} params.shift_id
   * @param {number} params.actual_cash - Actual cash counted by cashier
   * @returns {Object} Closed shift record with variance
   */
  static closeShift({ shift_id, actual_cash }) {
    if (!shift_id || actual_cash == null) {
      throw new Error('[PosShiftService] "shift_id" and "actual_cash" are required to close a shift.');
    }

    const shift = db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shift_id);
    if (!shift || shift.status !== 'open') {
      throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    }

    const expectedCash = PosShiftModel.calculateExpectedCash({
      starting_float: shift.starting_float,
      total_cash_sales: shift.total_cash_sales,
      total_cash_in: shift.total_cash_in,
      total_cash_out: shift.total_cash_out
    });

    const varianceCalc = PosShiftModel.calculateVariance(expectedCash, actual_cash);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE pos_shifts
      SET 
        expected_cash = ?,
        actual_cash = ?,
        variance = ?,
        status = 'closed',
        closed_at = ?
      WHERE id = ?
    `).run(expectedCash, Number(actual_cash), varianceCalc.variance, now, shift_id);

    // Emit event: pos.shift.closed (Recorded in Evidence Pool)
    events.EventBus.publish({
      type: 'pos.shift.closed',
      producer: 'pos',
      payload: {
        shift_id,
        branch_id: shift.branch_id,
        cashier_id: shift.cashier_id,
        starting_float: shift.starting_float,
        total_cash_sales: shift.total_cash_sales,
        expected_cash: expectedCash,
        actual_cash: Number(actual_cash),
        variance: varianceCalc.variance,
        is_balanced: varianceCalc.is_balanced,
        closed_at: now
      }
    }).catch(() => {});

    return db.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shift_id);
  }
}

module.exports = PosShiftService;
