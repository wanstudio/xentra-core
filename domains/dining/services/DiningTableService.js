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

// Ganti token QR meja setiap sesinya ditutup?
//
// OFF (default), dan itu memang disengaja: kartu QR dicetak SEKALI lalu ditempel
// permanen di meja. Kalau tokennya diganti-ganti, kartu itu mati dan tamu yang
// scan hanya dapat "QR sudah tidak berlaku" — jauh lebih sering bikin rugi
// daripada yang dicegah.
//
// Karena QR-nya permanen, QR ini TIDAK dijadikan kunci: /customer/dining-session/claim
// hanya memberitahu MEJA-nya, tidak membuka tagihan. Melihat tagihan tetap
// berdasarkan identitas tamu (nomor teleponnya sendiri), jadi QR yang pernah
// difoto orang tidak bisa membuka tagihan tamu lain.
//
// Nyalakan (true) hanya kalau resto sanggup mencetak ulang kartu QR setiap sesi
// meja ditutup.
const ROTATE_TABLE_QR_ON_SESSION_CLOSE = false;
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

  /**
   * Resolve and validate the table/session context for a Commerce dine-in order.
   * Commerce owns Order placement; Dining owns table/session business invariants.
   * This method intentionally preserves the pre-extraction response semantics so
   * the migration remains behavior-preserving while the repository access moves
   * behind the Dining boundary.
   */
  static prepareDineInOrderContext({
    branch_id,
    order_channel = 'customer_app',
    customer_phone = null,
    dining_session_id = null,
    table_number = null,
    table_id = null,
    table_ids = null
  } = {}) {
    let effectiveDiningSessionId = dining_session_id || null;
    let resolvedTableNumber = table_number || null;
    const resolvedTableIds = [];

    if (table_id) {
      resolvedTableIds.push(table_id);
    } else if (Array.isArray(table_ids)) {
      resolvedTableIds.push(...table_ids);
    }

    if (order_channel === 'customer_app' && resolvedTableIds.length > 1) {
      return {
        valid: false,
        status: 'SINGLE_TABLE_REQUIRED',
        errors: ['Pesanan dine-in customer hanya diperbolehkan untuk 1 meja.']
      };
    }

    if (resolvedTableIds.length === 0 && resolvedTableNumber) {
      const table = repository.findTableIdByNumberOrLabel(branch_id, resolvedTableNumber);
      if (table) resolvedTableIds.push(table.id);
    }

    if (resolvedTableIds.length === 0 && !resolvedTableNumber && order_channel === 'customer_app') {
      return {
        valid: false,
        status: 'TABLE_REQUIRED',
        errors: ['Meja (table_number atau table_ids) wajib disertakan untuk pesanan dine-in.']
      };
    }

    // Validate table identity and branch scope here, not inside Commerce.
    for (const tid of resolvedTableIds) {
      const tableRow = repository.findTableForBranch(tid, branch_id);
      if (!tableRow || !tableRow.is_active) {
        return {
          valid: false,
          status: 'BRANCH_TABLE_MISMATCH',
          errors: [`Meja "${tid}" tidak ditemukan atau tidak aktif pada cabang ini.`]
        };
      }
      if (!resolvedTableNumber) resolvedTableNumber = tableRow.table_number;
    }

    if (resolvedTableNumber && resolvedTableIds.length === 0) {
      return {
        valid: false,
        status: 'BRANCH_TABLE_MISMATCH',
        errors: [`Meja "${resolvedTableNumber}" tidak ditemukan pada cabang ini.`]
      };
    }

    const authenticatedCustomerPhone = customer_phone ? String(customer_phone).trim() : null;

    // A customer may not keep multiple pending dine-in table contexts at once.
    if (order_channel === 'customer_app' && authenticatedCustomerPhone) {
      const existingHold = repository.findActiveHoldByCustomer(branch_id, authenticatedCustomerPhone);
      if (existingHold) {
        const isDifferentTable = resolvedTableIds.some(tid => tid !== existingHold.table_id);
        if (isDifferentTable) {
          return {
            valid: false,
            status: 'CUSTOMER_PENDING_HOLD_EXISTS',
            errors: ['Anda sudah memiliki pesanan meja yang sedang menunggu konfirmasi pada meja lain di cabang ini. Batalkan pesanan sebelumnya jika ingin berpindah meja.']
          };
        }
      }
    }

    if (effectiveDiningSessionId) {
      const session = repository.findDiningSession(effectiveDiningSessionId);
      if (!session) {
        return {
          valid: false,
          status: 'SESSION_NOT_FOUND',
          errors: [`Sesi meja "${effectiveDiningSessionId}" tidak ditemukan.`]
        };
      }
      if (session.branch_id !== branch_id) {
        return {
          valid: false,
          status: 'BRANCH_SESSION_MISMATCH',
          errors: [`Sesi meja "${effectiveDiningSessionId}" bukan milik cabang ini.`]
        };
      }
      if (session.status !== 'active') {
        return {
          valid: false,
          status: 'COMPLETED_SESSION_REUSE_REJECTED',
          errors: [`Sesi meja "${effectiveDiningSessionId}" sudah ditutup (${session.status}) dan tidak dapat digunakan kembali.`]
        };
      }
      if (order_channel === 'customer_app' && session.customer_phone && authenticatedCustomerPhone && session.customer_phone !== authenticatedCustomerPhone) {
        return {
          valid: false,
          status: 'UNAUTHORIZED_SESSION_ACCESS',
          errors: ['Sesi meja ini milik pelanggan lain. Anda tidak dapat bergabung atau membuat pesanan pada sesi ini.']
        };
      }

      const sessionTableIds = repository.findSessionTables(session.id).map(row => row.table_id);
      if (resolvedTableIds.length > 0) {
        const mismatch = resolvedTableIds.some(tid => !sessionTableIds.includes(tid));
        if (mismatch) {
          return {
            valid: false,
            status: 'TABLE_SESSION_MISMATCH',
            errors: ['Meja yang dipesan tidak sesuai dengan meja pada sesi aktif ini.']
          };
        }
      }
    } else if (order_channel === 'customer_app' && authenticatedCustomerPhone) {
      const existingSession = repository.findActiveSessionByCustomer(branch_id, authenticatedCustomerPhone);
      if (existingSession) {
        const sessionTableIds = repository.findSessionTables(existingSession.id).map(row => row.table_id);
        if (resolvedTableIds.length > 0) {
          const isSelfTransfer = resolvedTableIds.some(tid => !sessionTableIds.includes(tid));
          if (isSelfTransfer) {
            return {
              valid: false,
              status: 'CUSTOMER_TABLE_TRANSFER_FORBIDDEN',
              errors: ['Anda sudah memiliki sesi aktif di meja lain pada cabang ini. Pelanggan tidak diizinkan memindahkan meja sendiri. Silakan hubungi kasir/staf untuk pindah meja.']
            };
          }
        }
        effectiveDiningSessionId = existingSession.id;
      } else {
        for (const tid of resolvedTableIds) {
          const currentTable = repository.findCurrentSessionForTable(tid);
          if (currentTable && currentTable.operational_state === 'occupied' && currentTable.current_session_id) {
            const activeSession = repository.findDiningSessionById(currentTable.current_session_id);
            if (activeSession && activeSession.status === 'active' && activeSession.customer_phone !== authenticatedCustomerPhone) {
              return {
                valid: false,
                status: 'TABLE_ALREADY_OCCUPIED',
                errors: ['Meja sedang digunakan oleh pelanggan lain.']
              };
            }
          }
        }
      }
    }

    return {
      valid: true,
      dining_session_id: effectiveDiningSessionId,
      table_number: resolvedTableNumber,
      table_ids: resolvedTableIds
    };
  }

  static validateTablesAvailable(branchId, tableIds, customerPhone = null) {
    this.sweepExpiredHolds();
    if (!Array.isArray(tableIds) || tableIds.length === 0) return { valid: false, error: 'Daftar meja tidak boleh kosong.' };

    for (const tid of tableIds) {
      const row = repository.findTableForBranch(tid, branchId);
      if (!row || !row.is_active) return { valid: false, error: `Meja "${tid}" tidak ditemukan atau tidak aktif di cabang ini.` };
      if (row.operational_state !== 'available') {
        let isOwnActiveSession = false;
        if (row.operational_state === 'occupied' && customerPhone) {
          const sessRow = repository.findCurrentSessionForTable(tid);
          if (sessRow && sessRow.current_session_id) {
            const session = repository.findDiningSessionById(sessRow.current_session_id);
            if (session && session.status === 'active' && session.customer_phone === customerPhone) {
              isOwnActiveSession = true;
            }
          }
        }
        if (!isOwnActiveSession) {
          return {
            valid: false,
            error: `Meja ${row.table_number} sedang tidak tersedia (${row.operational_state}). Silakan pilih meja lain.`,
            unavailable_table_id: row.id,
            state: row.operational_state
          };
        }
      }
    }
    return { valid: true };
  }

  static holdTablesForPayment({ branch_id, table_id = null, table_ids = [], customer_phone = null, hold_reference_id = null, channel = null }) {
    this.sweepExpiredHolds();

    let resolvedTableIds = [];
    if (table_id) resolvedTableIds.push(table_id);
    else if (Array.isArray(table_ids)) resolvedTableIds = [...table_ids];

    if (!branch_id || resolvedTableIds.length === 0) throw new Error('[DiningTableService] branch_id and non-empty table_ids are required.');

    if (channel === 'customer_app' && resolvedTableIds.length > 1) {
      throw new Error('[DiningTableService] SINGLE_TABLE_REQUIRED: Customer dine-in hanya diperbolehkan untuk 1 meja.');
    }

    const cleanCustomerPhone = customer_phone ? String(customer_phone).trim() : '';

    // Customer ownership & self-transfer invariant:
    // If customer already has an active session at this branch, they cannot hold a different table.
    if (cleanCustomerPhone) {
      const existingSession = repository.findActiveSessionByCustomer(branch_id, cleanCustomerPhone);
      if (existingSession) {
        const sessTables = repository.findSessionTables(existingSession.id).map(r => r.table_id);
        const isSelfTransfer = resolvedTableIds.some(tid => !sessTables.includes(tid));
        if (isSelfTransfer) {
          throw new Error('[DiningTableService] CUSTOMER_TABLE_TRANSFER_FORBIDDEN: Anda sudah memiliki sesi aktif di meja lain pada cabang ini. Pelanggan tidak diizinkan memindahkan meja sendiri. Silakan hubungi kasir/staf untuk pindah meja.');
        }
      }

      const existingHold = repository.findActiveHoldByCustomer(branch_id, cleanCustomerPhone);
      if (existingHold && (!hold_reference_id || existingHold.hold_reference_id !== hold_reference_id)) {
        const isDiffTable = resolvedTableIds.some(tid => tid !== existingHold.table_id);
        if (isDiffTable) {
          throw new Error('[DiningTableService] CUSTOMER_PENDING_HOLD_EXISTS: Anda sudah memiliki pesanan meja yang sedang menunggu konfirmasi pada meja lain di cabang ini. Batalkan pesanan sebelumnya jika ingin berpindah meja.');
        }
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * 60 * 1000);
    const holdRef = hold_reference_id || `hold_${crypto.randomBytes(6).toString('hex')}`;

    repository.beginTransaction();
    try {
      for (const tid of resolvedTableIds) {
        const row = repository.findTableForBranch(tid, branch_id);
        if (!row || !row.is_active) throw new Error(`[TABLE_UNAVAILABLE] Meja "${tid}" tidak aktif atau tidak ditemukan.`);
        if (row.operational_state !== 'available') {
          let isOwnActiveSession = false;
          if (row.operational_state === 'occupied' && cleanCustomerPhone) {
            const sessRow = repository.findCurrentSessionForTable(tid);
            if (sessRow && sessRow.current_session_id) {
              const session = repository.findDiningSessionById(sessRow.current_session_id);
              if (session && session.status === 'active' && session.customer_phone === cleanCustomerPhone) {
                isOwnActiveSession = true;
              }
            }
          }
          if (!isOwnActiveSession) {
            throw new Error(`[CONCURRENCY_HOLD_CONFLICT] Meja ${row.table_number} baru saja dipilih atau sedang tidak tersedia (${row.operational_state}).`);
          }
        }
      }

      for (const tid of resolvedTableIds) {
        const row = repository.findTableForBranch(tid, branch_id);
        if (row && row.operational_state !== 'occupied') {
          const holdId = `bth_${crypto.randomBytes(6).toString('hex')}`;
          repository.insertHold({
            holdId, branchId: branch_id, tableId: tid, customerPhone: cleanCustomerPhone,
            holdReferenceId: holdRef, expiresAt: expiresAt.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(), status: 'active'
          });
          repository.updateTableOperationalState({ tableId: tid, operationalState: 'held', notes: 'Payment hold', updatedAt: now.toISOString() });
        }
      }

      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return { success: true, hold_reference_id: holdRef, table_ids: resolvedTableIds, expires_at: expiresAt.toISOString(), duration_minutes: HOLD_DURATION_MINUTES };
  }

  static releaseHold({ branch_id, hold_reference_id, reason = 'cancelled' }, { dbTransactionProvided = false } = {}) {
    if (!hold_reference_id) return { released: 0 };
    const holds = repository.findActiveHolds(hold_reference_id);
    if (!holds || holds.length === 0) return { released: 0 };

    const now = new Date().toISOString();
    const ownsTransaction = !dbTransactionProvided;
    if (ownsTransaction) repository.beginTransaction();
    try {
      for (const h of holds) {
        repository.updateHoldStatus({ holdId: h.id, status: reason, updatedAt: now });
        repository.updateTableState({ tableId: h.table_id, operationalState: 'available', currentSessionId: null, notes: `Released: ${reason}`, updatedAt: now });
      }
      if (ownsTransaction) repository.commitTransaction();
    } catch (err) {
      if (ownsTransaction) {
        try { repository.rollbackTransaction(); } catch (_) {}
      }
      console.error('[DiningTableService] releaseHold error:', err);
      throw err;
    }

    return { released: holds.length };
  }

  static createOrAttachDiningSession({
    branch_id,
    table_id = null,
    table_ids = [],
    order_id = null,
    customer_name = '',
    customer_phone = '',
    guest_count = 1,
    hold_reference_id = null,
    channel = null,
    session_id = null
  }, { dbTransactionProvided = false } = {}) {
    if (!branch_id) throw new Error('[DiningTableService] branch_id is required.');

    let resolvedTableIds = [];
    if (table_id) resolvedTableIds.push(table_id);
    else if (Array.isArray(table_ids)) resolvedTableIds = [...table_ids];

    if (channel === 'customer_app' && resolvedTableIds.length > 1) {
      throw new Error('[DiningTableService] SINGLE_TABLE_REQUIRED: Customer dine-in hanya diperbolehkan untuk 1 meja.');
    }

    const now = new Date().toISOString();
    const cleanCustomerPhone = customer_phone ? String(customer_phone).trim() : '';

    const ownsTransaction = !dbTransactionProvided;
    if (ownsTransaction) repository.beginTransaction();
    let sessionId = null;

    try {
      // 1. Validate every table belongs to branch_id and is active
      for (const tid of resolvedTableIds) {
        const tableRow = repository.findTableForBranch(tid, branch_id);
        if (!tableRow || !tableRow.is_active) {
          throw new Error(`[DiningTableService] BRANCH_TABLE_MISMATCH: Meja "${tid}" tidak ditemukan atau tidak aktif di cabang "${branch_id}".`);
        }
      }

      // 2. If caller provided an explicit session_id:
      if (session_id) {
        const session = repository.findDiningSession(session_id);
        if (!session) {
          throw new Error(`[DiningTableService] SESSION_NOT_FOUND: Sesi "${session_id}" tidak ditemukan.`);
        }
        if (session.branch_id !== branch_id) {
          throw new Error(`[DiningTableService] BRANCH_SESSION_MISMATCH: Sesi "${session_id}" bukan milik cabang "${branch_id}".`);
        }
        if (session.status !== 'active') {
          throw new Error(`[DiningTableService] COMPLETED_SESSION_REUSE_REJECTED: Sesi "${session_id}" sudah ditutup (${session.status}) dan tidak dapat digunakan kembali.`);
        }
        if (channel === 'customer_app' && session.customer_phone && cleanCustomerPhone && session.customer_phone !== cleanCustomerPhone) {
          throw new Error(`[DiningTableService] UNAUTHORIZED_SESSION_ACCESS: Sesi meja "${session_id}" milik pelanggan lain.`);
        }

        const sessionTableIds = repository.findSessionTables(session.id).map(r => r.table_id);
        if (resolvedTableIds.length > 0) {
          const mismatch = resolvedTableIds.some(tid => !sessionTableIds.includes(tid));
          if (mismatch) {
            throw new Error(`[DiningTableService] TABLE_SESSION_MISMATCH: Meja yang diminta tidak sesuai dengan meja pada sesi aktif "${session_id}".`);
          }
        }
        sessionId = session.id;
      }

      // 3. If no explicit session_id, check if customer already has an active session at branch_id:
      if (!sessionId && cleanCustomerPhone) {
        const existingCustSession = repository.findActiveSessionByCustomer(branch_id, cleanCustomerPhone);
        if (existingCustSession) {
          const custTables = repository.findSessionTables(existingCustSession.id).map(r => r.table_id);
          if (resolvedTableIds.length > 0) {
            const isSelfTransfer = resolvedTableIds.some(tid => !custTables.includes(tid));
            if (isSelfTransfer) {
              throw new Error(`[DiningTableService] CUSTOMER_TABLE_TRANSFER_FORBIDDEN: Anda sudah memiliki sesi aktif di meja lain pada cabang ini. Pelanggan tidak diizinkan memindahkan meja sendiri. Silakan hubungi kasir/staf untuk pindah meja.`);
            }
          }
          sessionId = existingCustSession.id;
        }
      }

      // 4. If still no sessionId, we are creating a new session.
      // Must check table concurrency atomically inside transaction!
      if (!sessionId) {
        for (const tid of resolvedTableIds) {
          const stateRow = repository.findCurrentSessionForTable(tid);
          if (stateRow) {
            if (stateRow.operational_state === 'occupied' && stateRow.current_session_id) {
              const occSession = repository.findDiningSessionById(stateRow.current_session_id);
              if (occSession && occSession.status === 'active') {
                if (!cleanCustomerPhone || occSession.customer_phone !== cleanCustomerPhone) {
                  throw new Error(`[DiningTableService] TABLE_ALREADY_OCCUPIED: Meja "${tid}" sedang digunakan oleh pelanggan lain.`);
                }
              }
            } else if (stateRow.operational_state === 'held') {
              if (hold_reference_id) {
                const holds = repository.findActiveHolds(hold_reference_id);
                const hasHold = holds.some(h => h.table_id === tid);
                if (!hasHold) {
                  throw new Error(`[DiningTableService] TABLE_HELD_BY_ANOTHER: Meja "${tid}" sedang ditahan untuk transaksi lain.`);
                }
              } else {
                throw new Error(`[DiningTableService] TABLE_HELD_BY_ANOTHER: Meja "${tid}" sedang dalam proses pembayaran transaksi lain.`);
              }
            } else if (stateRow.operational_state === 'blocked' || stateRow.operational_state === 'out_of_service') {
              throw new Error(`[DiningTableService] TABLE_BLOCKED: Meja "${tid}" sedang diblokir/tidak dapat digunakan.`);
            }
          }
        }

        sessionId = `sess_${crypto.randomBytes(6).toString('hex')}`;
        repository.createDiningSession({
          sessionId,
          branchId: branch_id,
          customerName: customer_name,
          customerPhone: cleanCustomerPhone,
          guestCount: guest_count,
          channel: channel || 'customer_app',
          openedAt: now,
          updatedAt: now
        });
      }

      // 5. Attach tables & set state to occupied
      for (const tid of resolvedTableIds) {
        repository.attachDiningSessionTable({
          mappingId: `dst_${crypto.randomBytes(6).toString('hex')}`,
          sessionId,
          tableId: tid,
          attachedAt: now
        });
        repository.updateTableState({
          tableId: tid,
          operationalState: 'occupied',
          currentSessionId: sessionId,
          notes: 'Dine-in active',
          updatedAt: now
        });
      }

      // 6. Convert holds if hold_reference_id provided
      if (hold_reference_id) {
        const holds = repository.findActiveHolds(hold_reference_id);
        for (const h of holds) {
          repository.updateHoldStatus({ holdId: h.id, status: 'converted', updatedAt: now });
        }
      }

      // 7. Associate order if order_id provided
      if (order_id) {
        repository.associateOrderToDiningSession({ orderId: order_id, sessionId, updatedAt: now });
      }

      if (ownsTransaction) repository.commitTransaction();
    } catch (err) {
      if (ownsTransaction) {
        try { repository.rollbackTransaction(); } catch (_) {}
      }
      throw err;
    }

    return { session_id: sessionId, branch_id, table_ids: resolvedTableIds, status: 'active' };
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

    const releasedTables = associatedTables.map(t => t.table_id);

    // Meja sudah bebas: kunci lama tidak boleh lagi bisa membuka tagihan tamu
    // berikutnya di meja ini.
    if (ROTATE_TABLE_QR_ON_SESSION_CLOSE) {
      for (const tableId of releasedTables) {
        try {
          DiningTableService.regenerateQrToken(tableId);
        } catch (err) {
          console.warn('[DiningTableService] Gagal mengganti token QR meja', tableId, ':', err.message);
        }
      }
    }

    return { success: true, session_id: sessionId, released_tables: releasedTables, status: 'completed' };
  }

  static setTableBlockedState(tableId, isBlocked, reason = '') {
    if (!tableId) throw new Error('[DiningTableService] tableId is required.');
    const now = new Date().toISOString();
    const targetState = isBlocked ? 'blocked' : 'available';
    repository.updateTableOperationalState({ tableId, operationalState: targetState, notes: reason || (isBlocked ? 'Blocked by staff' : 'Unblocked by staff'), updatedAt: now });
    return { success: true, table_id: tableId, operational_state: targetState };
  }

  static reassignSessionTables({ session_id, new_table_ids = [], actor = null }) {
    if (!actor || !['owner', 'brand_manager', 'branch_manager', 'cashier'].includes(actor.role)) {
      throw new Error('[DiningTableService] UNAUTHORIZED_REASSIGNMENT: Pemindahan meja hanya dapat dilakukan oleh staf atau kasir yang berwenang.');
    }
    if (!session_id || !Array.isArray(new_table_ids) || new_table_ids.length === 0) {
      throw new Error('[DiningTableService] session_id and non-empty new_table_ids are required.');
    }
    const session = repository.findDiningSession(session_id);
    if (!session) {
      throw new Error(`[DiningTableService] Sesi "${session_id}" tidak ditemukan.`);
    }
    if (session.status !== 'active') {
      throw new Error(`[DiningTableService] SESSION_NOT_ACTIVE: Sesi "${session_id}" sudah ditutup (${session.status}) dan tidak dapat dipindahkan.`);
    }

    if (['branch_manager', 'cashier'].includes(actor.role)) {
      const actorBranchId = actor.branchId || actor.branch_id;
      if (actorBranchId && actorBranchId !== session.branch_id) {
        throw new Error('[DiningTableService] FORBIDDEN_BRANCH_SCOPE: Staf tidak memiliki kewenangan pada cabang sesi ini.');
      }
    }

    const now = new Date().toISOString();
    repository.beginTransaction();
    try {
      // Validate every target table
      for (const ntid of new_table_ids) {
        const row = repository.findTableForBranch(ntid, session.branch_id);
        if (!row || !row.is_active) {
          throw new Error(`[DiningTableService] BRANCH_TABLE_MISMATCH: Meja tujuan "${ntid}" tidak ditemukan atau tidak aktif di cabang ini.`);
        }
        if (row.operational_state === 'blocked' || row.operational_state === 'out_of_service') {
          throw new Error(`[DiningTableService] TARGET_TABLE_UNAVAILABLE: Meja tujuan "${row.table_number || ntid}" sedang diblokir/rusak.`);
        }
        if (row.operational_state === 'occupied' && row.current_session_id && row.current_session_id !== session_id) {
          throw new Error(`[DiningTableService] TARGET_TABLE_UNAVAILABLE: Meja tujuan "${row.table_number || ntid}" sedang digunakan oleh sesi lain.`);
        }
        if (row.operational_state === 'held') {
          throw new Error(`[DiningTableService] TARGET_TABLE_HELD: Meja tujuan "${row.table_number || ntid}" sedang ditahan untuk transaksi pembayaran.`);
        }
      }

      const oldTables = repository.findSessionTables(session_id);
      for (const ot of oldTables) {
        if (!new_table_ids.includes(ot.table_id)) {
          repository.updateTableState({ tableId: ot.table_id, operationalState: 'available', currentSessionId: null, notes: 'Reassigned to another table', updatedAt: now });
        }
      }
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
