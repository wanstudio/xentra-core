'use strict';

const { events } = require('../../../core');
const { OrderRepository } = require('../../../core/data/repositories');
const OrderStateMachine = require('../../../server/services/OrderStateMachine');
const DeliveryModel = require('../models/DeliveryModel');
const BranchDriverProvider = require('../providers/BranchDriverProvider');

const orderRepository = new OrderRepository();

const DELIVERY_TRANSITIONS = Object.freeze({
  unassigned: Object.freeze(['assigned']),
  assigned: Object.freeze(['picked_up']),
  picked_up: Object.freeze(['on_delivery']),
  on_delivery: Object.freeze(['delivered']),
  delivered: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

class DeliveryDispatchService {
  static canTransition(currentStatus, targetStatus) {
    const allowed = DELIVERY_TRANSITIONS[String(currentStatus || '')] || [];
    return allowed.includes(String(targetStatus || ''));
  }

  static _assertDriverActor(delivery, actorId) {
    if (!actorId) {
      throw new Error('[DeliveryDispatchService] Driver action membutuhkan actor_id.');
    }
    if (delivery && delivery.driver_id && String(delivery.driver_id) !== String(actorId)) {
      throw new Error('[DeliveryDispatchService] Driver tidak berwenang menjalankan delivery job ini.');
    }
    if (!delivery || delivery.driver_assignment_status !== DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED) {
      throw new Error('[DeliveryDispatchService] Delivery job harus diterima Driver sebelum dapat dijalankan.');
    }
  }

  static assign({
    order_id,
    provider_type = DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER,
    driver_id = null,
    driver_name,
    driver_phone,
    assigned_by = null
  }) {
    const order = orderRepository.findById(order_id);
    if (!order) {
      throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    }
    if (order.order_type !== 'delivery') {
      throw new Error('[DeliveryDispatchService] Hanya Order Fulfillment Environment delivery yang dapat diberi driver.');
    }
    if (order.status !== 'ready') {
      throw new Error('[DeliveryDispatchService] Driver hanya dapat di-assign setelah pesanan berstatus ready.');
    }
    if (!driver_id) {
      throw new Error('[DeliveryDispatchService] driver_id wajib ditentukan untuk assignment Driver.');
    }

    const existing = orderRepository.findDeliveryByOrderId(order_id);
    if (existing && !['unassigned', 'assigned'].includes(String(existing.status || ''))) {
      throw new Error('[DeliveryDispatchService] Delivery job sudah berjalan atau selesai dan tidak dapat di-assign ulang pada state ini.');
    }
    if (existing && existing.status === 'assigned' && existing.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED) {
      throw new Error('[DeliveryDispatchService] Driver sudah menerima delivery job ini. Gunakan alur reassignment resmi.');
    }

    if (provider_type === DeliveryModel.PROVIDER_TYPES.BRANCH_DRIVER) {
      return BranchDriverProvider.assignDriver({
        order_id,
        driver_id,
        driver_name,
        driver_phone,
        assigned_by
      });
    }

    throw new Error('[DeliveryDispatchService] Provider type "' + provider_type + '" belum didukung pada MVP.');
  }

  static acceptAssignment({ order_id, actor_id }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.status !== 'ready') {
      throw new Error('[DeliveryDispatchService] Driver assignment hanya dapat diterima/ditolak saat pesanan masih berstatus ready.');
    }
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery || delivery.status !== DeliveryModel.STATUS.ASSIGNED) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak sedang menunggu penerimaan Driver.');
    }
    this._assertAssignedDriver(delivery, actor_id);
    if (delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED) {
      return { success: true, order_id, status: 'assigned', assignment_status: 'accepted', idempotent: true };
    }
    if (delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED) {
      throw new Error('[DeliveryDispatchService] Delivery job sudah ditolak dan harus di-assign ulang oleh Manager.');
    }
    const now = new Date().toISOString();
    const result = orderRepository.respondToDriverAssignment({
      orderId: order_id,
      response: DeliveryModel.ASSIGNMENT_RESPONSES.ACCEPTED,
      respondedBy: actor_id,
      updatedAt: now
    });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Assignment Driver gagal diperbarui karena konflik state.');
    events.EventBus.publish({
      type: 'delivery.driver.accepted',
      producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, driver_id: delivery.driver_id || null, actor_id, accepted_at: now }
    }).catch(() => {});
    return { success: true, order_id, status: 'assigned', assignment_status: 'accepted', responded_at: now };
  }

  static rejectAssignment({ order_id, actor_id, reason = '' }) {
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.status !== 'ready') {
      throw new Error('[DeliveryDispatchService] Driver assignment hanya dapat diterima/ditolak saat pesanan masih berstatus ready.');
    }
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery || delivery.status !== DeliveryModel.STATUS.ASSIGNED) {
      throw new Error('[DeliveryDispatchService] Delivery job tidak sedang menunggu penerimaan Driver.');
    }
    this._assertAssignedDriver(delivery, actor_id);
    if (delivery.driver_assignment_status === DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED && delivery.status === DeliveryModel.STATUS.UNASSIGNED) {
      return { success: true, order_id, status: 'unassigned', assignment_status: 'rejected', idempotent: true };
    }
    const rejectionReason = String(reason || '').trim();
    if (!rejectionReason) throw new Error('[DeliveryDispatchService] Alasan penolakan Driver wajib diisi.');
    const now = new Date().toISOString();
    const result = orderRepository.respondToDriverAssignment({
      orderId: order_id,
      response: DeliveryModel.ASSIGNMENT_RESPONSES.REJECTED,
      respondedBy: actor_id,
      rejectionReason,
      updatedAt: now
    });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Penolakan Driver gagal diperbarui karena konflik state.');
    events.EventBus.publish({
      type: 'delivery.driver.rejected',
      producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, driver_id: delivery.driver_id || null, actor_id, reason: rejectionReason, rejected_at: now }
    }).catch(() => {});
    return { success: true, order_id, status: 'unassigned', assignment_status: 'rejected', rejected_at: now };
  }

  static _assertAssignedDriver(delivery, actorId) {
    if (!actorId) throw new Error('[DeliveryDispatchService] Driver action membutuhkan actor_id.');
    if (delivery.driver_id && String(delivery.driver_id) !== String(actorId)) {
      throw new Error('[DeliveryDispatchService] Driver tidak berwenang menjalankan delivery job ini.');
    }
  }

  static updateStatus({
    order_id,
    status,
    notes = '',
    actor_id = null,
    cod_amount_tendered = null
  }) {
    if (!DeliveryModel.isValidStatus(status)) {
      throw new Error('[DeliveryDispatchService] Delivery status "' + status + '" tidak valid.');
    }
    if ([DeliveryModel.STATUS.FAILED, DeliveryModel.STATUS.CANCELLED].includes(status)) {
      throw new Error('[DELIVERY_EXCEPTION_FLOW_NOT_LOCKED]: Failed/cancelled delivery belum boleh ditulis melalui lifecycle normal. Gunakan alur exception/reassignment resmi setelah kontrak exception dikunci.');
    }
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.order_type !== 'delivery') throw new Error('[DeliveryDispatchService] Order "' + order_id + '" bukan Fulfillment Environment delivery.');
    const currentDelivery = orderRepository.findDeliveryByOrderId(order_id);
    const currentDeliveryStatus = currentDelivery ? String(currentDelivery.status || 'unassigned') : 'unassigned';

    if ([DeliveryModel.STATUS.PICKED_UP, DeliveryModel.STATUS.ON_DELIVERY, DeliveryModel.STATUS.DELIVERED].includes(status)) {
      this._assertDriverActor(currentDelivery, actor_id);
    }

    // Idempotency is allowed only after actor authorization has passed.
    if (currentDeliveryStatus === status) {
      return { success: true, order_id, status, updated_at: currentDelivery.updated_at || new Date().toISOString(), idempotent: true };
    }
    if (!this.canTransition(currentDeliveryStatus, status)) {
      throw new Error('[DeliveryDispatchService] Perubahan Delivery Job tidak valid: dari "' + currentDeliveryStatus + '" ke "' + status + '".');
    }
    const now = new Date().toISOString();
    orderRepository.beginTransaction();
    try {
      const latestOrder = orderRepository.findById(order_id);
      const latestDelivery = orderRepository.findDeliveryByOrderId(order_id);
      if (!latestOrder || !latestDelivery) throw new Error('[DeliveryDispatchService] Order/delivery state hilang saat transaksi.');
      if (latestDelivery.status !== currentDeliveryStatus) throw new Error('[DeliveryDispatchService] Konflik konkurensi: Delivery job telah berubah.');

      if (status === DeliveryModel.STATUS.PICKED_UP) {
        if (latestOrder.status !== 'ready') throw new Error('[DeliveryDispatchService] Pickup hanya dapat dilakukan setelah pesanan ready.');
      } else if (status === DeliveryModel.STATUS.ON_DELIVERY) {
        if (latestOrder.status !== 'ready') throw new Error('[DeliveryDispatchService] Driver hanya dapat memulai pengantaran setelah pesanan berstatus ready.');
      } else if (status === DeliveryModel.STATUS.DELIVERED) {
        if (latestOrder.status !== 'out_for_delivery') {
          throw new Error('[DeliveryDispatchService] Delivery hanya dapat diselesaikan setelah status pengantaran dimulai.');
        }
        if (latestOrder.payment_method === 'cash') {
          const tendered = Number(cod_amount_tendered);
          const expected = Number(latestOrder.grand_total);
          if (!Number.isFinite(tendered) || tendered <= 0) {
            throw new Error('[COD_CASH_TENDER_REQUIRED]: Driver wajib mencatat nominal cash yang diterima dari customer.');
          }
          if (tendered < expected) {
            throw new Error('[COD_CASH_SHORT]: Uang yang diterima Driver kurang dari total tagihan. Gunakan alur variance COD.');
          }
          const change = tendered - expected;
          orderRepository.updateDeliveryStatus({
            orderId: order_id, status, updatedAt: now,
            codCollectionStatus: DeliveryModel.COD_COLLECTION_STATUS.COLLECTED,
            codCashCustody: DeliveryModel.COD_CASH_CUSTODY.DRIVER,
            codCollectedAmount: expected,
            codAmountTendered: tendered,
            codChangeGiven: change
          });
        } else {
          orderRepository.updateDeliveryStatus({ orderId: order_id, status, updatedAt: now });
        }
        OrderStateMachine.transition({
          order_id, target_status: 'completed', actor_type: 'driver', actor_id,
          note: notes || 'Driver menyelesaikan pengantaran'
        }, { dbTransactionProvided: true });
      } else {
        orderRepository.updateDeliveryStatus({ orderId: order_id, status, updatedAt: now });
      }

      orderRepository.commitTransaction();
    } catch (err) {
      try { orderRepository.rollbackTransaction(); } catch (_) {}
      throw err;
    }

    if (status === DeliveryModel.STATUS.DELIVERED) {
      events.EventBus.publish({
        type: 'delivery.completed', producer: 'delivery',
        payload: { order_id, order_number: order.order_number, branch_id: order.branch_id, completed_at: now, actor_id }
      }).catch(() => {});
    }
    return { success: true, order_id, status, updated_at: now };
  }

  static getDelivery(order_id) { return orderRepository.findDeliveryByOrderId(order_id); }

  static recordCodHandover({ order_id, cashier_id = null, branch_id = null, received_amount = null }) {
    if (!cashier_id) throw new Error('[DeliveryDispatchService] Cash handover membutuhkan cashier_id.');
    const order = orderRepository.findById(order_id);
    if (!order) throw new Error('[DeliveryDispatchService] Order "' + order_id + '" tidak ditemukan.');
    if (order.order_type !== 'delivery' || order.payment_method !== 'cash') throw new Error('[DeliveryDispatchService] Cash handover hanya berlaku untuk delivery COD.');
    if (branch_id && order.branch_id !== branch_id) throw new Error('[DeliveryDispatchService] Pesanan berada di luar kewenangan cabang kasir.');
    const delivery = orderRepository.findDeliveryByOrderId(order_id);
    if (!delivery) throw new Error('[DeliveryDispatchService] Data delivery untuk pesanan "' + order_id + '" tidak ditemukan.');
    if (delivery.status !== DeliveryModel.STATUS.DELIVERED) throw new Error('[DeliveryDispatchService] Handover kas COD hanya dapat dilakukan setelah delivery berstatus delivered.');
    if (delivery.cod_collection_status === DeliveryModel.COD_COLLECTION_STATUS.HANDED_OVER && delivery.cod_cash_custody === DeliveryModel.COD_CASH_CUSTODY.CASHIER) {
      if (!delivery.cod_handed_over_to || String(delivery.cod_handed_over_to) === String(cashier_id)) {
        return { success: true, order_id, cod_collection_status: 'handed_over', cod_cash_custody: 'cashier', cod_handed_over_to: delivery.cod_handed_over_to || cashier_id, idempotent: true };
      }
      throw new Error('[DeliveryDispatchService] COD sudah diterima oleh Cashier lain.');
    }
    if (delivery.cod_collection_status !== DeliveryModel.COD_COLLECTION_STATUS.COLLECTED || delivery.cod_cash_custody !== DeliveryModel.COD_CASH_CUSTODY.DRIVER) {
      throw new Error('[DeliveryDispatchService] COD cash belum tercatat sebagai uang yang masih dipegang Driver.');
    }
    const expected = Number(order.grand_total);
    const collected = Number(delivery.cod_collected_amount);
    const received = Number(received_amount);
    if (collected !== expected) throw new Error('[COD_CASH_VARIANCE_REQUIRES_EXCEPTION_FLOW]: Nominal COD yang dikumpulkan tidak sama dengan tagihan.');
    if (!Number.isFinite(received) || received !== collected) throw new Error('[COD_HANDOVER_AMOUNT_MISMATCH]: Nominal cash yang diterima Cashier tidak sesuai nominal COD yang dibawa Driver.');
    const now = new Date().toISOString();
    const result = orderRepository.recordDeliveryCodHandover({ orderId: order_id, codHandedOverTo: cashier_id, updatedAt: now });
    if (!result || result.changes !== 1) throw new Error('[DeliveryDispatchService] Handover gagal karena state COD berubah bersamaan.');
    events.EventBus.publish({
      type: 'delivery.cod.handed_over', producer: 'delivery',
      payload: { order_id, branch_id: order.branch_id, cashier_id, amount: collected, handed_over_at: now }
    }).catch(() => {});
    return { success: true, order_id, cod_collection_status: 'handed_over', cod_cash_custody: 'cashier', cod_handed_over_at: now, cod_handed_over_to: cashier_id };
  }
}
module.exports = DeliveryDispatchService;
