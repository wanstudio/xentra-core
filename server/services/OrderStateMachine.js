const { OrderRepository } = require('../../core/data/repositories');
const crypto = require('crypto');

const orderRepository = new OrderRepository();

class OrderStateMachine {
  // P1 SEPARATION OF CONCERNS: Operational transitions strictly exclude financial 'refunded'
  // R5/R6/R7 ORDER BOUNDARY mapping (locked decisions):
  //   pending  = CREATED / AWAITING_BRANCH_ACCEPTANCE
  //   confirmed = ACCEPTED (branch accept — locked operational acceptance state)
  //   rejected  = REJECTED (branch reject, terminal; distinct from 'cancelled')
  //   timeout   = BRANCH_TIMEOUT (R6: platform 3-minute acceptance timeout,
  //               applied by the server-authoritative AcceptanceTimeoutService;
  //               terminal; distinct from rejected/cancelled)
  //   cancelled = customer cancellation (CUSTOMER_CANCEL, R7 — only valid from
  //               pending, enforced server-side) OR system/manager cancellation.
  // Actor semantics are NEVER collapsed: the audit log records actor_type
  // (customer / branch_actor / system / staff) + actor_id + a [CLASS] note so
  // CUSTOMER_CANCEL, BRANCH_REJECT, BRANCH_TIMEOUT, SYSTEM_CANCEL and
  // PAYMENT_FAILURE remain distinguishable.
  static VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled', 'rejected', 'timeout'],
    confirmed: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['out_for_delivery', 'completed', 'cancelled'],
    out_for_delivery: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    refunded: [],
    rejected: [],
    timeout: []
  };

  static canTransition(currentStatus, targetStatus) {
    const allowed = this.VALID_TRANSITIONS[currentStatus] || [];
    return allowed.includes(targetStatus);
  }

  static transition(params) {
    const { order_id, target_status, actor_type = 'system', actor_id = null, note = '', expected_current_status = null } = params;

    orderRepository.beginTransaction();
    let currentStatus = null;
    try {
      const order = orderRepository.findById(order_id);
      if (!order) {
        throw new Error(`Pesanan dengan ID "${order_id}" tidak ditemukan.`);
      }

      currentStatus = order.status;

      if (expected_current_status != null && String(order.status) !== String(expected_current_status)) {
        throw new Error(
          `[STATE_CHANGED]: Status pesanan "${order_id}" sudah berubah dari "${expected_current_status}" menjadi "${order.status}". Operasi dibatalkan.`
        );
      }

      if (!this.canTransition(currentStatus, target_status)) {
        throw new Error(
          `Perubahan status pesanan tidak valid: dari "${currentStatus}" ke "${target_status}".`
        );
      }

      if (target_status === 'cancelled' || target_status === 'rejected' || target_status === 'timeout') {
        const settledPayment = orderRepository.findPaymentSettlement(order_id);

        if (settledPayment) {
          const action = target_status === 'rejected'
            ? 'Penolakan oleh cabang'
            : (target_status === 'timeout'
                ? 'Timeout penerimaan otomatis'
                : 'Pembatalan operasional');
          throw new Error(
            `[ORDER_ALREADY_PAID]: Pesanan "${order_id}" sudah dibayar lunas (Rp ${settledPayment.amount} via ${settledPayment.provider}). ${action} ditolak untuk mencegah anomali finansial. Silakan gunakan alur Refund resmi.`
          );
        }
      }

      const updateResult = orderRepository.updateStatusIfCurrent({
        orderId: order_id,
        targetStatus: target_status,
        currentStatus
      });

      if (!updateResult || updateResult.changes === 0) {
        throw new Error(`Konflik konkurensi: Status pesanan "${order_id}" telah diubah oleh proses lain.`);
      }

      const logId = 'log_' + crypto.randomBytes(8).toString('hex');
      orderRepository.insertStatusLog({
        logId,
        orderId: order_id,
        previousStatus: currentStatus,
        newStatus: target_status,
        actorType: actor_type,
        actorId: actor_id,
        note
      });

      if (target_status === 'cancelled' || target_status === 'rejected' || target_status === 'timeout') {
        const PromotionEngineService = require('../../domains/promotion/services/PromotionEngineService');
        PromotionEngineService.voidRedemptions({ order_id, reason: note || `Order ${target_status} by ${actor_type}` });
      }

      orderRepository.commitTransaction();
    } catch (txErr) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      throw txErr;
    }

    return {
      success: true,
      order_id,
      previous_status: currentStatus,
      new_status: target_status
    };
  }
}

module.exports = OrderStateMachine;
