'use strict';

const crypto = require('crypto');
const {
  PaymentRepository,
  PromotionRepository,
  DiningTableRepository
} = require('../../../core/data/repositories');
const { events } = require('../../../core');
const { isConsumingOrderStatus } = require('../../../core/domain/OrderStatusContract');
const PaymentModel = require('../models/PaymentModel');
const MidtransGateway = require('../gateways/MidtransGateway');
const DokuGateway = require('../gateways/DokuGateway');

const paymentRepository = new PaymentRepository();
const { OrderRepository } = require('../../../core/data/repositories');
const orderRepository = new OrderRepository();
const promotionRepository = new PromotionRepository();
const diningTableRepository = new DiningTableRepository();

function releaseClaimIfNeverAccepted(orderId, orderStatus, reason) {
  if (isConsumingOrderStatus(orderStatus)) return;
  const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
  PromotionEngineService.voidRedemptions({ order_id: orderId, reason });
}

class PaymentGatewayService {
  static resolvePaymentConfig(branch_id, brand_id) {
    if (branch_id) {
      let branch = null;
      if (brand_id) branch = paymentRepository.findBranchPaymentConfig(branch_id, brand_id);
      else branch = paymentRepository.findBranchPaymentConfig(branch_id);
      if (branch && branch.payment_config_override) {
        try {
          const cfg = JSON.parse(branch.payment_config_override);
          if (cfg && typeof cfg === 'object') return cfg;
        } catch (err) {
          throw new Error('[PaymentGatewayService] Konfigurasi pembayaran cabang gagal dibaca (format JSON tidak valid).');
        }
      }
    }

    if (brand_id) {
      const brand = paymentRepository.findBrandPaymentConfig(brand_id);
      if (brand && brand.default_payment_config) {
        try {
          const cfg = JSON.parse(brand.default_payment_config);
          if (cfg && typeof cfg === 'object') return cfg;
        } catch (err) {
          throw new Error('[PaymentGatewayService] Konfigurasi pembayaran brand gagal dibaca (format JSON tidak valid).');
        }
      }
    }

    if (process.env.MIDTRANS_SERVER_KEY) {
      return {
        provider: 'midtrans',
        is_production: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        server_key: process.env.MIDTRANS_SERVER_KEY || '',
        client_key: process.env.MIDTRANS_CLIENT_KEY || '',
        merchant_id: process.env.MIDTRANS_MERCHANT_ID || ''
      };
    }

    return {
      provider: '',
      is_production: false
    };
  }

  static _hasValidCredentials(cfg) {
    if (!cfg) return false;
    if (cfg.provider === 'doku') return Boolean(cfg.client_id && cfg.secret_key);
    if (cfg.provider === 'midtrans') return Boolean(cfg.server_key);
    return Boolean(cfg.server_key || (cfg.client_id && cfg.secret_key));
  }

  static _resolveProvider(config) {
    if (!config) return null;
    if (typeof config.provider === 'string' && config.provider.trim() !== '') {
      return config.provider.trim().toLowerCase();
    }
    if (config.client_id || config.secret_key || (config.doku_methods && Object.keys(config.doku_methods).length > 0)) return 'doku';
    if (config.server_key || config.client_key || (config.midtrans_methods && Object.keys(config.midtrans_methods).length > 0)) return 'midtrans';
    return null;
  }

  /**
   * Config yang diberikan ke gateway, dengan environment milik gateway itu sendiri.
   *
   * Midtrans memakai `is_production`, DOKU memakai `doku_is_production`. Sebelumnya
   * keduanya membaca `is_production` yang sama, jadi memindahkan satu gateway ke
   * produksi ikut memindahkan yang lain — dua environment yang seharusnya berdiri
   * sendiri jadi saling mencampuri.
   */
  static _gatewayConfig(config, providerOverride) {
    const resolved = Object.assign({}, config);
    const provider = providerOverride || this._resolveProvider(config);
    if (provider === 'doku') {
      resolved.is_production = config.doku_is_production === true;
    }
    return resolved;
  }

  static getActiveProvider(branch_id, brand_id) {
    const config = this.resolvePaymentConfig(branch_id, brand_id);
    return this._resolveProvider(config);
  }

  static resolveStaticQrisConfig(branch_id, brand_id) {
    const config = this.resolvePaymentConfig(branch_id, brand_id) || {};
    const raw = (config.qris_static && typeof config.qris_static === 'object') ? config.qris_static : {};
    const imageUrl = String(raw.image_url || config.qris_static_image_url || config.qris_static_url || '').trim();
    return {
      enabled: raw.enabled !== false && Boolean(imageUrl),
      image_url: imageUrl,
      merchant_name: String(raw.merchant_name || '').trim(),
      instructions: String(raw.instructions || 'Pastikan pelanggan sudah menyelesaikan pembayaran, lalu verifikasi sebelum menekan Konfirmasi.').trim()
    };
  }

  static validatePaymentMethod(payment_method, { branch_id, brand_id } = {}) {
    if (!payment_method || typeof payment_method !== 'string' || !payment_method.trim()) {
      return { valid: false, error: 'INVALID_PAYMENT_PROVIDER', message: 'Metode pembayaran (payment_method) wajib diisi.' };
    }
    const clean = payment_method.trim().toLowerCase();
    if (clean === 'cash') {
      return { valid: true, provider: 'cash' };
    }
    if (clean === 'qris_static') {
      return { valid: true, provider: 'qris_static' };
    }
    if (!['midtrans', 'doku'].includes(clean)) {
      return { valid: false, error: 'INVALID_PAYMENT_PROVIDER', message: `Metode pembayaran "${payment_method}" tidak valid atau tidak didukung.` };
    }
    return { valid: true, provider: clean };
  }

  static _getGateway(config, providerOverride) {
    const provider = providerOverride || this._resolveProvider(config);
    const gatewayConfig = this._gatewayConfig(config, provider);
    if (provider === 'doku') return new DokuGateway(gatewayConfig);
    if (provider === 'midtrans') return new MidtransGateway(gatewayConfig);
    throw new Error(`[PaymentGatewayService] Provider gateway pembayaran "${provider || 'tidak ada'}" tidak valid atau tidak didukung.`);
  }

  static async createSnapTransaction(order, items = [], customer = {}) {
    if (order && order.order_type === 'reservation') {
      throw new Error('[PaymentGatewayService] PAYMENT_NOT_APPLICABLE: Reservation is a booking and must not create an online payment transaction.');
    }
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const activeProvider = this._resolveProvider(config);
    const provider = (order.payment_method && order.payment_method !== 'cash')
      ? order.payment_method
      : activeProvider;

    if (!provider) {
      throw new Error('[PaymentGatewayService] Tidak ada gateway pembayaran online yang aktif.');
    }

    if (provider === 'doku') {
      if (!config.client_id || !config.secret_key) {
        throw new Error('[DokuGateway] Kredensial DOKU belum dikonfigurasi (Client-Id / Secret Key missing).');
      }
    }

    const gateway = this._getGateway(config, provider);
    const gatewayConfig = this._gatewayConfig(config, provider);

    try {
      if (provider === 'midtrans' && !config.server_key) {
        throw new Error('[MidtransGateway] Server Key Midtrans belum dikonfigurasi.');
      }
      return await gateway.createTransaction(order, items, customer);
    } catch (err) {
      const isProd = gatewayConfig.is_production === true;
      if (isProd || process.env.NODE_ENV === 'production') {
        const errorDetail = err.response?.data?.error_messages?.join(', ') || err.response?.data?.message?.join(', ') || err.message;
        throw new Error(`[${gateway.name} Gateway Error]: Gagal membuat transaksi pembayaran online (${errorDetail}).`);
      }
      const simFallback = gateway.getSimFallback(order.id);
      if (simFallback) return simFallback;
      throw err;
    }
  }

  static verifySignature(webhookData, serverKey, provider) {
    if (provider === 'doku') return false;
    if (!webhookData || !webhookData.signature_key || !serverKey) return false;
    const { order_id, status_code, gross_amount, signature_key } = webhookData;
    const raw = `${order_id}${status_code}${gross_amount}${serverKey}`;
    return crypto.createHash('sha512').update(raw).digest('hex') === signature_key;
  }

  static handleWebhook(webhookData, { skipSignatureCheck = false, provider = null, headers = {}, notificationPath = '' } = {}) {
    if (!provider || !['doku', 'midtrans'].includes(provider)) {
      throw new Error('[PaymentGatewayService] INVALID_PAYMENT_PROVIDER: Provider webhook wajib diisi secara eksplisit dan harus valid ("doku" atau "midtrans").');
    }
    const orderId = provider === 'doku'
      ? (webhookData.order && webhookData.order.invoice_number) || ''
      : (webhookData.order_id || '');
    const grossAmount = provider === 'doku'
      ? (webhookData.order && webhookData.order.amount)
      : webhookData.gross_amount;
    let payment = paymentRepository.findPaymentByOrderId(orderId);
    const order = paymentRepository.findOrder(orderId);

    if (order && order.order_type === 'reservation') {
      throw new Error('[PaymentGatewayService] PAYMENT_NOT_APPLICABLE: Reservation webhook/payment lifecycle is not supported.');
    }

    const branchId = webhookData._branch_id || (order && order.branch_id);
    const brandId = webhookData._brand_id || (order && order.brand_id);
    const config = this.resolvePaymentConfig(branchId, brandId);
    const gateway = provider === 'doku'
      ? new DokuGateway(this._gatewayConfig(config))
      : new MidtransGateway(this._gatewayConfig(config));

    if (!skipSignatureCheck) {
      if (provider === 'doku') {
        if (!config.secret_key) throw new Error(`[PaymentGatewayService] Secret Key DOKU belum dikonfigurasi. Webhook ditolak demi keamanan.`);
        if (!gateway.verifySignature(headers, webhookData, notificationPath)) {
          throw new Error(`[PaymentGatewayService Signature Fraud]: Signature webhook DOKU tidak valid untuk order "${orderId}". Transaksi ditolak.`);
        }
      } else {
        if (!config.server_key) throw new Error(`[PaymentGatewayService] Server Key Midtrans belum dikonfigurasi untuk brand/cabang order "${orderId}". Webhook ditolak demi keamanan.`);
        if (!webhookData.signature_key) throw new Error(`[PaymentGatewayService] Signature key tidak disertakan pada webhook payload untuk order "${orderId}". Webhook ditolak.`);
        if (!gateway.verifySignature(webhookData)) throw new Error(`[PaymentGatewayService Signature Fraud]: Signature webhook Midtrans tidak valid untuk order "${orderId}". Transaksi ditolak.`);
      }
    }

    if (!payment) {
      if (!order) throw new Error(`[PaymentGatewayService] Data pesanan untuk Order ID "${orderId}" tidak ditemukan.`);
      const healNow = new Date().toISOString();
      paymentRepository.ensurePendingPayment({
        paymentId: `pay_${crypto.randomBytes(6).toString('hex')}`,
        orderId: orderId,
        provider: provider,
        paymentMethod: provider,
        merchantId: provider === 'doku' ? (config.client_id || 'doku_default') : (config.merchant_id || 'midtrans_default'),
        amount: order.grand_total,
        createdAt: healNow,
        updatedAt: healNow
      });
      payment = paymentRepository.findPaymentByOrderId(orderId);
    }

    const { mappedStatus, shouldSettle } = gateway.parseWebhookStatus(webhookData);
    let newPaymentStatus = PaymentModel.STATUSES.PENDING;

    if (mappedStatus === 'challenge') newPaymentStatus = PaymentModel.STATUSES.CHALLENGE;
    else if (shouldSettle) newPaymentStatus = PaymentModel.STATUSES.SETTLEMENT;
    else if (['cancel', 'deny', 'expire'].includes(mappedStatus)) newPaymentStatus = mappedStatus;

    if (payment.payment_status === PaymentModel.STATUSES.SETTLEMENT && newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) return { success: true, idempotent: true, order_id: orderId, payment_status: PaymentModel.STATUSES.SETTLEMENT, message: 'Pembayaran sudah diselesaikan sebelumnya.' };
    if (payment.payment_status === newPaymentStatus) return { success: true, idempotent: true, order_id: orderId, payment_status: newPaymentStatus, message: `Status pembayaran sudah berada pada "${newPaymentStatus}".` };
    if (!PaymentModel.canTransition(payment.payment_status, newPaymentStatus)) throw new Error(`[PaymentGatewayService State Violation]: Transisi status pembayaran tidak valid dari "${payment.payment_status}" ke "${newPaymentStatus}". Status terminal tidak dapat diubah.`);
    if (order && order.status === 'cancelled' && shouldSettle) throw new Error(`[PaymentGatewayService State Violation]: Pesanan "${orderId}" sudah dibatalkan (cancelled) dan tidak dapat dikonfirmasi ulang.`);

    if (shouldSettle || newPaymentStatus === PaymentModel.STATUSES.SETTLEMENT) {
      const gatewayAmount = Number(grossAmount);
      const orderAmount = order ? Number(order.grand_total) : null;
      const paymentAmount = Number(payment.amount);
      if (!Number.isFinite(gatewayAmount) || (orderAmount !== null && Math.round(gatewayAmount) !== Math.round(orderAmount)) || Math.round(gatewayAmount) !== Math.round(paymentAmount)) throw new Error(`[PAYMENT_AMOUNT_MISMATCH]: Nominal pembayaran gateway (Rp ${gatewayAmount}) tidak cocok dengan tagihan order (Rp ${orderAmount}) atau payment record (Rp ${paymentAmount}). Transaksi settlement ditolak demi integritas finansial.`);
    }

    const now = new Date().toISOString();
    let orderStatusAfterSettlement = null;
    paymentRepository.beginTransaction();
    try {
      paymentRepository.updatePaymentWebhook({
        orderId: orderId,
        paymentStatus: newPaymentStatus,
        webhookResponse: JSON.stringify(webhookData),
        settledAt: now,
        updatedAt: now,
        provider: provider,
        paymentMethod: provider
      });

      if (shouldSettle) {
        let currentOrderState = paymentRepository.findOrderStatus(orderId);
        // Payment settlement is financially authoritative only. It must never
        // perform Branch Acceptance (pending -> confirmed) or activate Dining.
        const terminalOrderStatuses = ['rejected', 'timeout', 'cancelled', 'fulfillment_exception'];
        if (currentOrderState && terminalOrderStatuses.includes(currentOrderState.status)) {
          orderStatusAfterSettlement = 'fulfillment_exception';
          paymentRepository.markFulfillmentException({
            orderId: orderId,
            note: `[Perlu Refund]: Pembayaran diterima setelah pesanan berstatus "${currentOrderState.status}". Pesanan tidak diaktifkan ulang.`,
            updatedAt: now
          });
          releaseClaimIfNeverAccepted(orderId, currentOrderState.status, `Settlement after order left AWAITING (${currentOrderState.status})`);
        } else if (currentOrderState && isConsumingOrderStatus(currentOrderState.status)) {
          // Settlement after operational acceptance remains financial-only.
          // Stock/promo/Dining Session side effects already occurred (or were
          // intentionally omitted) at their authoritative operational boundary.
        }
      } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
        const cancelOrderResult = paymentRepository.cancelPendingOrder({ orderId: orderId, updatedAt: now });
        if (cancelOrderResult && cancelOrderResult.changes > 0) {
          const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
          PromotionEngineService.voidRedemptions({ order_id: orderId, reason: `Gateway status ${newPaymentStatus}` });
          if (order && order.order_type === 'dine_in') {
            try {
              const { DiningTableService } = require('../../dining');
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
          paymentRepository.updatePaymentWebhook({ orderId: orderId, paymentStatus: 'settlement', webhookResponse: JSON.stringify(webhookData), settledAt: now, updatedAt: now });
          const notePrefix = err.message.includes('[PROMO_LIMIT_EXCEEDED_RACE]') ? `[Kendala Promo / Perlu Penyesuaian/Refund]: ${err.message}` : `[Kendala Stok / Perlu Refund]: ${err.message}`;
          const preExceptionStatus = paymentRepository.findOrderStatus(orderId);
          paymentRepository.markFulfillmentException({ orderId: orderId, note: notePrefix, updatedAt: now });
          releaseClaimIfNeverAccepted(orderId, preExceptionStatus && preExceptionStatus.status, `Fulfillment exception before acceptance: ${err.message}`);
          paymentRepository.commitTransaction();
          events.EventBus.publish({ type: 'payment.fulfillment_exception', producer: 'payment', payload: { payment_id: payment.id, order_id: orderId, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: gateway.name, amount: Number(grossAmount || payment.amount), error: err.message, settled_at: now } }).catch(() => {});
          return { success: true, order_id: orderId, payment_status: 'settlement', order_status: 'fulfillment_exception', message: 'Pembayaran berhasil diselesaikan namun terdapat kendala ketersediaan stok atau batas promosi. Pesanan dialihkan ke antrean fulfillment exception untuk rekonsiliasi refund.' };
        } catch (_) { try { paymentRepository.rollbackTransaction(); } catch (_) {} }
      }
      throw new Error(`[PaymentGatewayService Transaction Error]: ${err.message}`);
    }

    if (shouldSettle) {
      if (orderStatusAfterSettlement === 'fulfillment_exception') events.EventBus.publish({ type: 'payment.fulfillment_exception', producer: 'payment', payload: { payment_id: payment.id, order_id: orderId, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: gateway.name, amount: Number(grossAmount || payment.amount), error: `Settlement arrived after order left AWAITING (${orderStatusAfterSettlement}).`, settled_at: now } }).catch(() => {});
      else events.EventBus.publish({ type: 'payment.settled', producer: 'payment', payload: { payment_id: payment.id, order_id: orderId, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: gateway.name, payment_method: gateway.name, amount: Number(grossAmount || payment.amount), settled_at: now } }).catch(() => {});
    } else if (['cancel', 'deny', 'expire'].includes(newPaymentStatus)) {
      events.EventBus.publish({ type: 'payment.failed', producer: 'payment', payload: { payment_id: payment.id, order_id: orderId, branch_id: order?.branch_id, provider: gateway.name, status: newPaymentStatus } }).catch(() => {});
    }

    return { success: true, order_id: orderId, payment_status: newPaymentStatus, ...(orderStatusAfterSettlement ? { order_status: orderStatusAfterSettlement } : {}) };
  }

  static async checkTransactionStatus(order_id) {
    const payment = paymentRepository.findPaymentByOrderId(order_id);
    const order = paymentRepository.findOrder(order_id);
    if (!order) throw new Error(`[PaymentGatewayService] Order "${order_id}" tidak ditemukan.`);
    if (order.order_type === 'reservation') {
      throw new Error('[PaymentGatewayService] PAYMENT_NOT_APPLICABLE: Reservation does not have a payment transaction to reconcile.');
    }
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const provider = (payment && payment.provider) || this._resolveProvider(config);
    if (!provider || !['doku', 'midtrans'].includes(provider)) {
      throw new Error(`[PaymentGatewayService] INVALID_PAYMENT_PROVIDER: Provider pembayaran untuk order "${order_id}" tidak valid atau tidak diketahui.`);
    }
    const gateway = provider === 'doku'
      ? new DokuGateway(this._gatewayConfig(config))
      : new MidtransGateway(this._gatewayConfig(config));

    try {
      const data = await gateway.checkTransactionStatus(order_id);
      if (data) {
        const normalizedData = { ...data };
        if (provider === 'midtrans') {
          return this.handleWebhook(normalizedData, { skipSignatureCheck: true, provider: 'midtrans' });
        }
        if (provider === 'doku') {
          let txStatus = data.transaction?.status || data.response?.status;
          if (!txStatus && data.order?.status) {
            if (data.order.status === 'ORDER_EXPIRED') txStatus = 'EXPIRED';
            else if (data.order.status === 'ORDER_GENERATED') txStatus = 'PENDING';
          }
          const dokuData = {
            ...data,
            order: {
              invoice_number: order_id,
              amount: (data.order && data.order.amount) || order.grand_total,
              ...(data.order || {})
            },
            transaction: {
              status: txStatus || 'PENDING',
              ...(data.transaction || {})
            }
          };
          return this.handleWebhook(dokuData, { skipSignatureCheck: true, provider: 'doku' });
        }
      }
    } catch (err) {
      if (err.response?.status === 404) {
        const now = new Date().toISOString();
        paymentRepository.beginTransaction();
        try {
          paymentRepository.updatePaymentStatus({ orderId: order_id, paymentStatus: 'cancel', updatedAt: now });
          const orderCancelled = paymentRepository.cancelPendingOrder({ orderId: order_id, updatedAt: now });
          paymentRepository.commitTransaction();
          const orderStatus = orderCancelled?.changes > 0 ? 'cancelled' : null;
          return { success: true, order_id, payment_status: 'cancel', ...(orderStatus ? { order_status: orderStatus } : {}), message: orderStatus ? `Transaksi tidak ditemukan di gateway ${gateway.name}. Pembayaran resmi dibatalkan.` : `Transaksi tidak ditemukan di gateway ${gateway.name}. Pembayaran dicatat batal; status pesanan terminal dipertahankan.` };
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
