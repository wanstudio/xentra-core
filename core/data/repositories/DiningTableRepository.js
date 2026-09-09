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

  beginTransaction() {
    return this.db.exec('BEGIN IMMEDIATE;');
  }

  commitTransaction() {
    return this.db.exec('COMMIT;');
  }

  rollbackTransaction() {
    return this.db.exec('ROLLBACK;');
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

  upsertBranchLayout({
    layoutId,
    branchId,
    canvasConfig,
    sectionsConfig,
    nonTableObjectsConfig,
    createdAt,
    updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO branch_dining_layouts (
        id, branch_id, canvas_config, sections_config, non_table_objects_config, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id) DO UPDATE SET
        canvas_config = excluded.canvas_config,
        sections_config = excluded.sections_config,
        non_table_objects_config = excluded.non_table_objects_config,
        updated_at = excluded.updated_at
    `, [
      layoutId,
      branchId,
      canvasConfig,
      sectionsConfig,
      nonTableObjectsConfig,
      createdAt,
      updatedAt
    ]);
  }

  upsertBranchTable({
    tableId,
    branchId,
    tableNumber,
    label,
    capacity,
    sectionId,
    x,
    y,
    width,
    height,
    shape,
    orientation,
    qrToken,
    createdAt,
    updatedAt
  }) {
    return this.db.execute(`
      INSERT INTO branch_tables (
        id, branch_id, table_number, label, capacity, section_id,
        x, y, width, height, shape, orientation, qr_token, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(branch_id, table_number) DO UPDATE SET
        label = excluded.label,
        capacity = excluded.capacity,
        section_id = excluded.section_id,
        x = excluded.x,
        y = excluded.y,
        width = excluded.width,
        height = excluded.height,
        shape = excluded.shape,
        orientation = excluded.orientation,
        updated_at = excluded.updated_at
    `, [
      tableId,
      branchId,
      tableNumber,
      label,
      capacity,
      sectionId,
      x,
      y,
      width,
      height,
      shape,
      orientation,
      qrToken,
      createdAt,
      updatedAt
    ]);
  }

  ensureTableState({ tableId, operationalState, updatedAt }) {
    return this.db.execute(`
      INSERT INTO branch_table_states (
        table_id, operational_state, updated_at
      ) VALUES (?, ?, ?)
      ON CONFLICT(table_id) DO NOTHING
    `, [tableId, operationalState, updatedAt]);
  }

  updateTableState({ tableId, operationalState, currentSessionId = null, notes = null, updatedAt }) {
    return this.db.execute(`
      UPDATE branch_table_states
      SET operational_state = ?,
          current_session_id = ?,
          notes = ?,
          updated_at = ?
      WHERE table_id = ?
    `, [operationalState, currentSessionId, notes, updatedAt, tableId]);
  }

  insertHold({
    holdId,
    branchId,
    tableId,
    customerPhone,
    holdReferenceId,
    expiresAt,
    createdAt,
    updatedAt,
    status = 'active'
  }) {
    return this.db.execute(`
      INSERT INTO branch_table_holds (
        id, branch_id, table_id, customer_phone, hold_reference_id,
        expires_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      holdId,
      branchId,
      tableId,
      customerPhone || '',
      holdReferenceId,
      expiresAt,
      status,
      createdAt,
      updatedAt
    ]);
  }

  updateHoldStatus({ holdId, status, updatedAt }) {
    return this.db.execute(`
      UPDATE branch_table_holds
      SET status = ?, updated_at = ?
      WHERE id = ?
    `, [status, updatedAt, holdId]);
  }

  findDiningSession(sessionId) {
    return this.db.queryOne(
      'SELECT * FROM dining_sessions WHERE id = ?',
      [sessionId]
    );
  }

  findDiningSessionById(sessionId) {
    return this.db.queryOne(
      "SELECT id, status FROM dining_sessions WHERE id = ? AND status = 'active'",
      [sessionId]
    );
  }

  findSessionTables(sessionId) {
    return this.db.queryMany(
      'SELECT table_id FROM dining_session_tables WHERE session_id = ?',
      [sessionId]
    );
  }

  createDiningSession({ sessionId, branchId, customerName, customerPhone, guestCount, openedAt, updatedAt }) {
    return this.db.execute(`
      INSERT INTO dining_sessions (
        id, branch_id, customer_name, customer_phone, guest_count, status, opened_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `, [
      sessionId,
      branchId,
      customerName || 'Tamu Dine-In',
      customerPhone || '',
      Number(guestCount) || 1,
      openedAt,
      updatedAt
    ]);
  }

  completeDiningSession({ sessionId, closedAt, updatedAt }) {
    return this.db.execute(`
      UPDATE dining_sessions
      SET status = 'completed', closed_at = ?, updated_at = ?
      WHERE id = ?
    `, [closedAt, updatedAt, sessionId]);
  }

  attachDiningSessionTable({ mappingId, sessionId, tableId, attachedAt }) {
    return this.db.execute(`
      INSERT INTO dining_session_tables (id, session_id, table_id, attached_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, table_id) DO NOTHING
    `, [mappingId, sessionId, tableId, attachedAt]);
  }

  deleteDiningSessionTables(sessionId) {
    return this.db.execute(
      'DELETE FROM dining_session_tables WHERE session_id = ?',
      [sessionId]
    );
  }

  associateOrderToDiningSession({ orderId, sessionId, updatedAt }) {
    return this.db.execute(`
      UPDATE orders
      SET dining_session_id = ?, updated_at = ?
      WHERE id = ?
    `, [sessionId, updatedAt, orderId]);
  }

  findTableIdByNumberOrLabel(branchId, tableValue) {
    return this.db.queryOne(
      'SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)',
      [branchId, tableValue, tableValue]
    );
  }

  findCurrentSessionForTable(tableId) {
    return this.db.queryOne(
      'SELECT current_session_id, operational_state FROM branch_table_states WHERE table_id = ?',
      [tableId]
    );
  }

  resolveQr(qrToken) {
    return this.db.queryOne(`
      SELECT
        t.id, t.branch_id, t.table_number, t.label, t.capacity, t.section_id,
        b.brand_id, b.name as branch_name,
        COALESCE(s.operational_state, 'available') as operational_state,
        s.current_session_id
      FROM branch_tables t
      JOIN branches b ON b.id = t.branch_id
      LEFT JOIN branch_table_states s ON s.table_id = t.id
      WHERE t.qr_token = ? AND t.is_active = 1
    `, [qrToken]);
  }

  regenerateQrToken({ tableId, qrToken, updatedAt }) {
    return this.db.execute(`
      UPDATE branch_tables
      SET qr_token = ?, updated_at = ?
      WHERE id = ?
    `, [qrToken, updatedAt, tableId]);
  }
}

module.exports = DiningTableRepository;
