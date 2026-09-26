'use strict';

/**
 * POS Payment Group service.
 *
 * Combines multiple whole dine-in Orders for one physical settlement while
 * preserving every Order, table context, Dining Session and audit trail.
 */
const crypto = require('crypto');
const {
  PosPaymentGroupRepository,
  PosBillRepository,
  OrderRepository,
  PaymentRepository,
  PosShiftRepository
} = require('../../../core/data/repositories');

const repository = new PosPaymentGroupRepository();
const posBillRepository = new PosBillRepository();
const orderRepository = new OrderRepository();
const paymentRepository = new PaymentRepository();
const posShiftRepository = new PosShiftRepository();

const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired', 'rejected', 'timeout', 'fulfillment_exception'];

function hasSettlementPayment(orderId) {
  const payment = paymentRepository.findPaymentByOrderId(orderId);
  if (payment && payment.payment_status === 'settlement') return true;
  const row = require('../../../core/data/DataAccess').queryOne(
    "SELECT COALESCE(SUM(amount), 0) AS amount FROM pos_check_payments WHERE order_id = ? AND payment_status = 'settlement'",
    [orderId]
  );
  return Number(row && row.amount) > 0;
}

class PosPaymentGroupService {
  static _validateEligibleOrder(order, branchId) {
    if (!order) throw new Error('[PosPaymentGroupService] Tagihan tidak ditemukan.');
    if (String(order.branch_id) !== String(branchId)) throw new Error('[PosPaymentGroupService] Semua tagihan harus berasal dari cabang yang sama.');
    if (order.order_type !== 'dine_in') throw new Error('[PosPaymentGroupService] Gabungan Tagihan hanya mendukung order dine-in.');
    if (order.status === 'pending') throw new Error('[PosPaymentGroupService] Semua order harus sudah diterima merchant.');
    if (TERMINAL_STATUSES.includes(order.status)) throw new Error('[PosPaymentGroupService] Salah satu tagihan sudah tidak dapat dibayar.');
    if (order.payment_method && order.payment_method !== 'cash') throw new Error('[PosPaymentGroupService] Gabungan Tagihan saat ini hanya mendukung order Cash.');
    if (hasSettlementPayment(order.id)) throw new Error('[PosPaymentGroupService] Salah satu tagihan sudah lunas atau menerima pembayaran.');

    const checkCountRow = require('../../../core/data/DataAccess').queryOne(
      'SELECT COUNT(*) AS count FROM pos_order_checks WHERE order_id = ?',
      [order.id]
    );
    if (Number(checkCountRow && checkCountRow.count) > 1) {
      throw new Error('[PosPaymentGroupService] Tagihan yang sudah dibagi tidak dapat digabungkan. Selesaikan pembagian terlebih dahulu.');
    }

    const amount = Number(order.grand_total);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('[PosPaymentGroupService] Tagihan tidak memiliki nominal yang valid.');
    return amount;
  }

  static _ensureWholeOrderCheck(order, now) {
    let checks = posBillRepository.findChecks(order.id);
    if (checks.length) return checks[0];

    const items = posBillRepository.findOrderItems(order.id);
    if (!items.length) throw new Error('[PosPaymentGroupService] Order tidak memiliki item yang dapat dibayar.');

    const checkId = 'check_' + crypto.randomBytes(8).toString('hex');
    posBillRepository.createCheck({
      id: checkId,
      orderId: order.id,
      checkNumber: 1,
      allocatedAmount: Number(order.grand_total),
      now
    });
    for (const item of items) {
      posBillRepository.upsertCheckItem({
        id: 'check_item_' + crypto.randomBytes(8).toString('hex'),
        checkId,
        orderItemId: item.id,
        quantity: Number(item.quantity),
        now
      });
    }
    return posBillRepository.findCheck(checkId);
  }

  static getCandidates({ order_id, branch_id }) {
    const current = orderRepository.findById(order_id);
    this._validateEligibleOrder(current, branch_id);
    if (repository.findActiveGroupForOrder(order_id)) {
      throw new Error('[PosPaymentGroupService] Order sudah masuk ke Gabungan Tagihan yang masih terbuka.');
    }
    return {
      order: current,
      candidates: repository.findEligibleCandidates({ branchId: branch_id, currentOrderId: order_id })
    };
  }

  static createGroup({ order_id, branch_id, order_ids = [], actor_id = null }) {
    const selected = Array.from(new Set([String(order_id), ...order_ids.map(String)])).filter(Boolean);
    if (selected.length < 2) throw new Error('[PosPaymentGroupService] Pilih minimal 1 tagihan lain untuk membuat Gabungan Tagihan.');

    const now = new Date().toISOString();
    const groupId = 'pg_' + crypto.randomBytes(7).toString('hex');
    const groupNumber = 'GRP-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

    repository.beginTransaction();
    try {
      const rows = [];
      let total = 0;
      let brandId = null;
      for (const id of selected) {
        const order = orderRepository.findById(id);
        const amount = this._validateEligibleOrder(order, branch_id);
        if (brandId === null) brandId = order.brand_id;
        if (String(order.brand_id) !== String(brandId)) throw new Error('[PosPaymentGroupService] Semua tagihan harus berasal dari brand yang sama.');

        if (repository.findActiveGroupForOrder(id)) {
          throw new Error('[PosPaymentGroupService] Salah satu tagihan sudah berada di Gabungan Tagihan lain.');
        }

        const check = this._ensureWholeOrderCheck(order, now);
        if (!check) throw new Error('[PosPaymentGroupService] Check utama gagal dibuat.');

        total += amount;
        rows.push({ id, amount });
      }

      repository.createGroup({
        id: groupId,
        groupNumber,
        brandId,
        branchId: branch_id,
        totalAmount: total,
        createdBy: actor_id,
        now
      });

      rows.forEach(row => repository.addOrder({
        groupId,
        orderId: row.id,
        allocatedAmount: row.amount,
        now
      }));

      repository.commitTransaction();
    } catch (err) {
      try { repository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return this.getGroup({ group_id: groupId, branch_id });
  }

  static getGroup({ group_id, branch_id }) {
    const group = repository.findGroup(group_id);
    if (!group) throw new Error('[PosPaymentGroupService] Gabungan Tagihan tidak ditemukan.');
    if (String(group.branch_id) !== String(branch_id)) throw new Error('[PosPaymentGroupService] Gabungan Tagihan bukan milik cabang kasir ini.');
    return { group, orders: repository.findGroupOrders(group_id) };
  }

  static settleCashGroup({ group_id = null, order_id = null, order_ids = [], actor_id = null, branch_id, cashier_id = null, shift_id, amount_tendered }) {
    const actor = cashier_id || actor_id;
    let groupId = group_id;
    if (!groupId) {
      if (!order_id) throw new Error('[PosPaymentGroupService] group_id atau order_id wajib diisi.');
      const created = this.createGroup({ order_id, branch_id, order_ids, actor_id: actor });
      groupId = created.group.id;
    }
    const group = repository.findGroup(groupId);
    if (!group) throw new Error('[PosPaymentGroupService] Gabungan Tagihan tidak ditemukan.');
    if (String(group.branch_id) !== String(branch_id)) throw new Error('[PosPaymentGroupService] Gabungan Tagihan bukan milik cabang ini.');
    if (group.status !== 'open') {
      if (group.status === 'settled') {
        return { success: true, idempotent: true, group: this.getGroup({ group_id: groupId, branch_id }).group };
      }
      throw new Error('[PosPaymentGroupService] Gabungan Tagihan sudah tidak dapat dibayar.');
    }

    const tendered = Number(amount_tendered);
    const members = repository.findGroupOrders(groupId);
    if (members.length < 2) throw new Error('[PosPaymentGroupService] Gabungan Tagihan membutuhkan minimal dua order.');
    const total = members.reduce((sum, row) => sum + (Number(row.allocated_amount) || 0), 0);
    if (Math.round(total) !== Math.round(Number(group.total_amount))) throw new Error('[PosPaymentGroupService] Total Gabungan Tagihan tidak konsisten.');
    if (!Number.isFinite(tendered) || tendered <= 0 || tendered < total) throw new Error('[PosPaymentGroupService] Uang diterima belum mencukupi total Gabungan Tagihan.');

    const shift = posShiftRepository.findById(shift_id);
    if (!shift || shift.status !== 'open' || String(shift.branch_id) !== String(branch_id) || (actor && String(shift.cashier_id) !== String(actor))) {
      throw new Error('[PosPaymentGroupService] Shift kasir aktif tidak valid.');
    }

    const { CashSettlementService } = require('../../payment');
    const now = new Date().toISOString();
    const groupPaymentId = 'pgpay_' + crypto.randomBytes(7).toString('hex');
    const change = tendered - total;

    paymentRepository.beginTransaction();
    try {
      const lockedGroup = repository.findGroup(groupId);
      if (!lockedGroup || lockedGroup.status !== 'open') throw new Error('[PosPaymentGroupService] Gabungan Tagihan sudah diproses oleh kasir lain.');

      const lockedShift = posShiftRepository.findStatusById(shift_id);
      if (!lockedShift || lockedShift.status !== 'open') throw new Error('[PosPaymentGroupService] Shift kasir sudah ditutup.');

      // One physical payment increments the shift exactly once.
      const shiftUpdate = posShiftRepository.incrementCashSales({ shiftId: shift_id, branchId: branch_id, amount: total });
      if (!shiftUpdate || shiftUpdate.changes !== 1) throw new Error('[PosPaymentGroupService] Gagal mencatat penerimaan kas pada shift.');

      for (const member of members) {
        const result = CashSettlementService.settleCashPayment({
          order_id: member.order_id,
          amount: Number(member.allocated_amount),
          amount_tendered: Number(member.allocated_amount),
          cashier_id: actor,
          shift_id,
          skip_shift_increment: true,
          manage_transaction: false,
          payment_group_id: groupId
        });
        if (!result || !result.success) throw new Error('[PosPaymentGroupService] Gagal melunasi salah satu tagihan anggota.');
      }

      repository.createPayment({
        id: groupPaymentId,
        groupId,
        paymentMethod: 'cash',
        provider: 'cash',
        amount: total,
        amountTendered: tendered,
        changeAmount: change,
        actorId: actor,
        shiftId: shift_id,
        settledAt: now,
        now
      });
      repository.markGroupSettled(groupId, now);
      paymentRepository.commitTransaction();
    } catch (err) {
      try { paymentRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    return {
      success: true,
      payment_group_id: groupId,
      payment_id: groupPaymentId,
      amount: total,
      amount_tendered: tendered,
      change,
      group: this.getGroup({ group_id: groupId, branch_id }).group
    };
  }
}

module.exports = PosPaymentGroupService;
