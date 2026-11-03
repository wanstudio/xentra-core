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
const PosBillRepository = require('../../../core/data/repositories/PosBillRepository');
const posBillRepository = new PosBillRepository();

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
  static handleCheckPaymentWebhook(webhookData, intent, { skipSignatureCheck = false, provider, headers = {}, notificationPath = '' } = {}) {
    const order = paymentRepository.findOrder(intent.order_id);
    const check = posBillRepository.findCheck(intent.check_id);
    if (!order || !check || check.order_id !== order.id) throw new Error('[PaymentGatewayService] Check payment intent tidak terhubung ke bill aktif.');
    if (intent.provider !== provider) throw new Error('[PaymentGatewayService] Provider callback tidak sesuai payment intent.');
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const gateway = provider === 'doku' ? new DokuGateway(this._gatewayConfig(config)) : new MidtransGateway(this._gatewayConfig(config));
    if (!skipSignatureCheck) {
      if (provider === 'doku') {
        if (!config.secret_key || !gateway.verifySignature(headers, webhookData, notificationPath)) throw new Error('[PaymentGatewayService] Signature webhook DOKU check payment tidak valid.');
      } else if (!config.server_key || !webhookData.signature_key || !gateway.verifySignature(webhookData)) {
        throw new Error('[PaymentGatewayService] Signature webhook Midtrans check payment tidak valid.');
      }
    }
    const { mappedStatus, shouldSettle } = gateway.parseWebhookStatus(webhookData);
    const nextStatus = shouldSettle ? PaymentModel.STATUSES.SETTLEMENT : ['cancel', 'deny', 'expire'].includes(mappedStatus) ? mappedStatus : mappedStatus === 'challenge' ? PaymentModel.STATUSES.CHALLENGE : PaymentModel.STATUSES.PENDING;
    if (intent.payment_status === PaymentModel.STATUSES.SETTLEMENT && shouldSettle) return { success: true, idempotent: true, order_id: order.id, check_id: check.id, payment_status: 'settlement' };
    if (intent.payment_status === nextStatus) return { success: true, idempotent: true, order_id: order.id, check_id: check.id, payment_status: nextStatus };
    if (!PaymentModel.canTransition(intent.payment_status, nextStatus)) throw new Error(`[PaymentGatewayService] Invalid check payment transition: ${intent.payment_status} -> ${nextStatus}.`);
    if (shouldSettle) {
      const gross = Number(provider === 'doku' ? webhookData.order && webhookData.order.amount : webhookData.gross_amount);
      if (!Number.isFinite(gross) || Math.round(gross) !== Math.round(Number(intent.amount)) || gross > Number(order.grand_total)) throw new Error('[PAYMENT_AMOUNT_MISMATCH]: Nominal callback tidak sama dengan alokasi check atau melebihi total bill.');
    }
    const now = new Date().toISOString();
    posBillRepository.beginTransaction();
    try {
      const currentIntent = posBillRepository.findCheckPaymentIntentByGatewayOrderId(intent.gateway_order_id);
      if (!currentIntent) throw new Error('[PaymentGatewayService] Check payment intent tidak ditemukan lagi.');
      if (currentIntent.payment_status === PaymentModel.STATUSES.SETTLEMENT && shouldSettle) {
        posBillRepository.commit();
        return { success: true, idempotent: true, order_id: order.id, check_id: check.id, payment_status: 'settlement' };
      }
      if (!PaymentModel.canTransition(currentIntent.payment_status, nextStatus)) throw new Error(`[PaymentGatewayService] Invalid locked check payment transition: ${currentIntent.payment_status} -> ${nextStatus}.`);
      const locked = posBillRepository.findCheck(intent.check_id);
      const alreadyPaid = posBillRepository.findCheckPaidAmount(intent.check_id);
      if (shouldSettle && Number(intent.amount) + alreadyPaid > Number(locked.allocated_amount) + 0.000001) throw new Error('[PaymentGatewayService] Settlement melampaui sisa alokasi Check.');
      const paidAcrossOrder = posBillRepository.findOrderPaidAmount(order.id);
      if (shouldSettle && paidAcrossOrder + Number(intent.amount) > Number(order.grand_total) + 0.000001) throw new Error('[PaymentGatewayService] Settlement melampaui sisa bill meja.');
      posBillRepository.updateCheckPaymentIntentWebhook({ gatewayOrderId: intent.gateway_order_id, paymentStatus: nextStatus, rawResponse: JSON.stringify(webhookData), settledAt: now, updatedAt: now });
      if (shouldSettle) {
        posBillRepository.createCheckPayment({ id: `pcp_${intent.id}`, checkId: intent.check_id, orderId: order.id, paymentMethod: provider, provider, amount: Number(intent.amount), payerName: null, actorId: null, rawPayment: JSON.stringify({ gateway_order_id: intent.gateway_order_id, intent_id: intent.id }), settledAt: now, now });
        const checkPaid = alreadyPaid + Number(intent.amount);
        if (checkPaid >= Number(locked.allocated_amount) - 0.000001) posBillRepository.setCheckStatus(locked.id, 'paid', now);
        const orderPaid = posBillRepository.findOrderPaidAmount(order.id);
        if (orderPaid >= Number(order.grand_total) - 0.000001) paymentRepository.settleOrderFromCheckPayments({ orderId: order.id, amount: Number(order.grand_total), settledAt: now, rawPayment: JSON.stringify({ source: 'pos_check_payment_gateway', order_paid: orderPaid }), updatedAt: now });
      }
      posBillRepository.commit();
    } catch (err) { try { posBillRepository.rollback(); } catch (_) {} throw err; }
    return { success: true, order_id: order.id, check_id: check.id, payment_status: nextStatus };
  }

  static async createCheckPaymentTransaction({ order, check, amount, payer_name = null }) {
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const provider = this._resolveProvider(config);
    if (!provider || !['midtrans', 'doku'].includes(provider)) throw new Error('[PaymentGatewayService] Gateway online aktif tidak ditemukan.');
    const gatewayOrderId = `pc_${crypto.randomBytes(16).toString('hex')}`;
    const now = new Date().toISOString();
    posBillRepository.beginTransaction();
    try {
      const lockedCheck = posBillRepository.findCheck(check.id);
      if (!lockedCheck || lockedCheck.order_id !== order.id || lockedCheck.status !== 'open') throw new Error('[PaymentGatewayService] Check tidak lagi terbuka.');
      const checkPaid = posBillRepository.findCheckPaidAmount(check.id);
      const pendingAmount = posBillRepository.findPendingCheckIntentAmount(check.id);
      const remaining = Number(lockedCheck.allocated_amount) - checkPaid - pendingAmount;
      const orderPaid = posBillRepository.findOrderPaidAmount(order.id);
      const orderPending = posBillRepository.findOrderPendingCheckIntentAmount(order.id);
      const orderRemaining = Number(order.grand_total) - orderPaid - orderPending;
      if (Number(amount) <= 0 || Number(amount) > remaining + 0.000001 || Number(amount) > orderRemaining + 0.000001) throw new Error('[PaymentGatewayService] Nominal online melebihi saldo Check atau bill yang belum dibayar/sedang diproses.');
      posBillRepository.createCheckPaymentIntent({ id: `pci_${crypto.randomBytes(10).toString('hex')}`, gatewayOrderId, orderId: order.id, checkId: check.id, provider, amount: Number(amount), now });
      posBillRepository.commit();
    } catch (err) { try { posBillRepository.rollback(); } catch (_) {} throw err; }
    try {
      const gateway = this._getGateway(config, provider);
      const gatewayOrder = { id: gatewayOrderId, grand_total: Number(amount), payment_method: provider, order_type: order.order_type, branch_id: order.branch_id, brand_id: order.brand_id, customer_name: payer_name || 'Pembayaran Check', customer_phone: '' };
      const result = await gateway.createTransaction(gatewayOrder, [{ id: check.id, product_name: `Pembayaran meja - Check ${check.check_number}`, unit_price: Number(amount), quantity: 1 }], { name: payer_name || 'Pelanggan', phone: '' });
      posBillRepository.updateCheckPaymentIntentGateway({ gatewayOrderId, snapToken: result.snap_token, redirectUrl: result.redirect_url, merchantId: result.merchant_id, transactionId: result.transaction_id || null, rawResponse: JSON.stringify(result), updatedAt: new Date().toISOString() });
      return { success: true, payment: { provider, status: 'pending', amount: Number(amount), gateway_order_id: gatewayOrderId, snap_token: result.snap_token || null, redirect_url: result.redirect_url || null, merchant_id: result.merchant_id || null } };
    } catch (err) {
      posBillRepository.updateCheckPaymentIntentStatus({ gatewayOrderId, paymentStatus: 'cancel', updatedAt: new Date().toISOString() });
      throw err;
    }
  }

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
    const checkIntent = posBillRepository.findCheckPaymentIntentByGatewayOrderId(orderId);
    if (checkIntent) return this.handleCheckPaymentWebhook(webhookData, checkIntent, { skipSignatureCheck, provider, headers, notificationPath });
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
      const sharedDineInCycle = Boolean(order && order.order_type === 'dine_in' && order.dining_session_id);
      const exceedsCurrentSharedBill = sharedDineInCycle && orderAmount !== null && Math.round(gatewayAmount) > Math.round(orderAmount);
      const changedNonSharedOrderTotal = !sharedDineInCycle && orderAmount !== null && Math.round(gatewayAmount) !== Math.round(orderAmount);
      if (!Number.isFinite(gatewayAmount) || changedNonSharedOrderTotal || exceedsCurrentSharedBill || Math.round(gatewayAmount) !== Math.round(paymentAmount)) {
        throw new Error(`[PAYMENT_AMOUNT_MISMATCH]: Nominal pembayaran gateway (Rp ${gatewayAmount}) tidak cocok dengan snapshot payment (Rp ${paymentAmount}) atau melebihi tagihan saat ini (Rp ${orderAmount}). Settlement ditolak demi integritas finansial.`);
      }
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
        try {
          paymentRepository.db.execute("UPDATE orders SET payment_status = 'settlement', updated_at = ? WHERE id = ?", [now, orderId]);
        } catch (_) {}
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
          // Operational side effects belong after Branch Acceptance. A payment
          // settlement for an AWAITING order records money only and leaves the
          // order/table/session lifecycle untouched.
          const OrderPlacementService = require('../../commerce/services/OrderPlacementService');
          OrderPlacementService.deductStockForSettledOrder(orderId, { dbTransactionProvided: true });

          const PromotionEngineService = require('../../promotion/services/PromotionEngineService');
          PromotionEngineService.recordOrderRedemptions(order);

          if (order && order.order_type === 'dine_in') {
            // Invariant: payment completion alone does not activate the dining session.
            // Active Dining Session begins when the Merchant operationally accepts the order.
            // If the order has already been operationally accepted, ensure session is created/attached.
            if (order.status === 'confirmed') {
              try {
                const { DiningTableService } = require('../../dining');
                let tableIds = [];
                const activeHold = diningTableRepository.findActiveHolds(order.id);
                if (activeHold && activeHold.length > 0) tableIds = activeHold.map(h => h.table_id);
                else if (order.table_number) {
                  const tbl = diningTableRepository.findTableIdByNumberOrLabel(order.branch_id, order.table_number);
                  if (tbl) tableIds = [tbl.id];
                }
                if (tableIds.length > 0) {
                  DiningTableService.createOrAttachDiningSession({
                    branch_id: order.branch_id,
                    table_ids: tableIds,
                    order_id: order.id,
                    customer_name: order.customer_name,
                    customer_phone: order.customer_phone,
                    guest_count: 1,
                    hold_reference_id: order.id,
                    channel: order.order_channel || 'customer_app'
                  });
                }
              } catch (dineErr) {
                console.warn('[PaymentGatewayService] Dine-in table settlement warning:', dineErr.message);
              }
            }
          }
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
      else {
        events.EventBus.publish({ type: 'payment.settled', producer: 'payment', payload: { payment_id: payment.id, order_id: orderId, branch_id: order?.branch_id, brand_id: order?.brand_id, provider: gateway.name, payment_method: gateway.name, amount: Number(grossAmount || payment.amount), settled_at: now } }).catch(() => {});

        // Trigger notification for merchant staff upon confirmed online payment (GoFood/GrabFood standard)
        if (order && order.branch_id) {
          try {
            const NotificationService = require('../../../core/notification/NotificationService');
            const notifService = new NotificationService(paymentRepository.db);
            const displayCode = String(order.order_number || '').startsWith('#') ? order.order_number : ('#' + (order.order_number || orderId.slice(-3)));
            notifService.createNotification({
              brand_id: order.brand_id || null,
              branch_id: order.branch_id || null,
              source_type: 'order',
              title: 'Ada Pesanan Baru Masuk (Lunas)!',
              body: `Pesanan ${displayCode} (${order.order_type === 'delivery' ? 'Delivery' : order.order_type === 'dine_in' ? 'Dine In' : 'Takeaway'}) senilai Rp ${Number(grossAmount || payment.amount || order.grand_total || 0).toLocaleString('id-ID')}`,
              priority: 'high',
              target_role: null,
              target_scope: 'branch',
              related_entity_type: 'order',
              related_entity_id: orderId,
              action_url: `/merchant/orders/${orderId}`
            });
          } catch (notifErr) {
            console.error('[Payment Settlement Notification Error]:', notifErr.message);
          }
        }
      }
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

  static async reconcileCheckPaymentIntent(intent) {
    const order = paymentRepository.findOrder(intent.order_id);
    if (!order) throw new Error(`[PaymentGatewayService] Order intent ${intent.order_id} tidak ditemukan.`);
    const config = this.resolvePaymentConfig(order.branch_id, order.brand_id);
    const gateway = intent.provider === 'doku'
      ? new DokuGateway(this._gatewayConfig(config))
      : new MidtransGateway(this._gatewayConfig(config));
    try {
      const data = await gateway.checkTransactionStatus(intent.gateway_order_id);
      if (!data) return { success: true, order_id: order.id, check_id: intent.check_id, payment_status: intent.payment_status };
      if (intent.provider === 'midtrans') {
        return this.handleWebhook({ ...data, order_id: intent.gateway_order_id }, { skipSignatureCheck: true, provider: 'midtrans' });
      }
      let txStatus = data.transaction?.status || data.response?.status;
      if (!txStatus && data.order?.status === 'ORDER_EXPIRED') txStatus = 'EXPIRED';
      if (!txStatus && data.order?.status === 'ORDER_GENERATED') txStatus = 'PENDING';
      const dokuData = {
        ...data,
        order: { ...(data.order || {}), invoice_number: intent.gateway_order_id, amount: (data.order && data.order.amount) || intent.amount },
        transaction: { ...(data.transaction || {}), status: txStatus || 'PENDING' }
      };
      return this.handleWebhook(dokuData, { skipSignatureCheck: true, provider: 'doku' });
    } catch (err) {
      if (err.response?.status === 404) {
        const now = new Date().toISOString();
        posBillRepository.beginTransaction();
        try {
          const current = posBillRepository.findCheckPaymentIntentByGatewayOrderId(intent.gateway_order_id);
          if (current && ['pending', 'challenge', 'reconciliation_pending'].includes(current.payment_status)) {
            posBillRepository.updateCheckPaymentIntentWebhook({ gatewayOrderId: intent.gateway_order_id, paymentStatus: 'cancel', rawResponse: JSON.stringify({ reconciliation: 'gateway_not_found' }), settledAt: null, updatedAt: now });
          }
          posBillRepository.commit();
        } catch (updateError) { try { posBillRepository.rollback(); } catch (_) {} throw updateError; }
        return { success: true, order_id: order.id, check_id: intent.check_id, payment_status: 'cancel', message: 'Gateway tidak menemukan intent; reservasi nominal dilepas.' };
      }
      throw new Error(`[PaymentGatewayService] Gagal merekonsiliasi intent check ${intent.gateway_order_id}: ${err.message}`);
    }
  }

  static async reconcilePendingPayments() {
    const pendingList = paymentRepository.findPendingReconciliationPayments();
    const results = [];
    for (const row of pendingList) {
      try { results.push({ order_id: row.order_id, success: true, result: await this.checkTransactionStatus(row.order_id) }); }
      catch (err) { results.push({ order_id: row.order_id, success: false, error: err.message }); }
    }
    for (const intent of posBillRepository.findCheckPaymentIntentsForReconciliation()) {
      try { results.push({ order_id: intent.order_id, check_id: intent.check_id, gateway_order_id: intent.gateway_order_id, success: true, result: await this.reconcileCheckPaymentIntent(intent) }); }
      catch (err) { results.push({ order_id: intent.order_id, check_id: intent.check_id, gateway_order_id: intent.gateway_order_id, success: false, error: err.message }); }
    }
    return results;
  }
}

module.exports = PaymentGatewayService;
