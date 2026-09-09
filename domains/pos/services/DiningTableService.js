/**
 * DiningTableService
 *
 * Authoritative lifecycle & state machine for Dining Tables and Dining Sessions.
 * Business rules stay here; persistence is delegated to DiningTableRepository.
 */

const crypto = require('crypto');
const { DiningTableRepository } = require('../../../core/data/repositories');
const Template01 = require('../templates/Template01');

const HOLD_DURATION_MINUTES = 15;
const repository = new DiningTableRepository();

class DiningTableService {
  static initializeBranchLayout(branchId, templateId = 'template_01') {
    if (!branchId) throw new Error('[DiningTableService] branchId is required.');

    const existingLayout = repository.findBranchLayout(branchId);
    const layoutId = existingLayout ? existingLayout.id : `layout_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const template = templateId === 'template_01' ? Template01 : null;
    const canvasConfig = template ? JSON.stringify(template.canvas) : JSON.stringify({ width: 380, height: 620 });
    const nonTableConfig = template ? JSON.stringify(template.non_table_objects) : JSON.stringify([]);
    const sectionsConfig = template ? JSON.stringify(template.sections) : JSON.stringify([]);

    repository.beginTransaction();
    try {
      repository.upsertBranchLayout({ layoutId, branchId, canvasConfig, sectionsConfig, nonTableObjectsConfig: nonTableConfig, createdAt: now, updatedAt: now });

      if (template && Array.isArray(template.tables)) {
        for (const t of template.tables) {
          const tableId = `tbl_${branchId}_${t.table_number}`;
          const qrToken = `qr_${crypto.randomBytes(8).toString('hex')}`;
          repository.upsertBranchTable({
            tableId, branchId, tableNumber: t.table_number, label: t.label, capacity: t.capacity,
            sectionId: t.section_id, x: t.x, y: t.y, width: t.width, height: t.height,
            shape: t.shape, orientation: t.orientation, qrToken, createdAt: now, updatedAt: now
          });
          repository.ensureTableState({ tableId, operationalState: t.initial_state || 'available', updatedAt: now });
        }
      }

      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return this.getBranchLayout(branchId);
  }

  static sweepExpiredHolds() {
    const nowIso = new Date().toISOString();
    const expiredHolds = repository.findExpiredHolds(nowIso);
    if (!expiredHolds || expiredHolds.length === 0) return 0;

    let releasedCount = 0;
    repository.beginTransaction();
    try {
      for (const h of expiredHolds) {
        repository.updateHoldStatus({ holdId: h.id, status: 'expired', updatedAt: nowIso });
        repository.updateTableState({ tableId: h.table_id, operationalState: 'available', currentSessionId: null, notes: 'Hold expired', updatedAt: nowIso });
        releasedCount++;
      }
      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      console.error('[DiningTableService] sweepExpiredHolds error:', err);
    }
    return releasedCount;
  }

  static getBranchLayout(branchId) {
    this.sweepExpiredHolds();
    const layout = repository.findBranchLayout(branchId);
    if (!layout) return this.initializeBranchLayout(branchId, 'template_01');

    const tables = repository.findActiveTables(branchId);
    let canvas = { width: 380, height: 620 };
    let nonTableObjects = [];
    let sections = [];
    try { canvas = JSON.parse(layout.canvas_config || '{}'); } catch (_) {}
    try { nonTableObjects = JSON.parse(layout.non_table_objects_config || '[]'); } catch (_) {}
    try { sections = JSON.parse(layout.sections_config || '[]'); } catch (_) {}

    return { branch_id: branchId, canvas, sections, non_table_objects: nonTableObjects, tables };
  }

  static validateTablesAvailable(branchId, tableIds) {
    this.sweepExpiredHolds();
    if (!Array.isArray(tableIds) || tableIds.length === 0) return { valid: false, error: 'Daftar meja tidak boleh kosong.' };

    for (const tid of tableIds) {
      const row = repository.findTableForBranch(tid, branchId);
      if (!row || !row.is_active) return { valid: false, error: `Meja "${tid}" tidak ditemukan atau tidak aktif di cabang ini.` };
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

  static holdTablesForPayment({ branch_id, table_ids, customer_phone, hold_reference_id }) {
    this.sweepExpiredHolds();
    if (!branch_id || !Array.isArray(table_ids) || table_ids.length === 0) throw new Error('[DiningTableService] branch_id and non-empty table_ids are required.');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000);
    const holdRef = hold_reference_id || `hold_${crypto.randomBytes(6).toString('hex')}`;

    repository.beginTransaction();
    try {
      for (const tid of table_ids) {
        const row = repository.findTableForBranch(tid, branch_id);
        if (!row || !row.is_active) throw new Error(`[TABLE_UNAVAILABLE] Meja "${tid}" tidak aktif atau tidak ditemukan.`);
        if (row.operational_state !== 'available') throw new Error(`[CONCURRENCY_HOLD_CONFLICT] Meja ${row.table_number} baru saja dipilih atau sedang tidak tersedia (${row.operational_state}).`);
      }

      for (const tid of table_ids) {
        const holdId = `bth_${crypto.randomBytes(6).toString('hex')}`;
        repository.insertHold({
          holdId, branchId: branch_id, tableId: tid, customerPhone: customer_phone,
          holdReferenceId: holdRef, expiresAt: expiresAt.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(), status: 'active'
        });
        repository.updateTableOperationalState({ tableId: tid, operationalState: 'held', notes: 'Payment hold', updatedAt: now.toISOString() });
      }

      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return { success: true, hold_reference_id: holdRef, table_ids, expires_at: expiresAt.toISOString(), duration_minutes: HOLD_DURATION_MINUTES };
  }

  static releaseHold({ branch_id, hold_reference_id, reason = 'cancelled' }) {
    if (!hold_reference_id) return { released: 0 };
    const holds = repository.findActiveHolds(hold_reference_id);
    if (!holds || holds.length === 0) return { released: 0 };

    const now = new Date().toISOString();
    repository.beginTransaction();
    try {
      for (const h of holds) {
        repository.updateHoldStatus({ holdId: h.id, status: reason, updatedAt: now });
        repository.updateTableState({ tableId: h.table_id, operationalState: 'available', currentSessionId: null, notes: `Released: ${reason}`, updatedAt: now });
      }
      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      console.error('[DiningTableService] releaseHold error:', err);
      throw err;
    }

    return { released: holds.length };
  }

  static createOrAttachDiningSession({ branch_id, table_ids = [], order_id, customer_name = '', customer_phone = '', guest_count = 1, hold_reference_id = null }) {
    if (!branch_id) throw new Error('[DiningTableService] branch_id is required.');

    const now = new Date().toISOString();
    let sessionId = null;
    repository.beginTransaction();
    try {
      for (const tid of table_ids) {
        const stateRow = repository.findCurrentSessionForTable(tid);
        if (stateRow && stateRow.current_session_id) {
          const session = repository.findDiningSessionById(stateRow.current_session_id);
          if (session) { sessionId = session.id; break; }
        }
      }

      if (!sessionId) {
        sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
        repository.createDiningSession({ sessionId, branchId: branch_id, customerName: customer_name, customerPhone: customer_phone, guestCount: guest_count, openedAt: now, updatedAt: now });
      }

      for (const tid of table_ids) {
        repository.attachDiningSessionTable({ mappingId: `dst_${crypto.randomBytes(6).toString('hex')}`, sessionId, tableId: tid, attachedAt: now });
        repository.updateTableState({ tableId: tid, operationalState: 'occupied', currentSessionId: sessionId, notes: 'Dine-in active', updatedAt: now });
      }

      if (hold_reference_id) {
        const holds = repository.findActiveHolds(hold_reference_id);
        for (const h of holds) repository.updateHoldStatus({ holdId: h.id, status: 'converted', updatedAt: now });
      }
      if (order_id) repository.associateOrderToDiningSession({ orderId: order_id, sessionId, updatedAt: now });
      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return { session_id: sessionId, branch_id, table_ids, status: 'active' };
  }

  static completeDiningSession(sessionId, actorId = 'staff') {
    if (!sessionId) throw new Error('[DiningTableService] sessionId is required.');
    const session = repository.findDiningSession(sessionId);
    if (!session) throw new Error(`[DiningTableService] Sesi meja "${sessionId}" tidak ditemukan.`);
    if (session.status === 'completed') return { success: true, idempotent: true, session_id: sessionId, message: 'Sesi sudah selesai sebelumnya.' };

    const now = new Date().toISOString();
    const associatedTables = repository.findSessionTables(sessionId);
    repository.beginTransaction();
    try {
      repository.completeDiningSession({ sessionId, closedAt: now, updatedAt: now });
      for (const row of associatedTables) repository.updateTableState({ tableId: row.table_id, operationalState: 'available', currentSessionId: null, notes: 'Session completed', updatedAt: now });
      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return { success: true, session_id: sessionId, released_tables: associatedTables.map(t => t.table_id), status: 'completed' };
  }

  static setTableBlockedState(tableId, isBlocked, reason = '') {
    if (!tableId) throw new Error('[DiningTableService] tableId is required.');
    const now = new Date().toISOString();
    const targetState = isBlocked ? 'blocked' : 'available';
    repository.updateTableOperationalState({ tableId, operationalState: targetState, notes: reason || (isBlocked ? 'Blocked by staff' : 'Unblocked by staff'), updatedAt: now });
    return { success: true, table_id: tableId, operational_state: targetState };
  }

  static reassignSessionTables({ session_id, new_table_ids = [] }) {
    if (!session_id || !Array.isArray(new_table_ids) || new_table_ids.length === 0) throw new Error('[DiningTableService] session_id and new_table_ids are required.');
    const session = repository.findDiningSessionById(session_id);
    if (!session) throw new Error(`[DiningTableService] Sesi aktif "${session_id}" tidak ditemukan.`);

    const now = new Date().toISOString();
    repository.beginTransaction();
    try {
      const oldTables = repository.findSessionTables(session_id);
      for (const ot of oldTables) repository.updateTableState({ tableId: ot.table_id, operationalState: 'available', currentSessionId: null, notes: 'Reassigned to another table', updatedAt: now });
      repository.deleteDiningSessionTables(session_id);
      for (const ntid of new_table_ids) {
        repository.attachDiningSessionTable({ mappingId: `dst_${crypto.randomBytes(6).toString('hex')}`, sessionId: session_id, tableId: ntid, attachedAt: now });
        repository.updateTableState({ tableId: ntid, operationalState: 'occupied', currentSessionId: session_id, notes: 'Staff table reassignment', updatedAt: now });
      }
      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return { success: true, session_id, table_ids: new_table_ids };
  }

  static resolveFromQr(qrToken) {
    if (!qrToken) return null;
    return repository.resolveQr(qrToken) || null;
  }

  static regenerateQrToken(tableId) {
    const newQrToken = `qr_${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const result = repository.regenerateQrToken({ tableId, qrToken: newQrToken, updatedAt: now });
    if (!result || result.changes === 0) throw new Error(`[DiningTableService] Meja "${tableId}" tidak ditemukan.`);
    return { table_id: tableId, qr_token: newQrToken };
  }
}

module.exports = DiningTableService;
