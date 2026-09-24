/**
 * Xentra POS Shift Service
 * Orchestrates cashier shift operations: Open Shift, Cash In, Cash Out, and Close Shift with Variance Auditing.
 */
const crypto = require('crypto');
const { events } = require('../../../core');
const { PosShiftRepository } = require('../../../core/data/repositories');
const UserRepository = require('../../../core/data/repositories/UserRepository');
const PosShiftModel = require('../models/PosShiftModel');

const posShiftRepository = new PosShiftRepository();
const userRepository = new UserRepository();

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

    // 1. P1 Cashier Role & Branch Assignment Verification (NEW-03 & NEW-05)
    try {
      const user = userRepository.findById(cashier_id);
      if (user) {
        if (user.role !== 'cashier') {
          throw new Error(`[PosShiftService Role Violation]: User "${cashier_id}" memiliki role "${user.role}". Shift kasir hanya dapat dibuka untuk user dengan role "cashier".`);
        }
        if (user.branch_id && user.branch_id !== branch_id) {
          throw new Error(`[PosShiftService Authorization Breach]: Kasir "${cashier_id}" ditugaskan di cabang "${user.branch_id}" dan tidak berwenang membuka shift di cabang "${branch_id}".`);
        }
      }
    } catch (e) {
      if (e.message.includes('Role Violation') || e.message.includes('Authorization Breach')) throw e;
    }

    // 2. P1 Global Active Shift Invariant: 1 Cashier = Max 1 Open Shift across all branches
    const existingOpenShift = posShiftRepository.findOpenByCashier(cashier_id);

    if (existingOpenShift) {
      throw new Error(`[PosShiftService] Kasir sudah memiliki shift aktif (ID: ${existingOpenShift.id}) di cabang ${existingOpenShift.branch_id}. Tutup shift lama terlebih dahulu.`);
    }

    const shiftId = `shift_${crypto.randomBytes(6).toString('hex')}`;
    const startingFloat = starting_float === undefined || starting_float === null ? 0 : Number(starting_float);
    if (!Number.isFinite(startingFloat) || startingFloat < 0) {
      throw new Error('[PosShiftService] Modal awal kasir (starting_float) wajib bernilai angka non-negatif (>= 0).');
    }
    const now = new Date().toISOString();

    try {
      posShiftRepository.insertShift({ shiftId, branchId: branch_id, cashierId: cashier_id, startingFloat, openedAt: now });
    } catch (err) {
      if (err && err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('constraint failed'))) {
        throw new Error(`[PosShiftService] Kasir "${cashier_id}" sudah memiliki shift aktif (Race Condition Guard). Tutup shift lama terlebih dahulu.`);
      }
      throw err;
    }

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

  static startBreak({ shift_id, actor_id = null, actor_role = null }) {
    if (!shift_id) throw new Error('[PosShiftService] "shift_id" is required to start a break.');
    const shift = posShiftRepository.findById(shift_id);
    if (!shift || shift.status !== 'open') throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    if (actor_role === 'cashier' && actor_id && shift.cashier_id !== actor_id) {
      throw new Error('[PosShiftService Authorization Breach]: Kasir tidak berwenang mengubah shift milik kasir lain.');
    }
    if (posShiftRepository.findActiveBreakByShift(shift_id)) throw new Error('[PosShiftService] Shift sudah dalam status istirahat.');
    const breakId = `break_${crypto.randomBytes(6).toString('hex')}`;
    const startedAt = new Date().toISOString();
    posShiftRepository.insertShiftBreak({ breakId, shiftId: shift_id, startedAt });
    events.EventBus.publish({ type:'pos.shift.break.started', producer:'pos', payload:{shift_id,break_id:breakId,branch_id:shift.branch_id,cashier_id:shift.cashier_id,started_at:startedAt} }).catch(() => {});
    return { id:breakId, shift_id, started_at:startedAt, ended_at:null };
  }

  static endBreak({ shift_id, actor_id = null, actor_role = null }) {
    if (!shift_id) throw new Error('[PosShiftService] "shift_id" is required to end a break.');
    const shift = posShiftRepository.findById(shift_id);
    if (!shift || shift.status !== 'open') throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    if (actor_role === 'cashier' && actor_id && shift.cashier_id !== actor_id) {
      throw new Error('[PosShiftService Authorization Breach]: Kasir tidak berwenang mengubah shift milik kasir lain.');
    }
    const activeBreak = posShiftRepository.findActiveBreakByShift(shift_id);
    if (!activeBreak) throw new Error('[PosShiftService] Shift tidak sedang istirahat.');
    const endedAt = new Date().toISOString();
    const result = posShiftRepository.endShiftBreak({ breakId:activeBreak.id, endedAt });
    if (!result || result.changes !== 1) throw new Error('[PosShiftService] Gagal mengakhiri istirahat.');
    events.EventBus.publish({ type:'pos.shift.break.ended', producer:'pos', payload:{shift_id,break_id:activeBreak.id,branch_id:shift.branch_id,cashier_id:shift.cashier_id,started_at:activeBreak.started_at,ended_at:endedAt} }).catch(() => {});
    return { id:activeBreak.id, shift_id, started_at:activeBreak.started_at, ended_at:endedAt };
  }

  /**
   * Records a manual Cash Movement (Cash In or Cash Out) with Defense-in-Depth Ownership Verification.
   * 
   * @param {Object} params
   * @param {string} params.shift_id
   * @param {'in'|'out'} params.type
   * @param {number} params.amount
   * @param {string} [params.reason='']
   * @param {string} [params.actor_id] - ID of actor requesting the mutation
   * @param {string} [params.actor_role] - Role of actor ('cashier', 'branch_manager', 'owner')
   * @returns {Object} Updated shift summary
   */
  static recordCashMovement({ shift_id, type, amount, reason = '', actor_id = null, actor_role = null }) {
    if (!shift_id || !type || !amount) {
      throw new Error('[PosShiftService] "shift_id", "type", and "amount" are required.');
    }

    const shift = posShiftRepository.findById(shift_id);
    if (!shift || shift.status !== 'open') {
      throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    }
    if (posShiftRepository.findActiveBreakByShift(shift_id)) {
      throw new Error('[PosShiftService] Shift sedang istirahat. Selesaikan istirahat terlebih dahulu.');
    }

    // P1 DOMAIN LEVEL DEFENSE-IN-DEPTH OWNERSHIP GUARD (NEW-01 & NEW-02)
    if (actor_role === 'cashier' && actor_id && shift.cashier_id !== actor_id) {
      throw new Error(`[PosShiftService Authorization Breach]: Kasir "${actor_id}" tidak berwenang mencatat mutasi kas pada shift milik kasir lain ("${shift.cashier_id}").`);
    }

    const moveAmount = Number(amount);
    if (moveAmount <= 0) {
      throw new Error('[PosShiftService] Jumlah kas harus lebih besar dari 0.');
    }

    const movementId = `move_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    let updatedShift = null;

    // P1 ATOMICITY & FINANCIAL RECONCILIATION INVARIANT (NEW-01):
    // Cash movement ledger insert and shift aggregate update MUST commit or rollback together in a single exclusive transaction.
    posShiftRepository.beginTransaction();
    try {
      // Re-verify shift state under lock
      const currentShift = posShiftRepository.findById(shift_id);
      if (!currentShift || currentShift.status !== 'open') {
        throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup oleh proses lain.');
      }

      if (actor_role === 'cashier' && actor_id && currentShift.cashier_id !== actor_id) {
        throw new Error(`[PosShiftService Authorization Breach]: Kasir "${actor_id}" tidak berwenang mencatat mutasi kas pada shift milik kasir lain ("${currentShift.cashier_id}").`);
      }

      // P1 CASH INVENTORY GUARD (NEW-04): Cash out cannot exceed physical cash drawer balance
      if (type === 'out') {
        if (moveAmount > Number(currentShift.expected_cash)) {
          throw new Error(
            `[INSUFFICIENT_DRAWER_CASH]: Pengeluaran kas (Rp ${moveAmount.toLocaleString('id-ID')}) melebihi saldo kas yang tersedia di laci (Rp ${Number(currentShift.expected_cash).toLocaleString('id-ID')}).`
          );
        }
      }

      posShiftRepository.insertCashMovement({ movementId, shiftId: shift_id, type, amount: moveAmount, reason, createdAt: now });

      let updateRes;
      if (type === 'in') {
        updateRes = posShiftRepository.incrementCashIn({ shiftId: shift_id, amount: moveAmount });
      } else {
        updateRes = posShiftRepository.incrementCashOut({ shiftId: shift_id, amount: moveAmount });
      }

      if (!updateRes || updateRes.changes !== 1) {
        throw new Error('[PosShiftService] Gagal mencatat mutasi kas: status shift telah berubah.');
      }

      updatedShift = posShiftRepository.findById(shift_id);
      posShiftRepository.commitTransaction();
    } catch (err) {
      try { posShiftRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return updatedShift;
  }

  /**
   * Closes an active Cashier Shift and calculates Variance with Defense-in-Depth Ownership Verification.
   * 
   * @param {Object} params
   * @param {string} params.shift_id
   * @param {number} params.actual_cash - Actual cash counted by cashier
   * @param {string} [params.actor_id] - ID of actor requesting the shift closure
   * @param {string} [params.actor_role] - Role of actor ('cashier', 'branch_manager', 'owner')
   * @returns {Object} Closed shift record with variance
   */
  static closeShift({ shift_id, actual_cash, actor_id = null, actor_role = null }) {
    if (!shift_id || actual_cash == null) {
      throw new Error('[PosShiftService] "shift_id" and "actual_cash" are required to close a shift.');
    }

    const shift = posShiftRepository.findById(shift_id);
    if (!shift || shift.status !== 'open') {
      throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup.');
    }

    // P1 DOMAIN LEVEL DEFENSE-IN-DEPTH OWNERSHIP GUARD (NEW-01 & NEW-02)
    if (actor_role === 'cashier' && actor_id && shift.cashier_id !== actor_id) {
      throw new Error(`[PosShiftService Authorization Breach]: Kasir "${actor_id}" tidak berwenang menutup shift milik kasir lain ("${shift.cashier_id}").`);
    }

    let closedShiftRecord = null;
    const now = new Date().toISOString();
    let varianceCalc = null;
    let expectedCash = 0;

    posShiftRepository.beginTransaction();
    try {
      // Re-fetch under exclusive lock to guarantee atomic snapshot
      const currentShift = posShiftRepository.findById(shift_id);
      if (!currentShift || currentShift.status !== 'open') {
        throw new Error('[PosShiftService] Shift tidak ditemukan atau sudah ditutup oleh transaksi lain.');
      }

      expectedCash = PosShiftModel.calculateExpectedCash({
        starting_float: currentShift.starting_float,
        total_cash_sales: currentShift.total_cash_sales,
        total_cash_in: currentShift.total_cash_in,
        total_cash_out: currentShift.total_cash_out
      });

      varianceCalc = PosShiftModel.calculateVariance(expectedCash, actual_cash);

      const closeRes = posShiftRepository.closeShift({ shiftId: shift_id, expectedCash, actualCash: Number(actual_cash), variance: varianceCalc.variance, closedAt: now });

      if (!closeRes || closeRes.changes !== 1) {
        throw new Error('[PosShiftService] Gagal menutup shift: status shift telah berubah.');
      }

      closedShiftRecord = posShiftRepository.findById(shift_id);
      posShiftRepository.commitTransaction();
    } catch (err) {
      try { posShiftRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

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

    return closedShiftRecord;
  }
}

module.exports = PosShiftService;
