'use strict';

const crypto = require('crypto');
const axios = require('axios');
const {
  PaymentRepository,
  PromotionRepository,
  DiningTableRepository
} = require('../../../core/data/repositories');
const { events } = require('../../../core');
const PaymentModel = require('../models/PaymentModel');

const paymentRepository = new PaymentRepository();
const promotionRepository = new PromotionRepository();
const diningTableRepository = new DiningTableRepository();

class PaymentGatewayService {
  static resolvePaymentConfig(branch_id, brand_id) {
    if (branch_id) {
      let branch = null;
      if (brand_id) {
        branch = paymentRepository.findBranchPaymentConfig(branch_id, brand_id);
      } else {
        branch = paymentRepository.findBranchPaymentConfig(branch_id);
      }
      if (branch && branch.payment_config_override) {
        try {
          const cfg = JSON.parse(branch.payment_config_override);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    if (brand_id) {
      const brand = paymentRepository.findBrandPaymentConfig(brand_id);
      if (brand && brand.default_payment_config) {
        try {
          const cfg = JSON.parse(brand.default_payment_config);
          if (cfg && cfg.server_key) return cfg;
        } catch (_) {}
      }
    }

    return {
      provider: 'midtrans',
      is_production: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      server_key: process.env.MIDTRANS_SERVER_KEY || '',
      client_key: process.env.MIDTRANS_CLIENT_KEY || '',
      merchant_id: process.env.MIDTRANS_MERCHANT_ID || ''
    };
  }

  static async createSnapTransaction(order, items = [], customer = {}) {
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const isProd = config.is_production === true;
    const snapUrl = isProd
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const authHeader = 'Basic ' + Buffer.from(config.server_key + ':').toString('base64');

    const payload = {
      transaction_details: {
        order_id: order.id,
        gross_amount: Math.round(order.grand_total)
      },
      customer_details: {
        first_name: customer.name || 'Pelanggan',
        phone: customer.phone || ''
      },
      item_details: items.map((i) => ({
        id: i.product_id || i.id,
        price: Math.round(i.unit_price || i.price),
        quantity: i.quantity || 1,
        name: String(i.product_name || i.name || 'Menu').substring(0, 50)
      }))
    };

    if (order.delivery_fee > 0) {
      payload.item_details.push({ id: 'DELIVERY_FEE', price: Math.round(order.delivery_fee), quantity: 1, name: 'Biaya Pengantaran' });
    }

    try {
      const response = await axios.post(snapUrl, payload, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authHeader },
        timeout: 8000
      });
      return { snap_token: response.data.token, redirect_url: response.data.redirect_url, merchant_id: config.merchant_id };
    } catch (err) {
      if (isProd || process.env.NODE_ENV === 'production') {
        const errorDetail = err.response?.data?.error_messages?.join(', ') || err.message;
        throw new Error(`[Midtrans Gateway Error]: Gagal membuat transaksi pembayaran online (${errorDetail}).`);
      }
      const simToken = 'sim_snap_' + Date.now();
      return { snap_token: simToken, redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${simToken}`, merchant_id: config.merchant_id };
    }
  }

  static verifySignature(webhookData, serverKey) {
    if (!webhookData || !webhookData.signature_key || !serverKey) return false;
    const { order_id, status_code, gross_amount, signature_key } = webhookData;
    const raw = `${order_id}${status_code}${gross_amount}${serverKey}`;
    return crypto.createHash('sha512').update(raw).digest('hex') === signature_key;
  }

  static handleWebhook(webhookData, { skipSignatureCheck = false } = {}) {
    const { order_id, transaction_status, fraud_status, gross_amount } = webhookData;
    let payment = paymentRepository.findPaymentByOrderId(order_id);
    const order = paymentRepository.findOrder(order_id);

    if (!skipSignatureCheck) {
      const config = this.resolvePaymentConfig(order?.branch_id, order?.brand_id);
      if (!config.server_key) throw new Error(`[PaymentGatewayService] Server Key Midtrans belum dikonfigurasi untuk brand/cabang order "${order_id}". Webhook ditolak demi keamanan.`);
      if (!webhookData.signature_key) throw new Error(`[PaymentGatewayService] Signature key tidak disertakan pada webhook payload untuk order "${order_id}". Webhook ditolak.`);
      if (!this.verifySignature(webhookData, config.server_key)) throw new Error(`[PaymentGatewayService Signature Fraud]: Signature webhook Midtrans tidak valid untuk order "${order_id}". Transaksi ditolak.`);
    }

    if (!payment) {
      if (!order) throw new Error(`[PaymentGatewayService] Data pesanan untuk Order ID "${order_id}" tidak ditemukan.`);
      const selfHealedPaymentId = `pay_${crypto.randomBytes(6).toString('hex')}`;
      const healNow = new Date().toISOString();
      paymentRepository.ensurePendingPayment({
        paymentId: selfHealedPaymentId,
        orderId: order_id,
        amount: order.grand_total,
        createdAt: healNow,
        updatedAt: healNow
      });
      payment = paymentRepository.findPaymentByOrderId(order_id);
    }

    let newPaymentStatus = PaymentModel.STATUSES.PENDING;
    const shouldSettle = transaction_status === 'settlement' || (transaction_status === 'capture' && fraud_status === 'accept');
    if (transaction_status === 'capture' && fraud_status === 'challenge') newPaymentStatus = PaymentModel.STATUSES.CHALLENGE;
    else if (shouldSettle) newPaymentStatus = PaymentModel.STATUSES.SETTLEMENT;
    else if (['cancel', 'deny', 'expire'].includes(transaction_status)) newPaymentStatus = transaction_status;

    if (payment.payment_status === PaymentModel.STATUSES.SETTLEMENT && newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) return { success: true, idempotent: true, order_id, payment_status: PaymentModel.STATUSES.SETTLEMENT, message: 'Pembayaran sudah diselesaikan sebelumnya.' };
    if (payment.payment_status === newPaymentStatus) return { success: true, idempotent: true, order_id, payment_status: newPaymentStatus, message: `Status pembayaran sudah berada pada "${newPaymentStatus}".` };
    if (!PaymentModel.canTransition(payment.payment_status, newPaymentStatus)) throw new Error(`[PaymentGatewayService State Violation]: Transisi status pembayaran tidak valid dari "${payment.payment_status}" ke "${newPaymentStatus}". Status terminal tidak dapat diubah.`);

    if (order && order.status === 'cancelled' && shouldSettle) throw new Error(`[PaymentGatewayService State Violation]: Pesanan "${order_id}" sudah dibatalkan (cancelled) dan tidak dapat dikonfirmasi ulang.`);

    if (shouldSettle || newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) {
      const gatewayAmount = Number(gross_amount);
      const orderAmount = order ? Number(order.grand_total) : null;
      const paymentAmount = Number(payment.amount);
      if (!Number.isFinite(gatewayAmount) || (orderAmount !== null && Math.round(gatewayAmount) !== Math.round(orderAmount)) || Math.round(gatewayAmount) !== Math.round(paymentAmount)) throw new Error(`[PAYMENT_AMOUNT_MISMATCH]: Nominal pembayaran gateway (Rp ${gatewayAmount}) tidak cocok dengan tagihan order (Rp ${orderAmount}) atau payment record (Rp ${paymentAmount}). Transaksi settlement ditolak demi integritas finansial.`);
    }

    const now = new Date().toISOString();
    let orderStatusAfterSettlement = null;
    paymentRepository.beginTransaction();
    try {
      paymentRepository.updatePaymentWebhook({
        orderId: order_id,
        paymentStatus: newPaymentStatus,
        webhookResponse: JSON.stringify(webhookData),
        settledAt: now,
        updatedAt: now
      });

      if (shouldSettle) {
        const currentOrderState = paymentRepository.findOrderStatus(order_id);
        const terminalOrderStatuses = ['rejected', 'timeout', 'cancelled', 'fulfillment_exception'];
        if (currentOrderState && terminalOrderStatuses.includes(currentOrderState.status)) {
          orderStatusAfterSettlement = 'fulfillment_exception';
          paymentRepository.markFulfillmentException({
            orderId: order_id,
            note: `[Perlu Refund]: Pembayaran diterima setelah pesanan berstatus "${currentOrderState.status}". Pesanan tidak diaktifkan ulang.`,
            updatedAt: now
          });
        } else {
          const OrderPlacementService = require('../../commerce/services/OrderPlacementService');
          OrderPlacementService.deductStockForSettledOrder(order_id, { dbTransactionProvided: true });

          const promoItems = paymentRepository.findOrderItemsWithPromoMarker(order_id);
          const promoRedemptionsToRecord = [];
          if (promoItems && promoItems.length > 0 && order && order.customer_phone) {
            for (const it of promoItems) {
              let promoId = null;
              const match = it.note ? it.note.match(/\\[PROMO:([^\\]]+)\\]/) : null;
              if (match) promoId = match[1];
              else if (String(it.product_id).startsWith('prm_')) promoId = it.product_id;
              if (!promoId) continue;
              const promoRow = promotionRepository.findPromotion(promoId);
              if (!promoRow) continue;
              const activeRedemptions = promotionRepository.countCustomerRedemptions({
                promotionId: promoId,
                customerPhone: order.customer_phone
              });
              const maxLimit = Number(promoRow.max_redemptions_per_customer || 1);
              if (activeRedemptions >= maxLimit) throw new Error(`[PROMO_LIMIT_EXCEEDED_RACE] Batas klaim promo "${promoId}" (${maxLimit}x) telah digunakan oleh pesanan lain milik pelanggan.`);
              let benefitAmount = Number(it.unit_price || 0);
              if (benefitAmount === 0) {
                const rewardProduct = promotionRepository.findRewardProductPrice(it.product_id);
                benefitAmount = rewardProduct ? Number(rewardProduct.v || 0) : 0;
              }
              promoRedemptionsToRecord.push({ promo_id: promoId, benefit_amount: benefitAmount });
            }
          }

          if (promoRedemptionsToRecord.length > 0) {
            const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
            PromotionEngineService.recordRedemptions({ order_id, brand_id: order?.brand_id, branch_id: order?.branch_id, customer_phone: order?.customer_phone, promotions: promoRedemptionsToRecord });
          }

          if (order && order.order_type === 'dine_in') {
            try {
              const { DiningTableService } = require('../../pos');
              let tableIds = [];
              const activeHold = diningTableRepository.findActiveHolds(order.id);
              if (activeHold && activeHold.length > 0) tableIds = activeHold.map(h => h.table_id);
              else if (order.table_number) {
                const tbl = diningTableRepository.findTableIdByNumberOrLabel(order.branch_id, order.table_number);
                if (tbl) tableIds = [tbl.id];
              }
              if (tableIds.length > 0) DiningTableService.createOrAttachDiningSession({ branch_id: order.branch_id, table_ids: tableIds, order_id: order.id, customer_name: order.customer_name, customer_phone: order.customer_phone, guest_count: 1, hold_reference_id: order.id });
            } catch (dineErr) { console.warn('[PaymentGatewayService] Dine-in table settlement warning:', dineErr.message); }
          }
        }
      } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
        const cancelOrderResult = paymentRepository.cancelPendingOrder({ orderId: order_id, updatedAt: now });
        if (cancelOrderResult && cancelOrderResult.changes > 0) {
          const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
          PromotionEngineService.voidRedemptions({ order_id, reason: `Gateway status ${newPaymentStatus}` });
          if (order && order.order_type === 'dine_in') {
            try {
              const { DiningTableService } = require('../../pos');
              DiningTableService.releaseHold({ branch_id: order.branch_id, hold_reference_id: order.id, reason: newPaymentStatus });
            } catch (_) {}
          }
        }
      }
      paymentRepository.commitTransaction();
    } catch (err) {
      try { paymentRepository.rollbackTransaction(); } catch (_) {}
      const isConcurrencyException = err.message && (err.message.includes('[OUT_OF_STOCK_RACE]') || err.message.includes('[PROMO_LIMIT_EXCEEDED_RACE]'));
      if (isConcurrencyException) {
        try {
          paymentRepository.beginTransaction();
          paymentRepository.updatePaymentWebhook({
            orderId: order_id,
            paymentStatus: 'settlement',
            webhookResponse: JSON.stringify(webhookData),
            settledAt: now,
            updatedAt: now
          });
          const notePrefix = err.message.includes('[PROMO_LIMIT_EXCEEDED_RACE]') ? `[Kendala Promo / Perlu Penyesuaian/Refund]: ${err.message}` : `[Kendala Stok / Perlu Refund]: ${err.message}`;
          paymentRepository.markFulfillmentException({ orderId: order_id, note: notePrefix, updatedAt: now });
          paymentRepository.commitTransaction();
          events.EventBus.publish({ type: 'payment.fulfillment_exception', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: 'midtrans', amount: Number(gross_amount || payment.amount), error: err.message, settled_at: now } }).catch(() => {});
          return { success: true, order_id, payment_status: 'settlement', order_status: 'fulfillment_exception', message: 'Pembayaran berhasil diselesaikan namun terdapat kendala ketersediaan stok atau batas promosi. Pesanan dialihkan ke antrean fulfillment exception untuk rekonsiliasi refund.' };
        } catch (_) { try { paymentRepository.rollbackTransaction(); } catch (_) {} }
      }
      throw new Error(`[PaymentGatewayService Transaction Error]: ${err.message}`);
    }

    if (shouldSettle) {
      if (orderStatusAfterSettlement === 'fulfillment_exception') events.EventBus.publish({ type: 'payment.fulfillment_exception', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: 'midtrans', amount: Number(gross_amount || payment.amount), error: `Settlement arrived after order left AWAITING (${orderStatusAfterSettlement}).`, settled_at: now } }).catch(() => {});
      else events.EventBus.publish({ type: 'payment.settled', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: 'midtrans', payment_method: 'midtrans', amount: Number(gross_amount || payment.amount), settled_at: now } }).catch(() => {});
    } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
      events.EventBus.publish({ type: 'payment.failed', producer: 'payment', payload: { payment_id: payment.id, order_id, branch_id: order?.branch_id, provider: 'midtrans', status: newPaymentStatus } }).catch(() => {});
    }

    return { success: true, order_id, payment_status: newPaymentStatus, ...(orderStatusAfterSettlement ? { order_status: orderStatusAfterSettlement } : {}) };
  }

  static async checkTransactionStatus(order_id) {
    const payment = paymentRepository.findPaymentByOrderId(order_id);
    const order = paymentRepository.findOrder(order_id);
    if (!order) throw new Error(`[PaymentGatewayService] Order "${order_id}" tidak ditemukan.`);
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    if (!config.server_key) throw new Error(`[PaymentGatewayService] Server Key Midtrans belum dikonfigurasi untuk brand/cabang order "${order_id}".`);
    const isProd = config.is_production || process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const baseUrl = isProd ? 'https://api.midtrans.com/v2' : 'https://api.sandbox.midtrans.com/v2';
    try {
      const response = await axios.get(`${baseUrl}/${order_id}/status`, { headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(config.server_key + ':').toString('base64') }, timeout: 6000 });
      if (response?.data) return this.handleWebhook(response.data, { skipSignatureCheck: true });
    } catch (err) {
      if (err.response?.status === 404) {
        paymentRepository.beginTransaction();
        try {
          paymentRepository.updatePaymentStatus({ orderId: order_id, paymentStatus: 'cancel', updatedAt: new Date().toISOString() });
          const orderCancelled = paymentRepository.cancelPendingOrder({ orderId: order_id, updatedAt: new Date().toISOString() });
          paymentRepository.commitTransaction();
          const orderStatus = orderCancelled?.changes > 0 ? 'cancelled' : null;
          return { success: true, order_id, payment_status: 'cancel', ...(orderStatus ? { order_status: orderStatus } : {}), message: orderStatus ? 'Transaksi tidak ditemukan di gateway Midtrans. Pembayaran resmi dibatalkan.' : 'Transaksi tidak ditemukan di gateway Midtrans. Pembayaran dicatat batal; status pesanan terminal dipertahankan.' };
        } catch (_) { try { paymentRepository.rollbackTransaction(); } catch (_) {} }
      }
      throw new Error(`[PaymentGatewayService] Gagal memeriksa status transaksi gateway: ${err.message}`);
    }
  }

  static async reconcilePendingPayments() {
    const pendingList = paymentRepository.findPendingReconciliationPayments();
    const results = [];
    for (const row of pendingList) {
      try { results.push({ order_id: row.order_id, success: true, result: await this.checkTransactionStatus(row.order_id) }); }
      catch (err) { results.push({ order_id: row.order_id, success: false, error: err.message }); }
    }
    return results;
  }
}

module.exports = PaymentGatewayService;
