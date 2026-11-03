/**
 * XENTRA CORE — CUSTOMER ACCOUNT & DINE-IN ROUTES
 *
 * Customer profile, phone completion, open dining-session access, QR table
 * claiming and account deletion. Order history/detail/cancellation live in
 * customer-orders.js.
 */
module.exports = function registerCustomerRoutes(router, deps) {
  const {
    db,
    RateLimiter,
    TokenSessionStore,
    requireCustomerAuth,
    CustomerIdentityService,
    CustomerRepository,
    DiningTableService
  } = deps;

// 5.2 Customer Profile — canonical Customer identity (phone lives here, not in checkout).
// GET returns authoritative profile; PATCH /phone validates + normalizes + saves.
router.get('/customer/profile', requireCustomerAuth(), (req, res) => {
  try {
    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'Customer identity tidak ditemukan.' });
    }
    const customerRepo = new CustomerRepository();
    const record = customerRepo.findById(customerId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan.' });
    }
    return res.json({
      success: true,
      customer: {
        id: record.id,
        name: record.display_name || null,
        email: record.email || null,
        phone: record.phone || null
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Gagal memuat profil customer.' });
  }
});

router.patch('/customer/profile/phone', requireCustomerAuth(), (req, res) => {
  try {
    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'Customer identity tidak ditemukan.' });
    }
    const rawPhone = String((req.body && req.body.phone) || '').trim();
    const clean = rawPhone.replace(/[^0-9]/g, '');
    // Canonical Indonesian WhatsApp/mobile validation (same rule as recipient + OTP).
    const isIndoMobile = clean.startsWith('08') || clean.startsWith('628') || clean.startsWith('8');
    if (!rawPhone || !isIndoMobile || clean.length < 9 || clean.length > 15) {
      return res.status(400).json({ success: false, error: 'Nomor WhatsApp/telepon tidak valid. Gunakan format 08xx atau 628xx (9-15 digit).' });
    }
    const CustomerRepository = require('../../core/data/repositories/CustomerRepository');
    const customerRepo = new CustomerRepository();
    const record = customerRepo.findById(customerId);
    if (!record) {
      return res.status(404).json({ success: false, error: 'Customer tidak ditemukan.' });
    }
    customerRepo.updateCustomerProfile(customerId, { phone: clean });
    // Refresh the live session so SELF recipient resolves immediately without re-login.
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7).trim()
        : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
      const live = token && TokenSessionStore.getSession(token);
      if (live) {
        live.phone = clean;
        live.customerPhone = clean;
      }
      const rawDb = require('../database/db');
      if (token) {
        try { rawDb.prepare('UPDATE customer_sessions SET phone = ? WHERE token = ?').run(clean, token); } catch (_) {}
      }
    } catch (_) {}
    return res.json({ success: true, customer: { id: customerId, phone: clean } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Gagal menyimpan nomor WhatsApp.' });
  }
});

// 5.3 Addresses (Protected by Customer Session - Brand scoped data)
// ── Customer: current member's open dine-in session ─────────────────────────
// Membership, not the session's primary contact phone, authorizes shared-table access.
function buildMySubmissions(sessionId, customerId) {
  const ownOrders = db.prepare(`
    SELECT id, order_number, customer_id, status, created_at, grand_total
    FROM orders
    WHERE dining_session_id = ?
    ORDER BY created_at
  `).all(sessionId).filter((order) =>
    customerId && String(order.customer_id || '') === String(customerId)
  );
  const submissions = [];

  for (const order of ownOrders) {
    const items = db.prepare(`
      SELECT product_name, quantity, item_subtotal, subtotal, note
      FROM order_items
      WHERE order_id = ? AND addition_batch_id IS NULL
      ORDER BY created_at, id
    `).all(order.id).map((item) => ({
      name: item.product_name || 'Item',
      quantity: Number(item.quantity) || 0,
      subtotal: Number(item.item_subtotal ?? item.subtotal) || 0,
      note: item.note || ''
    }));
    if (items.length) {
      submissions.push({
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        created_at: order.created_at,
        total: items.reduce((sum, item) => sum + item.subtotal, 0),
        items
      });
    }
  }

  const batches = db.prepare(`
    SELECT b.id, b.order_id, b.sequence_no, b.created_by, b.items_payload, b.subtotal,
           b.status, b.rejection_reason, b.created_at, o.order_number
    FROM order_addition_batches b
    JOIN orders o ON o.id = b.order_id
    WHERE b.dining_session_id = ?
    ORDER BY b.sequence_no, b.created_at
  `).all(sessionId).filter((batch) =>
    customerId && String(batch.created_by || '') === String(customerId)
  );

  for (const batch of batches) {
    let rawItems = [];
    try { rawItems = JSON.parse(batch.items_payload || '[]'); } catch (_) {}
    const items = rawItems.map((item) => ({
      name: item.name || item.product_name || 'Item',
      quantity: Number(item.quantity) || 0,
      subtotal: Number(item.subtotal ?? item.item_subtotal) || 0,
      note: item.note || item.notes || ''
    }));
    submissions.push({
      id: batch.id,
      order_number: batch.order_number,
      status: batch.status,
      rejection_reason: batch.rejection_reason || '',
      created_at: batch.created_at,
      total: Number(batch.subtotal) || items.reduce((sum, item) => sum + item.subtotal, 0),
      items
    });
  }

  return submissions.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

function buildOpenBill(sessionId, brandId, customerId = null) {
  const session = db.prepare(`
    SELECT ds.id, ds.branch_id, ds.opened_at, ds.customer_name
    FROM dining_sessions ds
    JOIN branches b ON b.id = ds.branch_id
    WHERE ds.id = ? AND ds.status = 'active' AND b.brand_id = ?
  `).get(sessionId, brandId);
  if (!session) return null;

  const tables = db.prepare(`
    SELECT t.id, t.table_number, t.label
    FROM dining_session_tables dst
    JOIN branch_tables t ON t.id = dst.table_id
    WHERE dst.session_id = ?
    ORDER BY t.table_number
  `).all(session.id);

  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.order_type, o.status, o.payment_status, o.grand_total, o.created_at,
      COALESCE(p.payment_status, 'pending') AS gateway_payment_status,
      COALESCE(p.amount, 0) AS gateway_paid_amount
    FROM orders o
    LEFT JOIN order_payments p ON p.order_id = o.id
    WHERE o.dining_session_id = ?
    ORDER BY o.created_at
  `).all(session.id);

  let totalBill = 0;
  let outstanding = 0;
  const nonBillableStatuses = new Set(['cancelled', 'rejected', 'timeout', 'expired', 'fulfillment_exception']);
  const billOrders = orders.map((o) => {
    const amount = Number(o.grand_total) || 0;
    const isExcluded = nonBillableStatuses.has(o.status);
    const checkPayments = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS paid_amount
      FROM pos_check_payments
      WHERE order_id = ? AND payment_status = 'settlement'
    `).get(o.id);
    const ledgerPaid = Number(checkPayments && checkPayments.paid_amount) || 0;
    const gatewayPaid = o.gateway_payment_status === 'settlement' || o.gateway_payment_status === 'paid'
      ? Number(o.gateway_paid_amount) || 0
      : 0;
    const paidAmount = Math.min(amount, ledgerPaid > 0 ? ledgerPaid : gatewayPaid);
    const remaining = Math.max(0, amount - paidAmount);
    const isSettled = isExcluded || remaining <= 0;
    if (!isExcluded) {
      totalBill += amount;
      outstanding += remaining;
    }
    return {
      id: o.id,
      order_number: o.order_number,
      order_type: o.order_type,
      status: o.status,
      payment_status: o.payment_status,
      grand_total: amount,
      paid_amount: paidAmount,
      outstanding_amount: isExcluded ? 0 : remaining,
      is_settled: isSettled,
      created_at: o.created_at
    };
  });

  const activeOrders = billOrders.filter((o) => !nonBillableStatuses.has(o.status));
  return {
    session_id: session.id,
    branch_id: session.branch_id,
    opened_at: session.opened_at,
    tables: tables.map((t) => ({ id: t.id, table_number: t.table_number, label: t.label })),
    orders: billOrders,
    active_order_id: activeOrders.length ? activeOrders[activeOrders.length - 1].id : null,
    total_bill: totalBill,
    outstanding_total: outstanding,
    my_submissions: buildMySubmissions(session.id, customerId)
  };
}

router.get('/customer/dining-session', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) return res.json({ success: true, session: null });

    const row = db.prepare(`
      SELECT ds.id
      FROM dining_sessions ds
      JOIN branches b ON b.id = ds.branch_id
      WHERE ds.status = 'active' AND b.brand_id = ?
        AND EXISTS (
          SELECT 1 FROM dining_session_members m
          WHERE m.session_id = ds.id AND m.customer_id = ?
        )
      ORDER BY ds.opened_at DESC
      LIMIT 1
    `).get(req.brand_id, customerId);

    return res.json({ success: true, session: row ? buildOpenBill(row.id, req.brand_id, customerId) : null });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/customer/dining-session/additions', requireCustomerAuth(), async (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    const { order_id, items = [] } = req.body || {};
    if (!customerPhone) return res.status(400).json({ success: false, error: 'Identitas customer belum memiliki nomor WhatsApp.' });
    if (!order_id) return res.status(400).json({ success: false, error: 'order_id wajib diisi.' });

    const owner = db.prepare(`
      SELECT o.id, o.branch_id, o.dining_session_id
      FROM orders o
      JOIN dining_sessions ds ON ds.id = o.dining_session_id
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ?
        AND o.order_type = 'dine_in'
        AND ds.status = 'active'
        AND EXISTS (SELECT 1 FROM dining_session_members m WHERE m.session_id = ds.id AND m.customer_id = ?)
        AND b.brand_id = ?
      LIMIT 1
    `).get(order_id, customerId || '', req.brand_id);

    if (!owner) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_DINING_SESSION',
        message: 'Order tidak berada pada Dining Session aktif milik Anda.'
      });
    }

    const { OrderAdditionService } = require('../../domains/commerce');
    const result = await OrderAdditionService.submit({
      order_id: owner.id,
      brand_id: req.brand_id,
      branch_id: owner.branch_id,
      items,
      source_channel: 'customer_app',
      created_by: customerId || customerPhone,
      customer: { id: customerId || null, name: req.customer.name || '', phone: customerPhone }
    });

    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

  function optionalCustomerAuth() {
    return (req, res, next) => {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
      if (token && TokenSessionStore) {
        const session = TokenSessionStore.getSession(token);
        if (session && (session.type === 'customer' || session.role === 'customer')) {
          req.customer = session;
        }
      }
      next();
    };
  }

router.post('/customer/dining-session/claim', optionalCustomerAuth(), (req, res) => {
  try {
    const { qr_token } = req.body || {};
    if (!qr_token) {
      return res.status(400).json({ success: false, error: 'qr_token wajib diisi.' });
    }

    const raw = String(qr_token).trim();
    const resolvedTable = DiningTableService.resolveFromQr(raw);
    if (!resolvedTable) {
      return res.status(404).json({ success: false, error: 'QR Meja tidak valid atau telah dicabut.' });
    }
    const resolvedTableId = resolvedTable.id || resolvedTable.table_id;
    const tableRow = db.prepare('SELECT id, table_number, label, branch_id FROM branch_tables WHERE id = ?').get(resolvedTableId);
    if (!tableRow) return res.status(404).json({ success: false, error: 'MEJA_TIDAK_DITEMUKAN' });

    // Meja harus benar-benar milik brand ini.
    const brandOfBranch = db.prepare('SELECT brand_id FROM branches WHERE id = ?').get(tableRow.branch_id);
    if (!brandOfBranch || brandOfBranch.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'MEJA_TIDAK_DITEMUKAN' });
    }

    const tableId = tableRow.id;

    // A scan only joins a session opened by staff. It never converts a payment
    // hold or claims an available table. Unauthenticated scans remain locators;
    // signup/login returns to this route and performs the actual membership join.
    let joinedSession = null;
    const customerId = req.customer && (req.customer.customerId || req.customer.customer_id);
    const tableOpen = DiningTableService.hasOpenTableSession(tableId);
    if (req.customer && !customerId) {
      return res.status(403).json({ success: false, error: 'CUSTOMER_ID_REQUIRED', message: 'Akun customer belum siap untuk bergabung ke sesi meja.' });
    }
    if (customerId) {
      const joinResult = DiningTableService.joinActiveTableSession({
        branch_id: tableRow.branch_id,
        table_id: tableId,
        customer_id: customerId,
        customer_phone: req.customer.phone || ''
      });
      if (joinResult.joined) joinedSession = buildOpenBill(joinResult.session_id, req.brand_id, customerId);
    }

    // Mejanya selalu dikembalikan, walau belum ada billnya: konsumen yang scan QR
    // tidak boleh diminta memilih meja lagi — mejanya sudah ada di QR itu.
    const tableInfo = {
      id: tableId,
      table_number: tableRow.table_number || null,
      label: tableRow.label || null
    };

    return res.json({
      success: true,
      session: joinedSession,
      joined: Boolean(joinedSession),
      table_open: tableOpen,
      via: 'qr',
      table_id: tableId,
      table: tableInfo,
      message: joinedSession
        ? undefined
        : (tableOpen
          ? 'Meja sudah dibuka kasir. Masuk atau daftar akun untuk bergabung dan memesan.'
          : 'Meja belum dibuka kasir. Minta petugas membuka sesi meja terlebih dahulu.')
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Hapus akun dari sudut pandang tamu. Wajib konfirmasi eksplisit supaya tidak
// terpanggil karena salah request, dan dibatasi rate supaya tidak jadi alat serangan.
router.delete('/customer/account', requireCustomerAuth(), (req, res) => {
  try {
    // Konfirmasi dibaca dari QUERY atau header — dan tetap menerima body sebagai
    // jalan ketiga. Alasannya bukan selera: permintaan DELETE yang membawa body
    // ditolak lebih dulu oleh rantai middleware (400 tanpa badan), jadi body tidak
    // bisa diandalkan untuk operasi ini.
    const confirmToken = (req.query && req.query.confirm)
      || req.headers['x-confirm-delete']
      || (req.body && req.body.confirm);
    if (String(confirmToken || '').trim().toUpperCase() !== 'HAPUS') {
      return res.status(400).json({
        success: false,
        error: 'KONFIRMASI_DIPERLUKAN',
        message: 'Kirim confirm: "HAPUS" untuk benar-benar menghapus akun.'
      });
    }

    const customerId = req.customer.customerId || req.customer.customer_id;
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'Customer identity tidak ditemukan.' });
    }

    const limiterKey = 'customer-account-delete:' + req.brand_id + ':' + customerId;
    const rate = RateLimiter.check(limiterKey, 6, 3600);
    if (!rate.allowed) {
      return res.status(429).json({ success: false, error: 'TOO_MANY_REQUESTS', message: 'Terlalu sering. Coba lagi nanti.' });
    }

    const deletingCustomer = db.prepare('SELECT phone FROM customers WHERE id = ?').get(customerId) || {};
    const deletedPhone = deletingCustomer.phone || null;

    const result = new CustomerIdentityService().deleteCustomerAccount({ customerId, brandId: req.brand_id });

    // Sesi di STORE harus dicabut juga, bukan cuma barisnya di database: validasi
    // sesi customer membaca store yang ada di memori (lihat getSession di berkas ini),
    // jadi tanpa ini tamu yang sedang login tetap bisa memakai sesinya sampai
    // kedaluwarsa. Hapus semua sesi customer milik orang ini — bukan cuma yang
    // sedang dipakai, supaya keluar dari semua perangkat.
    try {
      const store = global.TokenSessionStore;
      if (store && store.sessions && typeof store.sessions.forEach === 'function') {
        const toRemove = [];
        store.sessions.forEach(function (sess, token) {
          if (!sess) return;
          const isCustomer = (sess.type === 'customer' || sess.role === 'customer');
          if (!isCustomer) return;
          const sameId = String(sess.customerId || sess.customer_id || '') === String(customerId);
          const samePhone = deletedPhone && String(sess.phone || '') === String(deletedPhone);
          if (sameId || samePhone) toRemove.push(token);
        });
        toRemove.forEach(function (t) { try { store.sessions.delete(t); } catch (_) {} });
      }
    } catch (err) {
      console.warn('[Customer Account Delete] Gagal mencabut sesi di store:', err.message);
    }

    return res.json({
      success: true,
      deleted: true,
      orders_kept: true,
      message: 'Akun Anda sudah dihapus. Riwayat pesanan tetap tersimpan di resto tanpa terhubung ke Anda.'
    });
  } catch (err) {
    const status = err.status || 400;
    return res.status(status).json({ success: false, error: err.message });
  }
});


};
