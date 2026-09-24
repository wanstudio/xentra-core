'use strict';

const crypto = require('crypto');
const { PaymentRepository, OrderRepository, PromotionRepository } = require('../../../core/data/repositories');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');
const { OrderPlacementService } = require('../../commerce');

const paymentRepository = new PaymentRepository();
const orderRepository = new OrderRepository();
const promotionRepository = new PromotionRepository();

function recordPromoRedemptions(order) {
  if (!order || !order.customer_phone) return;
  const items = paymentRepository.findOrderItemsWithPromoMarker(order.id);
  const promotions = [];
  for (const it of items || []) {
    let promoId = null;
    const marker = '[PROMO:';
    const start = typeof it.note === 'string' ? it.note.indexOf(marker) : -1;
    if (start >= 0) {
      const idStart = start + marker.length;
      const idEnd = it.note.indexOf(']', idStart);
      if (idEnd > idStart) promoId = it.note.slice(idStart, idEnd);
    } else if (String(it.product_id || '').startsWith('prm_')) promoId = it.product_id;
    if (!promoId) continue;
    const promoRow = promotionRepository.findPromotion(promoId);
    if (!promoRow) continue;
    const used = promotionRepository.countCustomerRedemptions({ promotionId: promoId, customerPhone: order.customer_phone });
    const maxLimit = Number(promoRow.max_redemptions_per_customer || 1);
    if (used >= maxLimit) throw new Error('[PROMO_LIMIT_EXCEEDED_RACE] Promo tidak dapat diredeem ulang.');
    let benefitAmount = Number(it.unit_price || 0);
    if (benefitAmount === 0) { const reward = promotionRepository.findRewardProductPrice(it.product_id); benefitAmount = reward ? Number(reward.v || 0) : 0; }
    promotions.push({ promo_id: promoId, benefit_amount: benefitAmount });
  }
  if (promotions.length) {
    const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
    PromotionEngineService.recordRedemptions({ order_id: order.id, brand_id: order.brand_id, branch_id: order.branch_id, customer_phone: order.customer_phone, promotions });
  }
}

class ManualQrisSettlementService {
  static settleStaticQrisPayment({ order_id, cashier_id, branch_id, reference_note = '' }) {
    const order = paymentRepository.findOrder(order_id);
    const payment = paymentRepository.findPaymentByOrderId(order_id);
    if (!order || order.branch_id !== branch_id || order.order_channel !== 'pos_cashier' || order.payment_method !== 'qris_static') throw new Error('[ManualQrisSettlementService] Order QRIS statis tidak ditemukan dalam scope kasir.');
    if (!payment || payment.provider !== 'qris_static' || payment.payment_method !== 'qris_static') throw new Error('[ManualQrisSettlementService] Record QRIS statis tidak konsisten.');
    if (payment.payment_status === PaymentModel.STATUSES.SETTLEMENT) return { success: true, status: 'SETTLED', idempotent: true, order_id, order_number: order.order_number, payment_status: 'settlement', order_status: order.status };
    if (!PaymentModel.canTransition(payment.payment_status, PaymentModel.STATUSES.SETTLEMENT)) throw new Error('[ManualQrisSettlementService] Pembayaran tidak dapat diselesaikan dari status saat ini.');
    if (['cancelled','completed','rejected','timeout','expired','fulfillment_exception'].includes(order.status)) throw new Error('[ManualQrisSettlementService] Order sudah terminal.');
    const now = new Date().toISOString();
    paymentRepository.beginTransaction();
    try {
      paymentRepository.updatePaymentWebhook({ orderId: order_id, paymentStatus: 'settlement', webhookResponse: JSON.stringify({ mode: 'qris_static_manual', cashier_id, reference_note: String(reference_note || '').trim(), verified_at: now }), settledAt: now, updatedAt: now, provider: 'qris_static', paymentMethod: 'qris_static' });
      if (order.status === 'pending') {
        const changed = orderRepository.updateStatusIfCurrent({ orderId: order_id, targetStatus: 'confirmed', currentStatus: 'pending' });
        if (!changed || changed.changes !== 1) throw new Error('[ManualQrisSettlementService] Order berubah bersamaan.');
        orderRepository.insertStatusLog({ logId: 'log_' + crypto.randomBytes(8).toString('hex'), orderId: order_id, previousStatus: 'pending', newStatus: 'confirmed', actorType: 'cashier', actorId: cashier_id, note: 'QRIS statis diverifikasi manual oleh kasir.' });
      }
      OrderPlacementService.deductStockForSettledOrder(order_id, { dbTransactionProvided: true });
      recordPromoRedemptions(order);
      if (order.order_type === 'dine_in') {
        const holds = paymentRepository.findActiveDiningHolds(order.id);
        let tableIds = (holds || []).map(h => h.table_id);
        if (!tableIds.length && order.table_number) { const t = paymentRepository.findBranchTableByNumberOrLabel(order.branch_id, order.table_number); if (t) tableIds = [t.id]; }
        if (tableIds.length) {
          const { DiningTableService } = require('../../dining');
          DiningTableService.createOrAttachDiningSession({ branch_id: order.branch_id, table_ids: tableIds, order_id: order.id, customer_name: order.customer_name, customer_phone: order.customer_phone, guest_count: order.guest_count || 1, hold_reference_id: order.id, channel: 'pos_cashier' });
        }
      }
      paymentRepository.commitTransaction();
    } catch (err) { try { paymentRepository.rollbackTransaction(); } catch (_) {} throw err; }
    events.EventBus.publish({ type: 'payment.settled', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id, brand_id: order.brand_id, provider: 'qris_static', payment_method: 'qris_static', amount: Number(order.grand_total), settled_at: now, cashier_id } }).catch(() => {});
    events.EventBus.publish({ type: 'pos.order.settled', producer: 'pos', payload: { order_id, order_number: order.order_number, branch_id, shift_id: null, order_type: order.order_type, table_number: order.table_number, payment_method: 'qris_static', grand_total: Number(order.grand_total), amount_tendered: null, change: 0 } }).catch(() => {});
    return { success: true, status: 'SETTLED', order_id, order_number: order.order_number, payment_status: 'settlement', order_status: 'confirmed', payment: { method: 'qris_static', provider: 'qris_static', status: 'settlement', reference_note: String(reference_note || '').trim() } };
  }

  static cancelStaticQrisPayment({ order_id, cashier_id, branch_id, reason = 'QRIS statis dibatalkan oleh kasir.' }) {
    const order = paymentRepository.findOrder(order_id);
    const payment = paymentRepository.findPaymentByOrderId(order_id);
    if (!order || order.branch_id !== branch_id || order.order_channel !== 'pos_cashier' || order.payment_method !== 'qris_static') throw new Error('[ManualQrisSettlementService] Order QRIS statis tidak ditemukan dalam scope kasir.');
    if (!payment || payment.provider !== 'qris_static' || payment.payment_status !== PaymentModel.STATUSES.PENDING) throw new Error('[ManualQrisSettlementService] Pembayaran QRIS statis tidak lagi pending.');
    const now = new Date().toISOString();
    paymentRepository.beginTransaction();
    try {
      paymentRepository.updatePaymentStatus({ orderId: order_id, paymentStatus: PaymentModel.STATUSES.CANCEL, updatedAt: now });
      const changed = orderRepository.updateStatusIfCurrent({ orderId: order_id, targetStatus: 'cancelled', currentStatus: 'pending' });
      if (!changed || changed.changes !== 1) throw new Error('[ManualQrisSettlementService] Order tidak lagi pending.');
      orderRepository.insertStatusLog({ logId: 'log_' + crypto.randomBytes(8).toString('hex'), orderId: order_id, previousStatus: 'pending', newStatus: 'cancelled', actorType: 'cashier', actorId: cashier_id, note: String(reason || 'QRIS statis dibatalkan.') });
      paymentRepository.commitTransaction();
    } catch (err) { try { paymentRepository.rollbackTransaction(); } catch (_) {} throw err; }
    events.EventBus.publish({ type: 'payment.failed', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id, provider: 'qris_static', payment_method: 'qris_static', status: 'cancel', cashier_id } }).catch(() => {});
    return { success: true, order_id, payment_status: 'cancel', order_status: 'cancelled' };
  }
}

module.exports = ManualQrisSettlementService;