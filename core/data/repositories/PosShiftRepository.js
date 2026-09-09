'use strict';

/**
 * POS shift persistence adapter.
 *
 * Persistence-only boundary for cashier shift reads and cash aggregation.
 * Shift authorization and operational policy remain in POS services.
 */
const DataAccess = require('../DataAccess');

class PosShiftRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findById(shiftId) {
    return this.db.queryOne('SELECT * FROM pos_shifts WHERE id = ?', [shiftId]);
  }

  findStatusById(shiftId) {
    return this.db.queryOne('SELECT status FROM pos_shifts WHERE id = ?', [shiftId]);
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
