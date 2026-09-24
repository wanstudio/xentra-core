/**
 * XENTRA CORE — CUSTOMER CHECKOUT ROUTES
 *
 * Checkout verification and order submission remain server-authoritative.
 * Customer authentication/session logic lives in customer-auth.js.
 */
'use strict';

const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
const { DiningTableService } = require('../../domains/pos');
const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');

module.exports = function registerCheckoutRoutes(router, deps) {
  const {
    db,
    crypto,
    PaymentService,
    BranchMatcher,
    DeliveryCalculator,
    RouteService,
    CatalogService,
    TokenSessionStore,
    OrderStateMachine,
    AcceptanceTimeoutService,
    authorizeCustomerSession,
    requireCustomerAuth
  } = deps;

router.post('/checkout/verify', requireCustomerAuth(), (req, res) => {
  try {
    const { branch_id, items = [], order_type = 'delivery', pwa_runtime = null } = req.body;
    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'Cabang pemesanan (branch_id) wajib dipilih.' });
    }
    
    // R1 CART/CHECKOUT BOUNDARY — CHECKOUT IS SINGLE-BRANCH: reject any
    // verification payload mixing item branch provenance or contradicting the
    // checkout branch before any further evaluation. No silent merge/split.
    const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branch_id, items);
    if (scopeError) {
      return res.status(400).json({ success: false, status: scopeError.status, error: scopeError.error });
    }

    if (order_type === 'reservation') {
      return res.json({ success: true, is_valid: true, status: 'VERIFIED', verified_items: [], price_diffs: [], errors: [] });
    }
    const verification = PrePaymentVerificationGate.verify({
      branch_id,
      brand_id: req.brand_id,
      items,
      customer: { phone: req.customer.phone, name: req.body.customer?.name || '' },
      pwa_runtime
    });
    return res.json({
      success: verification.is_valid,
      ...verification
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Create Order & Submit Checkout
router.post(['/checkout/create-order', '/checkout/submit'], async (req, res) => {
  try {
    let {
      branch_id,
      customer = {},
      pwa_runtime = null,
      order_type,
      fulfillment = {},
      schedule_type = 'asap',
      scheduled_slot_start,
      scheduled_slot_end,
      table_number,
      reservation_date,
      reservation_time,
      guest_count,
      delivery,
      address,
      items = [],
      payment_method = 'cash',
      cash_tendered = null,
      note = '',
      order_note = ''
    } = req.body;

    order_type = order_type || fulfillment.type || 'delivery';
    order_note = order_note || note || '';
    table_number = table_number || fulfillment.table_number || null;
    reservation_date = reservation_date || fulfillment.reservation_date || null;
    reservation_time = reservation_time || fulfillment.reservation_time || null;
    guest_count = guest_count || fulfillment.guest_count || null;

    if (address && !delivery) {
      delivery = {
        latitude: address.latitude,
        longitude: address.longitude,
        address: address.formatted_address || address.address || 'Alamat Customer'
      };
    }

    // P1 SECURE PAYMENT METHOD VALIDATION: Whitelist only officially supported payment methods
    const allowedPaymentMethods = ['cash', 'midtrans', 'doku'];
    if (!payment_method || !allowedPaymentMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_PAYMENT_PROVIDER',
        error: 'INVALID_PAYMENT_PROVIDER',
        message: `Metode pembayaran "${payment_method}" tidak valid. Pilihan yang didukung: ${allowedPaymentMethods.join(', ')}.`
      });
    }

    // COD CASH TENDER VALIDATION:
    // If cash payment, cash_tendered must be a valid positive number if provided,
    // and non-negative / non-empty when custom tender is specified.
    let parsedCashTendered = null;
    if (payment_method === 'cash') {
      if (cash_tendered !== null && cash_tendered !== undefined && cash_tendered !== '') {
        const numTendered = Number(cash_tendered);
        if (!Number.isFinite(numTendered) || numTendered < 0 || isNaN(numTendered)) {
          return res.status(400).json({
            success: false,
            error: 'Nominal uang tunai (cash_tendered) tidak valid. Masukkan angka yang valid.'
          });
        }
        parsedCashTendered = Math.round(numTendered);
      }
    }

    // P1 CUSTOMER IDENTITY BINDING (NEW-02): Extract customer session token
    const authHeader = req.headers['authorization'] || '';
    const customerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();

    if (!customerToken) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Checkout memerlukan otentikasi. Silakan login atau verifikasi nomor WhatsApp Anda.'
      });
    }

    const customerSession = TokenSessionStore.getSession(customerToken);

    // CUSTOMER AUTH BOUNDARY: Checkout requires a valid authenticated customer session.
    // Sessions may be issued via OTP (xnt_cust_ prefix) or Google Identity Gate (also xnt_cust_ prefix).
    // The server is the sole authority for customer identity — client-provided phone
    // is never trusted as the sole identity source for order creation.
    if (!customerSession || (customerSession.type !== 'customer' && customerSession.role !== 'customer')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
        message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa. Silakan masuk kembali untuk melanjutkan.'
      });
    }

    const authCheck = authorizeCustomerSession(customerSession, req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({
        success: false,
        error: authCheck.error,
        message: authCheck.message
      });
    }

    // Authoritative identity from customer session — never from request body.
    // For OTP sessions: phone is the WhatsApp number.
    // For Google sessions: phone field holds the Google email (used as contact identifier).
    customer.phone = customerSession.phone;

    // For Google-auth sessions, also propagate name from session if request body name is missing.
    if (!customer.name && customerSession.name) {
      customer.name = customerSession.name;
    }

    // Locked Decision: Customer information must be valid
    if (!customer.phone || !customer.phone.trim()) {
      return res.status(400).json({ success: false, error: 'Nomor telepon customer wajib diisi.' });
    }
    if (!customer.name || !customer.name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama customer wajib diisi.' });
    }


    // P1 RECONCILIATION-AWARE CHECKOUT RECOVERY (NEW-01 & NEW-03):
    // If this customer already has an existing order in 'reconciliation_pending', query gateway before creating duplicate orders
    const existingRecon = db.prepare(`
      SELECT o.id, o.order_number, o.status, p.payment_status, p.snap_token
      FROM orders o
      JOIN order_payments p ON p.order_id = o.id
      WHERE o.brand_id = ? AND o.customer_phone = ? AND p.payment_status = 'reconciliation_pending'
      ORDER BY o.created_at DESC LIMIT 1
    `).get(req.brand_id, customer.phone.trim());

    if (existingRecon) {
      try {
        const inquiryRes = await PaymentService.checkTransactionStatus(existingRecon.id);
        if (inquiryRes && inquiryRes.payment_status === 'settlement') {
          return res.status(200).json({
            success: true,
            order_id: existingRecon.id,
            order_number: existingRecon.order_number,
            reconciled: true,
            message: 'Pesanan sebelumnya telah berhasil dikonfirmasi pembayarannya.',
            redirect: '/order-received/' + existingRecon.id
          });
        }
      } catch (inqErr) {
        console.warn('[Checkout Pending Recon Inquiry]:', inqErr.message);
      }
    }

    // P1 LOGIC VALIDATION (NEW-02): For delivery orders, strict coordinates are mandatory (NO fallback to default coordinates)
    if (order_type === 'delivery') {
      if (!delivery || delivery.latitude == null || delivery.longitude == null || isNaN(Number(delivery.latitude)) || isNaN(Number(delivery.longitude))) {
        return res.status(400).json({
          success: false,
          error: 'Titik koordinat pengantaran (latitude & longitude) wajib disertakan secara valid untuk pesanan delivery.'
        });
      }
    }

    // R2 BRANCH SELECTION MODE — how the fulfillment branch is established.
    // AUTO = Core matches the branch (BranchMatcher) from the delivery
    // destination; CUSTOMER_SELECTED = the customer explicitly chose branch_id
    // (INPUT, never authority — Core still validates eligibility).
    // selection_mode is distinct from fulfillment branch_id and is persisted
    // on the order for auditability. Legacy clients that send branch_id without
    // a mode are derived as CUSTOMER_SELECTED (unchanged behavior).
    let selection_mode = (req.body.selection_mode || req.body.selectionMode || '').toString().trim().toUpperCase();
    if (selection_mode && !['AUTO', 'CUSTOMER_SELECTED'].includes(selection_mode)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: `selection_mode "${selection_mode}" tidak valid. Gunakan AUTO atau CUSTOMER_SELECTED.`
      });
    }
    if (!selection_mode) {
      selection_mode = branch_id ? 'CUSTOMER_SELECTED' : 'AUTO';
    }
    if (selection_mode === 'CUSTOMER_SELECTED' && !branch_id) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: 'Mode CUSTOMER_SELECTED memerlukan branch_id yang dipilih customer.'
      });
    }
    if (selection_mode === 'AUTO' && branch_id) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_SELECTION_MODE',
        error: 'Mode AUTO berarti Core mencocokkan cabang dari tujuan pengantaran — kirim tanpa branch_id agar BranchMatcher memilih. Jangan mengirim branch_id pada mode AUTO.'
      });
    }

    // 1. Resolve Branch with Intelligence (Scoped strictly to current brand, NO arbitrary LIMIT 1)
    let branch = null;
    if (branch_id) {
      branch = db.prepare(`
        SELECT 
          b.id, b.brand_id, b.name, b.latitude, b.longitude,
          s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
        FROM branches b 
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
        WHERE b.id = ? AND b.brand_id = ? AND b.is_active = 1
      `).get(branch_id, req.brand_id);

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: `Cabang dengan ID "${branch_id}" tidak ditemukan atau sedang nonaktif pada brand ini.`
        });
      }

      // C4/CHECKOUT ALIGNMENT — CUSTOMER_SELECTED: an explicit branch_id is a
      // customer PREFERENCE, never trusted directly. Core validates the selected
      // branch through the SAME canonical operational eligibility as AUTO
      // (exists/active/open + represented fulfillment capability). If the
      // selected branch is ineligible we REJECT explicitly — there is
      // deliberately NO silent rematch to another branch. Reservation keeps its
      // existing dedicated path (it bypasses the pre-payment gate and has no
      // locked branch-open contract yet).
      if (order_type !== 'reservation') {
        const EligibilityService = require('../../domains/commerce/services/EligibilityService');
        const selectedElig = EligibilityService.evaluateBranch({
          brand_id: req.brand_id,
          branch_id: branch.id,
          order_type
        });

        if (!selectedElig.eligible) {
          const selectedBranchMsg = {
            BRANCH_NOT_FOUND: `Cabang "${branch_id}" tidak ditemukan pada brand ini.`,
            BRANCH_NOT_ACTIVE: `Cabang "${branch_id}" sedang nonaktif.`,
            BRANCH_CLOSED: `Cabang "${branch_id}" sedang tutup. Silakan pilih cabang lain.`,
            FULFILLMENT_NOT_SUPPORTED: `Cabang "${branch_id}" tidak mendukung metode pemesanan ini. Silakan pilih metode lain.`
          };
          const reason = selectedElig.reasons && selectedElig.reasons[0];
          return res.status(400).json({
            success: false,
            error: selectedBranchMsg[reason] || `Cabang "${branch_id}" tidak dapat melayani pesanan ini saat ini. Silakan pilih cabang lain.`,
            reason: reason || 'BRANCH_INELIGIBLE',
            branch_id: branch.id
          });
        }
      }
    } else if (order_type === 'delivery' && delivery && delivery.latitude != null && delivery.longitude != null) {
      // Intelligent Branch Resolution based on customer coordinates & cart availability
      const matchResult = await BranchMatcher.matchNearestBranch({
        brand_id: req.brand_id,
        customer_lat: Number(delivery.latitude),
        customer_lng: Number(delivery.longitude),
        subtotal: 0,
        items
      });

      if (matchResult && matchResult.eligible && matchResult.branch) {
        branch = db.prepare(`
          SELECT 
            b.id, b.brand_id, b.name, b.latitude, b.longitude,
            s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
          FROM branches b 
          LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
          WHERE b.id = ? AND b.brand_id = ?
        `).get(matchResult.branch.id, req.brand_id);
      } else {
        return res.status(400).json({
          success: false,
          error: matchResult ? matchResult.reason : 'Tidak ditemukan cabang terdekat yang dapat melayani pengantaran ke lokasi Anda.'
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'Cabang pemesanan (branch_id) wajib dipilih.'
      });
    }

    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang restoran tidak ditemukan untuk brand ini.' });
    }

    // R1 CART/CHECKOUT BOUNDARY — CHECKOUT IS SINGLE-BRANCH (multi-branch cart
    // is allowed, but each checkout/order resolves to exactly ONE fulfillment
    // branch). Per-item branch provenance declares the cart scope that produced
    // the item; mixing scopes, or shipping one scope against a different branch,
    // is REJECTED with CHECKOUT_SINGLE_BRANCH_REQUIRED. The system never
    // silently selects, merges, splits, or rematches items across branches.
        const scopeError = PrePaymentVerificationGate.assertSingleBranchCheckout(branch.id, items);
    if (scopeError) {
      return res.status(400).json({ success: false, status: scopeError.status, error: scopeError.error });
    }

    // 2. Authoritative Pre-Payment Verification Gate (Single Source of Truth for Product Pricing & Stock)
    let verifiedItems = [];
    let verifiedSubtotal = 0;

    if (order_type !== 'reservation') {
      const verification = PrePaymentVerificationGate.verify({
        branch_id: branch.id,
        brand_id: req.brand_id,
        items,
        customer,
        pwa_runtime
      });

      if (!verification.is_valid) {
        const primaryError = (verification.errors && verification.errors[0]) || 'Gagal memverifikasi produk atau harga pesanan.';
        return res.status(400).json({
          success: false,
          status: verification.status,
          error: primaryError,
          errors: verification.errors,
          price_diffs: verification.price_diffs
        });
      }

      verifiedItems = verification.verified_items;
      verifiedSubtotal = verifiedItems.reduce((acc, it) => acc + it.subtotal, 0);
    }

    // 3. Compute Delivery Fee using Authoritative Verified Subtotal
    let deliveryFee = 0;
    let discountAmount = 0;
    let deliveryRecord = null;

    if (order_type === 'delivery') {
      const custLat = Number(delivery.latitude);
      const custLng = Number(delivery.longitude);

      const road = await RouteService.getRoadDistance(
        branch.latitude,
        branch.longitude,
        custLat,
        custLng
      );

      const promoConfig = (Number(branch.promo_delivery_discount) > 0 && Number(branch.promo_min_order) > 0)
        ? { enabled: true, target: Number(branch.promo_min_order), discount: Number(branch.promo_delivery_discount) }
        : { enabled: false, target: 0, discount: 0 };

      // P1 AUTHORITATIVE PRICING INVARIANT (Finding NEW-01): Use verifiedSubtotal from server, NEVER client price
      const feeCalc = DeliveryCalculator.calculate({
        distance_meters: road.distance_meters,
        free_km: branch.free_delivery_km || 0,
        price_per_km: branch.price_per_km || 3000,
        max_radius_km: branch.max_radius_km || 30,
        subtotal: verifiedSubtotal,
        promo_config: promoConfig
      });

      if (!feeCalc.eligible) {
        return res.status(400).json({
          success: false,
          error: feeCalc.reason || 'Alamat pengantaran berada di luar radius layanan cabang ini.'
        });
      }

      deliveryFee = feeCalc.final_delivery_fee;
      discountAmount = feeCalc.discount_amount;

      deliveryRecord = {
        id: 'del_' + crypto.randomBytes(6).toString('hex'),
        destination_address: (delivery && delivery.address) || 'Alamat Customer',
        destination_latitude: custLat,
        destination_longitude: custLng,
        actual_road_distance_meters: feeCalc.distance_meters,
        actual_duration_seconds: road.duration_seconds,
        chargeable_distance_km: feeCalc.chargeable_distance_km,
        free_km_applied: feeCalc.free_km,
        rate_per_km_applied: feeCalc.price_per_km,
        delivery_fee_calculated: feeCalc.base_delivery_fee
      };
    }

    // 3. Dine-in Table Validation and Concurrency Hold
    let tableIdsToHold = [];
    if (order_type === 'dine_in') {
            let reqTableIds = [];
      if (req.body.table_id) {
        reqTableIds.push(req.body.table_id);
      } else if (Array.isArray(req.body.table_ids)) {
        reqTableIds = [...req.body.table_ids];
      }
      if (reqTableIds.length === 0 && table_number) {
        // Resolve table_id from table_number if table_ids array not directly sent
        const tblRow = db.prepare('SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)').get(branch.id, table_number, table_number);
        if (tblRow) reqTableIds.push(tblRow.id);
      }

      // Single-table enforcement for customer dine-in (Section 6 & Notion locked decision)
      if (reqTableIds.length > 1) {
        return res.status(400).json({
          success: false,
          status: 'SINGLE_TABLE_REQUIRED',
          error: 'Pesanan dine-in customer hanya diperbolehkan untuk 1 meja.'
        });
      }

      if (reqTableIds.length > 0) {
        // Authoritatively check availability
        const custPhone = (customer && customer.phone) || (customerSession && customerSession.phone) || null;
        const availCheck = DiningTableService.validateTablesAvailable(branch.id, reqTableIds, custPhone);
        if (!availCheck.valid) {
          return res.status(400).json({
            success: false,
            status: 'TABLE_UNAVAILABLE',
            error: availCheck.error,
            unavailable_table_id: availCheck.unavailable_table_id
          });
        }
        tableIdsToHold = reqTableIds;
      }
    }

    // R-Recipient Identity Layer: resolve authoritative recipient snapshot.
    // SELF = authenticated customer identity (from session — never trusted from client).
    // OTHER = validated recipient name + WhatsApp/mobile phone supplied by client.
    // Recipient ≠ buyer; stored as order snapshot, independent of addresses.
    const incomingRecipient = (req.body && req.body.recipient) || {};
    const isOther = !!incomingRecipient && incomingRecipient.type === 'other';
    let recipientName = (customerSession.name || customer.name || 'Pelanggan');
    let recipientPhone = (customerSession.phone || customer.phone || '');
    let recipient;
    if (isOther) {
      const rName = String(incomingRecipient.name || '').trim();
      const rawPhone = String(incomingRecipient.phone || '').trim();
      const clean = rawPhone.replace(/[^0-9]/g, '');
      const isIndoMobile = clean.startsWith('08') || clean.startsWith('628') || clean.startsWith('8');
      if (!rName) {
        return res.status(400).json({ success: false, error: 'Nama penerima wajib diisi.' });
      }
      if (!rawPhone || !isIndoMobile || clean.length < 9 || clean.length > 15) {
        return res.status(400).json({ success: false, error: 'Nomor WhatsApp/telepon penerima tidak valid.' });
      }
      recipientName = rName;
      recipientPhone = rawPhone;
      recipient = { type: 'other', name: rName, phone: rawPhone };
    } else {
      recipient = { type: 'self', name: recipientName, phone: recipientPhone };
    }

    // 4. Delegate Cleanly to OrderPlacementService (ACID database transaction & event publishing)
        const placementResult = await OrderPlacementService.submitOrder({
      brand_id: req.brand_id,
      branch_id: branch.id,
      client_transaction_id: req.body.client_transaction_id || req.body.clientTransactionId || null,
      customer: {
        id: customerSession.customerId || customerSession.customer_id || null,
        name: customer.name.trim(),
        phone: customer.phone.trim()
      },
      recipient,
      items,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      delivery_record: deliveryRecord,
      fulfillment_schedule_type: schedule_type,
      scheduled_slot_start: scheduled_slot_start || null,
      scheduled_slot_end: scheduled_slot_end || null,
      payment_method,
      cash_tendered: parsedCashTendered,
      order_channel: 'customer_app',
      order_type,
      selection_mode,
      table_number,
      table_id: tableIdsToHold[0] || req.body.table_id || null,
      table_ids: tableIdsToHold,
      dining_session_id: req.body.dining_session_id || req.body.sessionId || null,
      reservation_date,
      reservation_time,
      guest_count,
      pwa_runtime,
      notes: order_note,
      trace_context: {
        correlation_id: `chk_${Date.now()}`
      }
    });

    if (!placementResult.success) {
      const primaryError = (placementResult.errors && placementResult.errors[0]) || 'Gagal memproses pesanan.';
      return res.status(400).json({
        success: false,
        status: placementResult.status,
        error: primaryError,
        errors: placementResult.errors,
        price_diffs: placementResult.price_diffs
      });
    }

    const order = placementResult.order;
    const grandTotal = order.grand_total;
    const orderId = order.id;
    const orderNumber = order.order_number;
    const subtotal = order.subtotal;

    // Reservation is a booking, not a purchase. It must never enter table-hold
    // or online-payment gateway resolution, even if a malicious/stale client
    // sends payment_method=doku/midtrans.
    if (order_type === 'reservation') {
      return res.status(201).json({
        success: true,
        order_id: orderId,
        order_number: orderNumber,
        grand_total: 0,
        subtotal: 0,
        delivery_fee: 0,
        discount_amount: 0,
        cash_tendered: null,
        payment: {
          method: null,
          cash_tendered: null,
          expected_change: null,
          snap_token: null,
          redirect_url: null
        },
        snap_token: null,
        redirect_url: null,
        redirect: '/order-received/' + orderId,
        order: {
          ...order,
          order_type: 'reservation',
          payment_method: null
        }
      });
    }

    // 4a. Dine-in Table Hold for Payment / Acceptance Stage (15-minute hold)
    // Baseline Business Flow:
    // Customer -> QR / Floor Plan -> 1 Table -> Order (Hold Table / Pending) -> Merchant Accept -> Active Dining Session
    // A customer dine-in order does NOT immediately become an active dining session at checkout.
    // Both Cash and Online hold the table pending merchant acceptance or payment.
    // If the customer already has an active session, order is already linked to it.
    if (order_type === 'dine_in' && tableIdsToHold.length > 0 && !order.dining_session_id) {
            try {
        DiningTableService.holdTablesForPayment({
          branch_id: branch.id,
          table_id: tableIdsToHold[0],
          table_ids: tableIdsToHold,
          customer_phone: customer.phone,
          hold_reference_id: orderId,
          channel: 'customer_app'
        });
      } catch (tblHoldErr) {
        console.warn('[Checkout Dine-In Table Hold Warning]:', tblHoldErr.message);
      }
    }

    // 4. Payment Gateway Resolution (Midtrans Snap, DOKU Checkout, or Cash)
    let snapResult = { snap_token: null, redirect_url: null, merchant_id: payment_method === 'cash' ? 'cash' : (payment_method === 'doku' ? 'doku_default' : 'midtrans_default') };

    if (payment_method === 'midtrans' || payment_method === 'doku') {
      const existingPayment = placementResult.idempotent
        ? db.prepare('SELECT snap_token, merchant_id FROM order_payments WHERE order_id = ?').get(orderId)
        : null;
      if (existingPayment && existingPayment.snap_token) {
        snapResult = {
          snap_token: existingPayment.snap_token,
          redirect_url: null,
          merchant_id: existingPayment.merchant_id || (payment_method === 'doku' ? 'doku_default' : 'midtrans_default')
        };
      } else {
        let reqProto = 'https';
        try { reqProto = req.protocol || 'https'; } catch (_) { reqProto = 'https'; }
        let reqHost = 'localhost';
        try { reqHost = (typeof req.get === 'function' ? req.get('host') : req.headers?.host) || 'localhost'; } catch (_) { reqHost = 'localhost'; }
        const reqOrigin = `${reqProto}://${reqHost}`;
        const xentraOrderReceivedUrl = `${reqOrigin}/order-received/${orderId}`;
        try {
          snapResult = await PaymentService.createSnapTransaction(
            { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount, customer_name: customer.name, customer_phone: customer.phone, callback_url: xentraOrderReceivedUrl, payment_method: payment_method },
            order ? order.items : items,
            customer
          );
        } catch (payErr) {
          console.error('[Payment Gateway Error / Timeout]:', payErr.message);
          const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED|ECONNRESET/i.test(payErr.code || payErr.message);
          const isConfigError = /kredensial|belum dikonfigurasi|tidak ada gateway|client_id|secret_key|server_key/i.test(payErr.message);

          db.exec('BEGIN IMMEDIATE;');
          try {
            if (isTimeout) {
              db.prepare("UPDATE order_payments SET payment_status = 'reconciliation_pending', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
              db.prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(orderId);
            } else {
              db.prepare("UPDATE order_payments SET payment_status = 'failed', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
              db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(orderId);
            }
            db.exec('COMMIT;');
          } catch (_) {
            try { db.exec('ROLLBACK;'); } catch (_) {}
          }

          if (isConfigError) {
            return res.status(400).json({
              success: false,
              error: 'PAYMENT_GATEWAY_NOT_CONFIGURED',
              message: payErr.message || 'Layanan pembayaran online belum dikonfigurasi atau tidak aktif.'
            });
          }

          if (isTimeout) {
            return res.status(504).json({
              success: false,
              error: 'PAYMENT_GATEWAY_TIMEOUT',
              message: `Koneksi ke gateway pembayaran online mengalami timeout (${payErr.message}). Jika Anda sudah melakukan pembayaran, transaksi akan otomatis direkonsiliasi.`
            });
          }

          return res.status(502).json({
            success: false,
            error: 'PAYMENT_GATEWAY_ERROR',
            message: `Gagal memproses pembayaran melalui gateway (${payErr.message}). Silakan coba beberapa saat lagi atau pilih metode pembayaran lain.`
          });
        }
      }
    }

    if (snapResult.snap_token || snapResult.merchant_id) {
      db.prepare(`
        UPDATE order_payments
        SET snap_token = ?, merchant_id = ?, updated_at = ?
        WHERE order_id = ?
      `).run(snapResult.snap_token || null, snapResult.merchant_id || (payment_method === 'cash' ? 'cash' : payment_method), new Date().toISOString(), orderId);
    }

    res.status(201).json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      grand_total: grandTotal,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      cash_tendered: parsedCashTendered,
      expected_change: (payment_method === 'cash' && parsedCashTendered !== null) ? Math.max(0, parsedCashTendered - grandTotal) : null,
      payment: {
        method: payment_method,
        cash_tendered: parsedCashTendered,
        expected_change: (payment_method === 'cash' && parsedCashTendered !== null) ? Math.max(0, parsedCashTendered - grandTotal) : null,
        snap_token: snapResult.snap_token,
        redirect_url: snapResult.redirect_url
      },
      snap_token: snapResult.snap_token,
      redirect_url: snapResult.redirect_url,
      redirect: '/order-received/' + orderId
    });
  } catch (err) {
    console.error('[API] checkout error:', err);
    res.status(500).json({ success: false, error: err.message, message: err.message });
  }
});

// In-Memory Token & Session Store with TTL + Revocation Support
const TokenSessionStore = {
  sessions: new Map(),
  revokedTokens: new Set(),
  revokedUserIds: new Set(),
  createSession(user, brand_id, ttlSeconds = 86400) {
    const token = 'xnt_auth_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(token, {
      id: user.id,
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      full_name: user.full_name,
      role: user.role,
      brandId: brand_id,
      brand_id: brand_id,
      organizationId: user.organization_id || null,
      organization_id: user.organization_id || null,
      branchId: user.branch_id || null,
      branch_id: user.branch_id || null,
      status: user.status || 'active',
      email_verified: user.email_verified !== undefined ? Boolean(user.email_verified) : true,
      expiresAt
    });
    return { token, expiresAt };
  },
  createCustomerSession(phone, brand_id, ttlSeconds = 2592000, extra = {}) {
    const token = 'xnt_cust_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    const customerId = (extra && (extra.customerId || extra.customer_id)) || null;
    let organizationId = (extra && (extra.organizationId || extra.organization_id)) || null;

    // Resolve authoritative brand organization if available
    let brandOrgId = null;
    if (brand_id) {
      try {
        const b = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(brand_id);
        if (b) brandOrgId = b.organization_id;
      } catch (_) {}
    }

    if (!organizationId) {
      organizationId = brandOrgId;
    }

    // Invariant: If customerId is provided, verify customer exists and belongs to the same organization
    if (customerId) {
      try {
        const cust = db.prepare('SELECT organization_id FROM customers WHERE id = ?').get(customerId);
        if (cust) {
          if (cust.organization_id && organizationId && String(cust.organization_id) !== String(organizationId)) {
            const err = new Error('Customer organization does not match session organization.');
            err.status = 403;
            err.code = 'CUSTOMER_ORGANIZATION_MISMATCH';
            throw err;
          }
          if (cust.organization_id && !organizationId) {
            organizationId = cust.organization_id;
          }
        }
      } catch (custErr) {
        if (custErr.code === 'CUSTOMER_ORGANIZATION_MISMATCH') throw custErr;
      }
    }

    // Invariant: Brand organization must match session organization
    if (brandOrgId && organizationId && String(brandOrgId) !== String(organizationId)) {
      const err = new Error('Brand organization does not match session organization.');
      err.status = 403;
      err.code = 'BRAND_ORGANIZATION_MISMATCH';
      throw err;
    }

    const sessionData = {
      type: 'customer',
      role: 'customer',
      customerId: customerId,
      customer_id: customerId,
      organizationId: organizationId,
      organization_id: organizationId,
      phone: phone ? phone.trim() : '',
      customerPhone: phone ? phone.trim() : '',
      brandId: brand_id,
      brand_id: brand_id,
      expiresAt
    };

    // Optional extra fields for Google-authenticated customers
    if (extra && typeof extra === 'object') {
      if (extra.name)       sessionData.name = String(extra.name);
      if (extra.email)      sessionData.email = String(extra.email);
      if (extra.google_sub) sessionData.google_sub = String(extra.google_sub);
    }

    this.sessions.set(token, sessionData);

    try {
      db.prepare(`
        INSERT OR REPLACE INTO customer_sessions (token, customer_id, organization_id, phone, brand_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(token, customerId, organizationId, phone ? phone.trim() : '', brand_id, expiresAt);
    } catch (dbErr) {
      console.error('[TokenSessionStore] Failed to persist customer session to SQLite:', dbErr.message);
    }

    return { token, expiresAt };
  },
  getSession(token) {
    if (!token) return null;
    if (this.revokedTokens.has(token)) return null;

    // L1: In-memory cache
    const cachedSession = this.sessions.get(token);
    if (cachedSession) {
      if (Date.now() > cachedSession.expiresAt) {
        this.sessions.delete(token);
        // Clean up expired in SQLite if it was customer token
        if (token.startsWith('xnt_cust_')) {
          try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
        }
        return null;
      }
      return cachedSession;
    }

    // L2: SQLite backing for customer sessions
    if (token.startsWith('xnt_cust_')) {
      try {
        const row = db.prepare('SELECT token, customer_id, organization_id, phone, brand_id, expires_at FROM customer_sessions WHERE token = ?').get(token);
        if (!row) return null;

        if (Date.now() > Number(row.expires_at)) {
          try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
          return null;
        }

        const hydrated = {
          type: 'customer',
          role: 'customer',
          customerId: row.customer_id || null,
          customer_id: row.customer_id || null,
          organizationId: row.organization_id || null,
          organization_id: row.organization_id || null,
          phone: row.phone,
          customerPhone: row.phone,
          brandId: row.brand_id,
          brand_id: row.brand_id,
          expiresAt: Number(row.expires_at)
        };
        // Hydrate L1 memory cache
        this.sessions.set(token, hydrated);
        return hydrated;
      } catch (dbErr) {
        console.error('[TokenSessionStore] SQLite session lookup failed:', dbErr.message);
        return null;
      }
    }

    return null;
  },
  destroySession(token) {
    if (token) {
      this.sessions.delete(token);
      this.revokedTokens.add(token);
      if (token.startsWith('xnt_cust_')) {
        try { db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token); } catch (_) {}
      }
    }
  },
  revokeUserSessions(userId) {
    this.revokedUserIds.add(userId);
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId || session.id === userId) {
        this.sessions.delete(token);
      }
    }
  },
  destroyAllUserSessions(userId) {
    this.revokeUserSessions(userId);
  }
};

// Expose globally for WorkforceService
global.TokenSessionStore = TokenSessionStore;

// Authoritative customer session organization authorization
function authorizeCustomerSession(session, req) {
  const reqOrgId = req.organization_id || (req.brand && req.brand.organization_id);
  if (!reqOrgId || !req.brand_id) {
    return {
      status: 403,
      error: 'TENANT_NOT_RESOLVED',
      message: 'Tenant tidak dapat diselesaikan secara otoritatif.'
    };
  }

  let sessionOrgId = session.organization_id || session.organizationId;
  const customerId = session.customerId || session.customer_id;

  // Verify against authoritative database records
  if (customerId) {
    try {
      const cust = db.prepare('SELECT id, organization_id FROM customers WHERE id = ?').get(customerId);
      if (!cust) {
        return {
          status: 401,
          error: 'CUSTOMER_NOT_FOUND',
          message: 'Data customer tidak ditemukan.'
        };
      }
      if (!sessionOrgId) {
        sessionOrgId = cust.organization_id;
        session.organization_id = cust.organization_id;
        session.organizationId = cust.organization_id;
      } else if (String(cust.organization_id) !== String(sessionOrgId)) {
        return {
          status: 403,
          error: 'TENANT_MISMATCH',
          message: 'Sesi customer tidak valid untuk organisasi ini.'
        };
      }
    } catch (dbErr) {
      console.error('[authorizeCustomerSession] Customer DB verification error:', dbErr.message);
      return {
        status: 500,
        error: 'DATABASE_ERROR',
        message: 'Gagal memverifikasi identitas customer.'
      };
    }
  } else if (!sessionOrgId && session.brandId) {
    // Legacy session fallback: resolve organization from session brand
    try {
      const b = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(session.brandId);
      if (b && b.organization_id) {
        sessionOrgId = b.organization_id;
        session.organization_id = b.organization_id;
        session.organizationId = b.organization_id;
      }
    } catch (_) {}
  }

  // Authoritative check: Customer Organization must match Request Organization
  if (!sessionOrgId || String(sessionOrgId) !== String(reqOrgId)) {
    return {
      status: 403,
      error: 'TENANT_MISMATCH',
      message: 'Sesi customer tidak valid untuk organisasi ini.'
    };
  }

  return { ok: true, sessionOrgId };
}

// Middleware: Require Authenticated Customer Session (Finding 1)
function requireCustomerAuth() {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Akses ditolak: Sesi customer tidak ditemukan. Harap masuk terlebih dahulu untuk mengakses layanan ini.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session || (session.type !== 'customer' && session.role !== 'customer')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
        message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa. Silakan masuk kembali untuk melanjutkan.'
      });
    }

    const authCheck = authorizeCustomerSession(session, req);
    if (!authCheck.ok) {
      return res.status(authCheck.status).json({
        success: false,
        error: authCheck.error,
        message: authCheck.message
      });
    }

    req.customer = session;
    next();
  };
}

// Core Identity & RBAC Integration
const { IdentityModel, AuthorizationService } = require('../../core/identity');

// Middleware: Require Authenticated Token (Header-Only: Bearer token or x-auth-token)
function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Token otentikasi tidak ditemukan. Silakan login terlebih dahulu.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Sesi Anda telah kedaluwarsa atau token tidak valid. Silakan login kembali.'
      });
    }

    // Platform Owner is platform-scoped and cannot access tenant-scoped operations as a merchant user
    if (session.role === 'platform_owner') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'Platform Owner adalah akun platform-scoped dan tidak dapat mengakses operasi tenant secara langsung tanpa support context.'
      });
    }

    // P9-17 AUTHORITATIVE ACCOUNT STATUS ENFORCEMENT
    // A workforce account disabled/suspended AFTER login must not keep operating
    // with a pre-disable session. Status is read from the DB (authoritative),
    // never from client input or the cached session snapshot.
    if (session.userId) {
      const account = db.prepare('SELECT status FROM users WHERE id = ?').get(session.userId);
      if (account && account.status && account.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'ACCOUNT_DISABLED',
          message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.'
        });
      }
    }

    // P1 TENANT & ORGANIZATION BOUNDARY ENFORCEMENT via Core Identity
    let isTenantAuthorized = session.brandId === req.brand_id;
    const isInvitationAcceptRoute = req.path === '/invitations/accept' || (req.originalUrl && req.originalUrl.includes('/invitations/accept'));
    if (isInvitationAcceptRoute) {
      // Recipient is accepting an invitation to join a brand/workforce; tenant authorization is governed by invitation acceptance
      isTenantAuthorized = true;
    } else if (!isTenantAuthorized) {
      const isIdentityRoute = req.path === '/auth/merchant/me' || (req.originalUrl && req.originalUrl.includes('/auth/merchant/me')) ||
          req.path === '/auth/handoff/create' || (req.originalUrl && req.originalUrl.includes('/auth/handoff/create'));
      const isOnboardingRoute = session.role === 'owner' && (req.path.includes('/onboarding/') || (req.originalUrl && req.originalUrl.includes('/onboarding/')));
      if (isIdentityRoute || isOnboardingRoute) {
        // Safe profile, handoff generation, and owner business onboarding/setup choice
        isTenantAuthorized = true;
      } else if (session.role === 'owner' && session.organizationId && req.brand && req.brand.organization_id) {
        isTenantAuthorized = session.organizationId === req.brand.organization_id;
      }
    }

    if (!isTenantAuthorized) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'Anda tidak memiliki akses ke tenant brand ini.'
      });
    }

    // Role check if specified
    if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Role Anda tidak memiliki izin untuk mengakses resource ini.'
      });
    }

    // EMAIL VERIFICATION ACCESS POLICY ENFORCEMENT
    // Exclude safe identity/verification-UX routes so unverified users can inspect their status, log out, resend, or accept workforce invitations
    const verificationExemptRoutes = ['/auth/merchant/me', '/auth/logout', '/auth/resend-verification', '/invitations/accept'];
    const isExemptRoute = verificationExemptRoutes.includes(req.path) || isInvitationAcceptRoute;

    if (!isExemptRoute && session.role === 'owner') {
      // Check verification status from session or authoritatively from DB if session claims unverified
      let isVerified = Boolean(session.email_verified);
      if (!isVerified) {
        const userRow = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(session.userId || session.id);
        if (userRow && userRow.email_verified_at) {
          isVerified = true;
          session.email_verified = true; // Heal session in place immediately
        }
      }

      if (!isVerified) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          error: 'EMAIL_NOT_VERIFIED',
          message: 'Silakan verifikasi alamat email Anda terlebih dahulu untuk mengakses fitur operasional dashboard.'
        });
      }
    }

    // P1 BRANCH SCOPE BOUNDARY ENFORCEMENT (FINDING-01 & NEW-05)
    // Branch-level roles (branch_manager, cashier, kitchen) MUST be assigned to a branch and cannot access outside it
    const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
    if (branchScopedRoles.includes(session.role) && !isInvitationAcceptRoute) {
      if (!session.branchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_UNASSIGNED_BRANCH',
          message: 'Akses ditolak: Akun operator Anda belum ditugaskan ke cabang tertentu.'
        });
      }
      const requestedBranchId = req.query.branch_id || req.body?.branch_id || req.params?.branch_id;
      if (requestedBranchId && requestedBranchId !== session.branchId) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_ACCESS',
          message: 'Akses ditolak: Anda hanya memiliki izin untuk mengakses cabang yang ditugaskan.'
        });
      }
    }

    req.session = session;
    req.user = session;
    next();
  };
}

// Middleware: Require Authenticated Platform Owner (Header-Only: Bearer token or x-auth-token)
function requirePlatformAuth() {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Token otentikasi platform tidak ditemukan. Silakan login ke Control Plane.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_TOKEN',
        message: 'Sesi platform Anda telah kedaluwarsa atau tidak valid. Silakan login kembali.'
      });
    }

    // STRICT PLATFORM SCOPE ENFORCEMENT: Merchant Owner or other merchant roles CANNOT access
    if (session.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_PLATFORM_ACCESS',
        message: 'Akses ditolak: Operasi ini membutuhkan kewenangan Platform Owner.'
      });
    }

    req.session = session;
    req.platformUser = session;
    next();
  };
}

registerCustomerRoutes(router, {
  db,
  RateLimiter,
  TokenSessionStore,
  requireCustomerAuth,
  CustomerIdentityService: require('../../core/identity').CustomerIdentityService,
  CustomerRepository: require('../../core/data/repositories').CustomerRepository,
  DiningTableService: require('../../domains/pos').DiningTableService
});

registerCustomerAddressRoutes(router, { db, crypto, requireCustomerAuth });

// 6.0 Platform Owner Authentication Endpoint
registerPlatformRoutes(router, {
  db,
  RateLimiter,
  TokenSessionStore,
  requirePlatformAuth,
  PlatformBootstrapService: require('../../core/identity').PlatformBootstrapService
});

// 7.1 Customer Order History (Protected by Customer Auth)
registerCustomerOrderRoutes(router, {
  db,
  TokenSessionStore,
  AcceptanceTimeoutService,
  OrderStateMachine,
  requireCustomerAuth,
  DiningTableService: require('../../domains/pos').DiningTableService
});

// Operational order lifecycle routes are isolated in server/routes/operational-orders.js.
registerOperationalOrderRoutes(router, {
  db,
  requireAuth,
  OrderStateMachine,
  AcceptanceTimeoutService
});

// 9.0.1 R7 CUSTOMER CANCELLATION — a customer may cancel ONLY an order still
// awaiting branch acceptance (orders.status = 'pending'). ACCEPTED
// ('confirmed') and later orders may NOT be customer-cancelled here (branch
// exception / refund are later tasks), and REJECTED / TIMEOUT / CANCELLED
// orders are terminal. Server-side enforcement: UI restrictions alone are
// insufficient. Actor semantics are never client-classified: the audit log
// records actor_type 'customer' + the AUTHENTICATED phone (from the OTP
// session — never from the request body) with a [CUSTOMER_CANCEL] note, so
// CUSTOMER_CANCEL stays distinct from BRANCH_REJECT, BRANCH_TIMEOUT,
// SYSTEM_CANCEL, and PAYMENT_FAILURE.
// 9.1 Staff / POS Cash Settlement Endpoint (Authorized Cashiers, Branch Managers, & Brand Owners)
registerPosRoutes(router, {
  db,
  requireAuth
});

// Payment-provider webhooks are isolated in server/routes/webhooks.js.
registerPaymentWebhooks(router, { PaymentService });
};
