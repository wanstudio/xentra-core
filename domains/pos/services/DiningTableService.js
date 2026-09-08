/**
 * DiningTableService
 *
 * Authoritative lifecycle & state machine for Dining Tables and Dining Sessions:
 * - Branch-scoped tables and layout configuration
 * - Separation of layout from operational table state
 * - Safe concurrent table hold (15-minute hold for payment stage)
 * - Payment success transitions held tables to 'occupied' in an active Dining Session
 * - Dining completion releases all associated tables back to 'available'
 * - QR code resolution (branch + table) & token regeneration
 * - Reservation interaction: allocated tables mark operational_state = 'reserved'
 * - Operational intervention: Staff/POS block, unblock, reassign table
 */

const crypto = require('crypto');
const db = require('../../../server/database/db');
const Template01 = require('../templates/Template01');

const HOLD_DURATION_MINUTES = 15;

class DiningTableService {
  /**
   * Initializes a branch layout from Template #01 or blank canvas.
   *
   * @param {string} branchId
   * @param {string} [templateId='template_01']
   */
  static initializeBranchLayout(branchId, templateId = 'template_01') {
    if (!branchId) throw new Error('[DiningTableService] branchId is required.');

    const existingLayout = db.prepare('SELECT id FROM branch_dining_layouts WHERE branch_id = ?').get(branchId);
    const layoutId = existingLayout ? existingLayout.id : `layout_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    const template = templateId === 'template_01' ? Template01 : null;
    const canvasConfig = template ? JSON.stringify(template.canvas) : JSON.stringify({ width: 380, height: 620 });
    const nonTableConfig = template ? JSON.stringify(template.non_table_objects) : JSON.stringify([]);
    const sectionsConfig = template ? JSON.stringify(template.sections) : JSON.stringify([]);

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        INSERT INTO branch_dining_layouts (
          id, branch_id, canvas_config, sections_config, non_table_objects_config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          canvas_config = excluded.canvas_config,
          sections_config = excluded.sections_config,
          non_table_objects_config = excluded.non_table_objects_config,
          updated_at = excluded.updated_at
      `).run(layoutId, branchId, canvasConfig, sectionsConfig, nonTableConfig, now, now);

      if (template && Array.isArray(template.tables)) {
        for (const t of template.tables) {
          const tableId = `tbl_${branchId}_${t.table_number}`;
          const qrToken = `qr_${crypto.randomBytes(8).toString('hex')}`;
          const initState = t.initial_state || 'available';

          db.prepare(`
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
          `).run(
            tableId,
            branchId,
            t.table_number,
            t.label,
            t.capacity,
            t.section_id,
            t.x,
            t.y,
            t.width,
            t.height,
            t.shape,
            t.orientation,
            qrToken,
            now,
            now
          );

          // Initialize operational state if not exists
          db.prepare(`
            INSERT INTO branch_table_states (
              table_id, operational_state, updated_at
            ) VALUES (?, ?, ?)
            ON CONFLICT(table_id) DO NOTHING
          `).run(tableId, initState, now);
        }
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }

    return this.getBranchLayout(branchId);
  }

  /**
   * Sweeps and releases expired table holds (>= 15 minutes).
   */
  static sweepExpiredHolds() {
    const now = new Date();
    const expiredHolds = db.prepare(`
      SELECT id, table_id, branch_id, hold_reference_id
      FROM branch_table_holds
      WHERE status = 'active' AND expires_at <= ?
    `).all(now.toISOString());

    if (!expiredHolds || expiredHolds.length === 0) return 0;

    let releasedCount = 0;
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const h of expiredHolds) {
        db.prepare(`
          UPDATE branch_table_holds
          SET status = 'expired', updated_at = ?
          WHERE id = ?
        `).run(now.toISOString(), h.id);

        // Transition operational state back to available if still 'held'
        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'available',
              current_session_id = NULL,
              notes = 'Hold expired',
              updated_at = ?
          WHERE table_id = ? AND operational_state = 'held'
        `).run(now.toISOString(), h.table_id);

        releasedCount++;
      }
      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      console.error('[DiningTableService] sweepExpiredHolds error:', err);
    }
    return releasedCount;
  }

  /**
   * Retrieves complete branch dining layout and live operational table states.
   */
  static getBranchLayout(branchId) {
    this.sweepExpiredHolds();

    let layout = db.prepare('SELECT * FROM branch_dining_layouts WHERE branch_id = ?').get(branchId);
    if (!layout) {
      // Auto seed from Template #01 on first fetch
      return this.initializeBranchLayout(branchId, 'template_01');
    }

    const tables = db.prepare(`
      SELECT 
        t.id, t.branch_id, t.table_number, t.label, t.capacity, t.section_id,
        t.x, t.y, t.width, t.height, t.shape, t.orientation, t.qr_token, t.is_active,
        COALESCE(s.operational_state, 'available') as operational_state,
        s.current_session_id, s.notes, s.updated_at as state_updated_at
      FROM branch_tables t
      LEFT JOIN branch_table_states s ON s.table_id = t.id
      WHERE t.branch_id = ? AND t.is_active = 1
      ORDER BY CAST(t.table_number AS INTEGER) ASC, t.table_number ASC
    `).all(branchId);

    let canvas = { width: 380, height: 620 };
    let nonTableObjects = [];
    let sections = [];

    try { canvas = JSON.parse(layout.canvas_config || '{}'); } catch (_) {}
    try { nonTableObjects = JSON.parse(layout.non_table_objects_config || '[]'); } catch (_) {}
    try { sections = JSON.parse(layout.sections_config || '[]'); } catch (_) {}

    return {
      branch_id: branchId,
      canvas,
      sections,
      non_table_objects: nonTableObjects,
      tables
    };
  }

  /**
   * Validates availability of given table IDs for a branch.
   */
  static validateTablesAvailable(branchId, tableIds) {
    this.sweepExpiredHolds();
    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return { valid: false, error: 'Daftar meja tidak boleh kosong.' };
    }

    for (const tid of tableIds) {
      const row = db.prepare(`
        SELECT t.id, t.table_number, t.is_active, COALESCE(s.operational_state, 'available') as operational_state
        FROM branch_tables t
        LEFT JOIN branch_table_states s ON s.table_id = t.id
        WHERE t.id = ? AND t.branch_id = ?
      `).get(tid, branchId);

      if (!row || !row.is_active) {
        return { valid: false, error: `Meja "${tid}" tidak ditemukan atau tidak aktif di cabang ini.` };
      }

      if (row.operational_state !== 'available') {
        return {
          valid: false,
          error: `Meja ${row.table_number} sedang tidak tersedia (${row.operational_state}). Silakan pilih meja lain.`,
          unavailable_table_id: row.id,
          state: row.operational_state
        };
      }
    }

    return { valid: true };
  }

  /**
   * Holds tables for a customer entering payment stage (15 minutes).
   * Safe atomic check-and-set concurrency guard.
   */
  static holdTablesForPayment({ branch_id, table_ids, customer_phone, hold_reference_id }) {
    this.sweepExpiredHolds();
    if (!branch_id || !Array.isArray(table_ids) || table_ids.length === 0) {
      throw new Error('[DiningTableService] branch_id and non-empty table_ids are required.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000);
    const holdRef = hold_reference_id || `hold_${crypto.randomBytes(6).toString('hex')}`;

    db.exec('BEGIN IMMEDIATE;');
    try {
      // 1. Verify all requested tables are strictly available
      for (const tid of table_ids) {
        const row = db.prepare(`
          SELECT t.id, t.table_number, t.is_active, COALESCE(s.operational_state, 'available') as operational_state
          FROM branch_tables t
          LEFT JOIN branch_table_states s ON s.table_id = t.id
          WHERE t.id = ? AND t.branch_id = ?
        `).get(tid, branch_id);

        if (!row || !row.is_active) {
          throw new Error(`[TABLE_UNAVAILABLE] Meja "${tid}" tidak aktif atau tidak ditemukan.`);
        }

        if (row.operational_state !== 'available') {
          throw new Error(`[CONCURRENCY_HOLD_CONFLICT] Meja ${row.table_number} baru saja dipilih atau sedang tidak tersedia (${row.operational_state}).`);
        }
      }

      // 2. Mark operational state as held and insert hold records
      for (const tid of table_ids) {
        const holdId = `bth_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO branch_table_holds (
            id, branch_id, table_id, customer_phone, hold_reference_id,
            expires_at, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(holdId, branch_id, tid, customer_phone || '', holdRef, expiresAt.toISOString(), now.toISOString(), now.toISOString());

        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'held',
              notes = 'Payment hold',
              updated_at = ?
          WHERE table_id = ?
        `).run(now.toISOString(), tid);
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }

    return {
      success: true,
      hold_reference_id: holdRef,
      table_ids,
      expires_at: expiresAt.toISOString(),
      duration_minutes: HOLD_DURATION_MINUTES
    };
  }

  /**
   * Releases table holds if payment failed, cancelled, or rejected.
   */
  static releaseHold({ branch_id, hold_reference_id, reason = 'cancelled' }) {
    if (!hold_reference_id) return { released: 0 };

    const holds = db.prepare(`
      SELECT id, table_id FROM branch_table_holds
      WHERE hold_reference_id = ? AND status = 'active'
    `).all(hold_reference_id);

    if (!holds || holds.length === 0) return { released: 0 };

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const h of holds) {
        db.prepare(`
          UPDATE branch_table_holds
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(reason, now, h.id);

        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'available',
              notes = ?,
              updated_at = ?
          WHERE table_id = ? AND operational_state = 'held'
        `).run(`Released: ${reason}`, now, h.table_id);
      }
      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      console.error('[DiningTableService] releaseHold error:', err);
      throw err;
    }

    return { released: holds.length };
  }

  /**
   * Creates or attaches to an active Dining Session upon successful payment or POS placement.
   * Transitions associated tables to 'occupied'.
   */
  static createOrAttachDiningSession({
    branch_id,
    table_ids = [],
    order_id,
    customer_name = '',
    customer_phone = '',
    guest_count = 1,
    hold_reference_id = null
  }) {
    if (!branch_id) throw new Error('[DiningTableService] branch_id is required.');

    const now = new Date().toISOString();
    let sessionId = null;

    db.exec('BEGIN IMMEDIATE;');
    try {
      // 1. Check if any of these tables already has an active session
      for (const tid of table_ids) {
        const stateRow = db.prepare('SELECT current_session_id, operational_state FROM branch_table_states WHERE table_id = ?').get(tid);
        if (stateRow && stateRow.current_session_id) {
          const session = db.prepare("SELECT id, status FROM dining_sessions WHERE id = ? AND status = 'active'").get(stateRow.current_session_id);
          if (session) {
            sessionId = session.id;
            break;
          }
        }
      }

      if (!sessionId) {
        sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO dining_sessions (
            id, branch_id, customer_name, customer_phone, guest_count, status, opened_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(sessionId, branch_id, customer_name || 'Tamu Dine-In', customer_phone || '', Number(guest_count) || 1, now, now);
      }

      // 2. Associate tables to this session
      for (const tid of table_ids) {
        const mapId = `dst_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO dining_session_tables (id, session_id, table_id, attached_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id, table_id) DO NOTHING
        `).run(mapId, sessionId, tid, now);

        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'occupied',
              current_session_id = ?,
              notes = 'Dine-in active',
              updated_at = ?
          WHERE table_id = ?
        `).run(sessionId, now, tid);
      }

      // 3. Mark active hold as converted
      if (hold_reference_id) {
        db.prepare(`
          UPDATE branch_table_holds
          SET status = 'converted', updated_at = ?
          WHERE hold_reference_id = ? AND status = 'active'
        `).run(now, hold_reference_id);
      }

      // 4. Associate order to session
      if (order_id) {
        db.prepare(`
          UPDATE orders
          SET dining_session_id = ?, updated_at = ?
          WHERE id = ?
        `).run(sessionId, now, order_id);
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }

    return {
      session_id: sessionId,
      branch_id,
      table_ids,
      status: 'active'
    };
  }

  /**
   * Completes a dining session (Staff/POS action).
   * Releases all tables associated with this session back to 'available'.
   */
  static completeDiningSession(sessionId, actorId = 'staff') {
    if (!sessionId) throw new Error('[DiningTableService] sessionId is required.');

    const session = db.prepare('SELECT * FROM dining_sessions WHERE id = ?').get(sessionId);
    if (!session) throw new Error(`[DiningTableService] Sesi meja "${sessionId}" tidak ditemukan.`);
    if (session.status === 'completed') {
      return { success: true, idempotent: true, session_id: sessionId, message: 'Sesi sudah selesai sebelumnya.' };
    }

    const now = new Date().toISOString();
    const associatedTables = db.prepare('SELECT table_id FROM dining_session_tables WHERE session_id = ?').all(sessionId);

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        UPDATE dining_sessions
        SET status = 'completed', closed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, sessionId);

      for (const row of associatedTables) {
        // Only release if the table's current_session_id is this session
        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'available',
              current_session_id = NULL,
              notes = 'Session completed',
              updated_at = ?
          WHERE table_id = ? AND current_session_id = ?
        `).run(now, row.table_id, sessionId);
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }

    return {
      success: true,
      session_id: sessionId,
      released_tables: associatedTables.map(t => t.table_id),
      status: 'completed'
    };
  }

  /**
   * Staff/POS operational intervention: block or unblock a table.
   */
  static setTableBlockedState(tableId, isBlocked, reason = '') {
    if (!tableId) throw new Error('[DiningTableService] tableId is required.');
    const now = new Date().toISOString();

    const targetState = isBlocked ? 'blocked' : 'available';
    db.prepare(`
      UPDATE branch_table_states
      SET operational_state = ?,
          notes = ?,
          updated_at = ?
      WHERE table_id = ?
    `).run(targetState, reason || (isBlocked ? 'Blocked by staff' : 'Unblocked by staff'), now, tableId);

    return { success: true, table_id: tableId, operational_state: targetState };
  }

  /**
   * Staff/POS operational intervention: reassign table for an active dining session.
   */
  static reassignSessionTables({ session_id, new_table_ids = [] }) {
    if (!session_id || !Array.isArray(new_table_ids) || new_table_ids.length === 0) {
      throw new Error('[DiningTableService] session_id and new_table_ids are required.');
    }

    const session = db.prepare("SELECT * FROM dining_sessions WHERE id = ? AND status = 'active'").get(session_id);
    if (!session) throw new Error(`[DiningTableService] Sesi aktif "${session_id}" tidak ditemukan.`);

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      // 1. Release old tables
      const oldTables = db.prepare('SELECT table_id FROM dining_session_tables WHERE session_id = ?').all(session_id);
      for (const ot of oldTables) {
        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'available',
              current_session_id = NULL,
              notes = 'Reassigned to another table',
              updated_at = ?
          WHERE table_id = ? AND current_session_id = ?
        `).run(now, ot.table_id, session_id);
      }

      db.prepare('DELETE FROM dining_session_tables WHERE session_id = ?').run(session_id);

      // 2. Attach new tables
      for (const ntid of new_table_ids) {
        const mapId = `dst_${crypto.randomBytes(6).toString('hex')}`;
        db.prepare(`
          INSERT INTO dining_session_tables (id, session_id, table_id, attached_at)
          VALUES (?, ?, ?, ?)
        `).run(mapId, session_id, ntid, now);

        db.prepare(`
          UPDATE branch_table_states
          SET operational_state = 'occupied',
              current_session_id = ?,
              notes = 'Staff table reassignment',
              updated_at = ?
          WHERE table_id = ?
        `).run(session_id, now, ntid);
      }

      db.exec('COMMIT;');
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw err;
    }

    return { success: true, session_id, table_ids: new_table_ids };
  }

  /**
   * Resolves table and branch from scanned QR token.
   */
  static resolveFromQr(qrToken) {
    if (!qrToken) return null;
    const row = db.prepare(`
      SELECT 
        t.id, t.branch_id, t.table_number, t.label, t.capacity, t.section_id,
        b.brand_id, b.name as branch_name,
        COALESCE(s.operational_state, 'available') as operational_state,
        s.current_session_id
      FROM branch_tables t
      JOIN branches b ON b.id = t.branch_id
      LEFT JOIN branch_table_states s ON s.table_id = t.id
      WHERE t.qr_token = ? AND t.is_active = 1
    `).get(qrToken);

    return row || null;
  }

  /**
   * Regenerates QR token for a table without modifying table identity or historical orders.
   */
  static regenerateQrToken(tableId) {
    const newQrToken = `qr_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();

    const result = db.prepare(`
      UPDATE branch_tables
      SET qr_token = ?, updated_at = ?
      WHERE id = ?
    `).run(newQrToken, now, tableId);

    if (result.changes === 0) {
      throw new Error(`[DiningTableService] Meja "${tableId}" tidak ditemukan.`);
    }

    return { table_id: tableId, qr_token: newQrToken };
  }
}

module.exports = DiningTableService;
