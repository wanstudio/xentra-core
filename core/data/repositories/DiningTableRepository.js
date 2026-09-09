'use strict';

/**
 * Dining-table persistence adapter.
 *
 * Keeps table layout, operational state, hold and dining-session persistence
 * behind semantic methods. Table availability, hold policy, concurrency rules
 * and session lifecycle remain in the POS/domain service layer.
 */
const DataAccess = require('../DataAccess');

class DiningTableRepository {
  constructor(dataAccess = DataAccess) {
    this.db = dataAccess;
  }

  findBranchLayout(branchId) {
    return this.db.queryOne(
      'SELECT * FROM branch_dining_layouts WHERE branch_id = ?',
      [branchId]
    );
  }

  findActiveTables(branchId) {
    return this.db.queryMany(`
      SELECT
        t.id, t.branch_id, t.table_number, t.label, t.capacity, t.section_id,
        t.x, t.y, t.width, t.height, t.shape, t.orientation, t.qr_token, t.is_active,
        COALESCE(s.operational_state, 'available') as operational_state,
        s.current_session_id, s.notes, s.updated_at as state_updated_at
      FROM branch_tables t
      LEFT JOIN branch_table_states s ON s.table_id = t.id
      WHERE t.branch_id = ? AND t.is_active = 1
      ORDER BY CAST(t.table_number AS INTEGER) ASC, t.table_number ASC
    `, [branchId]);
  }

  findTableState(tableId) {
    return this.db.queryOne(
      'SELECT current_session_id, operational_state FROM branch_table_states WHERE table_id = ?',
      [tableId]
    );
  }

  findTableForBranch(tableId, branchId) {
    return this.db.queryOne(`
      SELECT t.id, t.table_number, t.is_active,
             COALESCE(s.operational_state, 'available') as operational_state
      FROM branch_tables t
      LEFT JOIN branch_table_states s ON s.table_id = t.id
      WHERE t.id = ? AND t.branch_id = ?
    `, [tableId, branchId]);
  }

  findActiveHolds(referenceId) {
    return this.db.queryMany(`
      SELECT id, table_id
      FROM branch_table_holds
      WHERE hold_reference_id = ? AND status = 'active'
    `, [referenceId]);
  }

  findExpiredHolds(nowIso) {
    return this.db.queryMany(`
      SELECT id, table_id, branch_id, hold_reference_id
      FROM branch_table_holds
      WHERE status = 'active' AND expires_at <= ?
    `, [nowIso]);
  }
}

module.exports = DiningTableRepository;
