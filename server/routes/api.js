const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const BranchMatcher = require('../services/BranchMatcher');
const DeliveryCalculator = require('../services/DeliveryCalculator');
const PaymentService = require('../services/PaymentService');
const OrderStateMachine = require('../services/OrderStateMachine');
const RouteService = require('../services/RouteService');
const { PromotionEngineService } = require('../../domains/promotion');
const { InventoryStockService, InventoryMovementModel } = require('../../domains/inventory');
const CatalogService = require('../../domains/commerce/services/CatalogService');

// 0. Active Promotions & Evaluation Endpoint
router.get(['/promo/active', '/promotions/active'], (req, res) => {
  try {
    const brandId = req.brand.id;
    const isPwa = req.query.is_pwa === '1' || req.query.is_pwa === 'true';
    const phone = req.query.phone || '';

    const evaluation = PromotionEngineService.evaluate({
      brand_id: brandId,
      is_pwa_installed: isPwa,
      customer_phone: phone
    });

    res.json({
      success: true,
      promotions: evaluation.discovery,
      applied: evaluation.applied,
      rejected: evaluation.rejected
    });
  } catch (err) {
    console.error('[API Error /promo/active]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Get Brand Profile & Theme
router.get('/brand/info', (req, res) => {
  try {
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch (e) {}
    if (!Array.isArray(banners) || banners.length === 0) {
      banners = [
        {
          id: 'banner_1',
          image_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80',
          title: 'Slalu ada sensasi di setiap gigitan',
          link: '#'
        },
        {
          id: 'banner_2',
          image_url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=80',
          title: 'Paket Spesial Diskon 20%',
          link: '#'
        },
        {
          id: 'banner_3',
          image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80',
          title: 'Ayam Tulang Lunak Khas Bangjo',
          link: '#'
        }
      ];
    }

    res.json({
      success: true,
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url,
        primary_color: req.brand.primary_color || '#b6ff00',
        banners
      }
    });
  } catch (err) {
    console.error('[API Error /brand/info]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. List Branches for Brand
router.get('/brand/branches', (req, res) => {
  try {
    const branches = db
      .prepare(`
        SELECT 
          b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone,
          b.is_active, b.is_open_override,
          s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km,
          s.promo_delivery_discount, s.promo_min_order
        FROM branches b
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
        WHERE b.brand_id = ? AND b.is_active = 1
      `)
      .all(req.brand_id);

    res.json({
      success: true,
      branches
    });
  } catch (err) {
    console.error('[API Error /brand/branches]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Match Nearest Eligible Branch
router.post('/delivery/match-branch', async (req, res) => {
  try {
    const { latitude, longitude, subtotal = 0, items } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'Parameter latitude dan longitude wajib dikirim.'
      });
    }

    // C4.2: when a cart is provided the match is a FULL-CART match — the
    // matcher (via canonical EligibilityService) only ever selects a branch
    // able to satisfy the COMPLETE cart, and fails closed otherwise. Items were
    // previously dropped silently on this route; an explicitly provided
    // non-array is rejected instead of being ignored.
    if (items !== undefined && !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'Parameter items harus berupa array.'
      });
    }

    const match = await BranchMatcher.matchNearestBranch({
      brand_id: req.brand_id,
      customer_lat: Number(latitude),
      customer_lng: Number(longitude),
      subtotal: Number(subtotal),
      items: Array.isArray(items) ? items : undefined
    });

    res.json({
      success: true,
      ...match
    });
  } catch (err) {
    console.error('[API] match-branch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Address Search Suggestion (Nominatim)
router.get('/location/search', async (req, res) => {
  const q = req.query.q || '';
  const results = await RouteService.searchAddress(q);
  res.json({ success: true, results });
});

// 4.1 Reverse Geocode (Coordinates -> Address Text)
router.get(['/delivery/reverse-geocode', '/address/reverse'], async (req, res) => {
  try {
    const lat = req.query.lat || req.query.latitude;
    const lng = req.query.lng || req.query.longitude;
    const result = await RouteService.reverseGeocode(lat, lng);
    res.json({
      success: true,
      address: {
        formatted_address: result.address,
        display_name: result.display_name,
        latitude: Number(lat),
        longitude: Number(lng)
      },
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.2 Real Auth OTP Challenge & Verification Store (In-Memory with TTL & Max Attempts)
const OtpChallengeStore = {
  challenges: new Map(),
  rateLimits: new Map(), // key: brandId:phone -> lastSentTimestamp
  
  checkRateLimit(phone, brandId, minIntervalSeconds = 60) {
    const key = `${brandId}:${phone}`;
    const lastSent = this.rateLimits.get(key);
    if (lastSent) {
      const elapsedSeconds = Math.floor((Date.now() - lastSent) / 1000);
      if (elapsedSeconds < minIntervalSeconds) {
        return {
          allowed: false,
          retryAfter: minIntervalSeconds - elapsedSeconds
        };
      }
    }
    return { allowed: true, retryAfter: 0 };
  },

  createChallenge(phone, brandId, otpCode, ttlSeconds = 300) {
    const challengeId = 'chk_' + crypto.randomBytes(16).toString('hex');
    const otpHash = crypto.createHash('sha256').update(String(otpCode).trim()).digest('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;

    // Record rate limit timestamp
    this.rateLimits.set(`${brandId}:${phone}`, Date.now());

    this.challenges.set(challengeId, {
      phone,
      otpHash,
      expiresAt,
      attempts: 0,
      verified: false,
      brandId
    });
    return { challengeId, expiresAt };
  },
  verifyOtp(challengeId, otpCode, phone, brandId) {
    if (!challengeId || !this.challenges.has(challengeId)) {
      return { success: false, error: 'CHALLENGE_NOT_FOUND', message: 'Challenge OTP tidak ditemukan atau telah kedaluwarsa.' };
    }
    const record = this.challenges.get(challengeId);
    if (Date.now() > record.expiresAt) {
      this.challenges.delete(challengeId);
      return { success: false, error: 'OTP_EXPIRED', message: 'Kode OTP telah kedaluwarsa. Silakan minta kode baru.' };
    }
    if (record.brandId !== brandId) {
      return { success: false, error: 'TENANT_MISMATCH', message: 'Challenge OTP tidak valid untuk tenant ini.' };
    }
    if (phone && record.phone !== phone) {
      return { success: false, error: 'PHONE_MISMATCH', message: 'Nomor telepon tidak cocok dengan permintaan OTP.' };
    }
    if (record.attempts >= 3) {
      this.challenges.delete(challengeId);
      return { success: false, error: 'MAX_ATTEMPTS_EXCEEDED', message: 'Batas percobaan OTP terlampaui. Silakan minta kode baru.' };
    }

    record.attempts += 1;
    const inputHash = crypto.createHash('sha256').update(String(otpCode).trim()).digest('hex');
    if (inputHash !== record.otpHash) {
      return { success: false, error: 'INVALID_OTP', message: 'Kode OTP yang Anda masukkan salah.' };
    }

    record.verified = true;
    return { success: true, verified: true, phone: record.phone };
  },
  isTrusted(challengeId, phone, brandId) {
    if (!challengeId || !this.challenges.has(challengeId)) return false;
    const record = this.challenges.get(challengeId);
    if (Date.now() > record.expiresAt) return false;
    return record.verified === true && record.phone === phone && record.brandId === brandId;
  }
};

router.post('/auth/otp/send', (req, res) => {
  const { phone } = req.body;
  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'Nomor WhatsApp / telepon wajib diisi.' });
  }

  const cleanPhone = phone.trim();

  // P1 HARDENING (FINDING 09): Enforce strict Rate Limiting (60s cooldown per phone & tenant)
  const rateLimitCheck = OtpChallengeStore.checkRateLimit(cleanPhone, req.brand_id, 60);
  if (!rateLimitCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: 'TOO_MANY_REQUESTS',
      retry_after: rateLimitCheck.retryAfter,
      message: `Harap tunggu ${rateLimitCheck.retryAfter} detik sebelum meminta kode OTP kembali.`
    });
  }

  // P1 HARDENING (FINDING 09): CSPRNG Cryptographically Secure Random Number Generator
  const otpCode = process.env.NODE_ENV === 'production' 
    ? crypto.randomInt(100000, 1000000).toString() 
    : '123456';

  const { challengeId } = OtpChallengeStore.createChallenge(cleanPhone, req.brand_id, otpCode);
  res.json({
    success: true,
    challenge_id: challengeId,
    retry_after: 60,
    message: 'Kode OTP telah dikirimkan ke nomor WhatsApp Anda.'
  });
});

router.post('/auth/otp/verify', (req, res) => {
  const { challenge_id, otp, code, phone } = req.body;
  const otpInput = otp || code;

  if (!challenge_id || !otpInput) {
    return res.status(400).json({ success: false, error: 'Challenge ID dan Kode OTP wajib diisi.' });
  }

  const result = OtpChallengeStore.verifyOtp(challenge_id, otpInput, phone ? phone.trim() : null, req.brand_id);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // P1 CUSTOMER AUTHENTICATION (Finding 1): Issue signed customer session token upon OTP verification
  const customerSession = TokenSessionStore.createCustomerSession(result.phone, req.brand_id);
  res.json({
    success: true,
    verified: true,
    phone: result.phone,
    token: customerSession.token,
    expires_at: customerSession.expiresAt
  });
});

router.post('/auth/otp/trust', (req, res) => {
  const { challenge_id, phone } = req.body;
  if (!challenge_id || !phone) {
    return res.status(400).json({ success: false, error: 'Challenge ID dan nomor telepon wajib disertakan.' });
  }

  const trusted = OtpChallengeStore.isTrusted(challenge_id, phone.trim(), req.brand_id);
  if (!trusted) {
    return res.status(403).json({ success: false, trusted: false, error: 'Perangkat atau sesi nomor belum diverifikasi OTP.' });
  }

  const customerSession = TokenSessionStore.createCustomerSession(phone.trim(), req.brand_id);
  res.json({
    success: true,
    trusted: true,
    token: customerSession.token,
    expires_at: customerSession.expiresAt
  });
});

// 5. Menu Catalog & Home
router.get(['/catalog/menu', '/home'], (req, res) => {
  try {
    const brandId = req.brand_id;
    const branchId = req.query.branch_id || '';

    // P3 BRANCH-SCOPED MENU: when a branch context is explicitly requested it must
    // belong to this brand AND be active; otherwise fail closed (400) instead of
    // silently serving a different scope (product pages never silently re-scope).
    let branchScope = null;
    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'branch not found' });
      }
      if (!branch.is_active) {
        return res.status(400).json({ success: false, error: 'branch is inactive' });
      }
      branchScope = branch;
    }

    // P3: always reuse the canonical commerce CatalogService — both branch-scoped
    // and brand-wide menus go through the same domain ownership path.
    // CatalogService returns branch price override, C1 operational availability,
    // and branch stock estimate when branch_id is provided.
    const menu = CatalogService.getMenu({ brand_id: brandId, branch_id: branchScope ? branchScope.id : null });

    const categories = menu.categories.map((c) => ({
      ...c,
      image: c.icon_url || ''
    }));
    const products = menu.products;

    const tree = categories.map((cat) => {
      const catProducts = products.filter((p) => String(p.category_id) === String(cat.id));

      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || String(cat.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: cat.image || cat.icon_url || '',
        products: catProducts.map((p) => ({
          ...p,
          image: p.image_url || '',
          image_url: p.image_url || '',
          regular_price: p.regular_price || p.price,
          sale_price: p.price
        }))
      };
    });

    const allNormalized = products.map((p) => ({
      ...p,
      image: p.image_url || '',
      image_url: p.image_url || '',
      regular_price: p.regular_price || p.price,
      sale_price: p.price
    }));

    res.json({
      success: true,
      categories: tree,
      all_products: allNormalized,
      products: {
        items: allNormalized
      },
      promo: {
        enabled: true,
        target: 50000,
        discount: 5000,
        label: 'Selamat, kamu berhasil dapetin diskon Rp 5.000 ketika checkout!'
      }
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Products List Endpoint (with Category Filtering)
router.get('/products', (req, res) => {
  try {
    const brandId = req.brand_id;
    const cat = req.query.category;
    let products = [];
    try {
      // P1 STRICT TENANT ISOLATION (NEW-01 & NEW-03):
      // Filter strictly by requested category within authoritative brand_id
      if (cat && cat !== 'all') {
        products = db.prepare(`
          SELECT DISTINCT p.* FROM products p
          WHERE p.brand_id = ?
            AND (p.category_id = ? OR ? = 'all')
            AND (p.is_active = 1 OR p.is_active IS NULL)
          ORDER BY p.sort_order ASC
        `).all(brandId, cat, cat);
      } else {
        products = db.prepare('SELECT * FROM products WHERE brand_id = ? AND (is_active = 1 OR is_active IS NULL) ORDER BY sort_order ASC').all(brandId);
      }
    } catch (err) {
      console.warn('[Products DB Error]:', err.message);
    }

    const normalized = (products || []).map((p) => ({
      ...p,
      image: p.image_url || p.image || '',
      image_url: p.image_url || p.image || '',
      regular_price: p.regular_price || p.price,
      sale_price: p.price
    }));

    res.json({
      success: true,
      items: normalized,
      total: normalized.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.1 Upsell Products
router.get(['/catalog/upsell', '/checkout/upsell'], (req, res) => {
  try {
    const upsells = [
      { id: 4, name: 'Es Teh Manis Jumbo', price: 6000, regular_price: 6000, image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400' },
      { id: 5, name: 'Es Jeruk Peras Asli', price: 10000, regular_price: 12000, image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400' }
    ];
    res.json({ success: true, products: upsells });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Checkout Session Sync
router.post(['/cart/sync', '/checkout/session'], (req, res) => {
  const { items = [], mode = 'all' } = req.body;
  const token = 'sess_' + crypto.randomBytes(12).toString('hex');
  res.json({
    success: true,
    token,
    session: {
      token,
      items,
      mode,
      created_at: new Date().toISOString()
    }
  });
});

// 5.3 Addresses (Protected by Customer OTP Session - Finding 1)
router.get('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const addresses = db.prepare(`
      SELECT * FROM customer_addresses 
      WHERE brand_id = ? AND customer_phone = ? 
      ORDER BY is_primary DESC, created_at DESC
    `).all(req.brand_id, customerPhone);

    res.json({ success: true, addresses: addresses || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const { label = 'Rumah', address = '', detail = '', note = '', latitude, longitude } = req.body;
    const customerPhone = req.customer.phone;

    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return res.status(400).json({
        success: false,
        error: 'Titik koordinat (latitude & longitude) wajib diisi dengan angka yang valid.'
      });
    }

    const addrId = 'addr_' + crypto.randomBytes(6).toString('hex');
    const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_phone = ?').get(req.brand_id, customerPhone);
    const isPrimary = (!existingCount || existingCount.cnt === 0) ? 1 : 0;

    db.prepare(`
      INSERT INTO customer_addresses (
        id, brand_id, customer_phone, label, address, detail, note, latitude, longitude, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addrId,
      req.brand_id,
      customerPhone,
      label,
      address,
      detail || '',
      note || '',
      Number(latitude),
      Number(longitude),
      isPrimary
    );

    const created = {
      id: addrId,
      brand_id: req.brand_id,
      customer_phone: customerPhone,
      label,
      address,
      detail,
      note,
      latitude: Number(latitude),
      longitude: Number(longitude),
      is_primary: isPrimary
    };

    res.status(201).json({ success: true, address: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_phone = ?').run(req.params.id, req.brand_id, customerPhone);
    res.json({ success: true, message: 'Alamat berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/checkout/verify', requireCustomerAuth(), (req, res) => {
  try {
    const { branch_id, items = [], order_type = 'delivery', pwa_runtime = null } = req.body;
    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'Cabang pemesanan (branch_id) wajib dipilih.' });
    }
    const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');

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
      guest_count,
      delivery,
      address,
      items = [],
      payment_method = 'cash',
      note = '',
      order_note = ''
    } = req.body;

    order_type = order_type || fulfillment.type || 'delivery';
    order_note = order_note || note || '';
    table_number = table_number || fulfillment.table_number || null;
    reservation_date = reservation_date || fulfillment.reservation_date || null;
    guest_count = guest_count || fulfillment.guest_count || null;

    if (address && !delivery) {
      delivery = {
        latitude: address.latitude,
        longitude: address.longitude,
        address: address.formatted_address || address.address || 'Alamat Customer'
      };
    }

    // P1 SECURE PAYMENT METHOD VALIDATION: Whitelist only officially supported payment methods
    const allowedPaymentMethods = ['cash', 'midtrans'];
    if (!allowedPaymentMethods.includes(payment_method)) {
      return res.status(400).json({
        success: false,
        error: `Metode pembayaran "${payment_method}" tidak valid. Pilihan yang didukung: ${allowedPaymentMethods.join(', ')}.`
      });
    }

    // P1 CUSTOMER IDENTITY BINDING (NEW-02): Extract customer session token
    const authHeader = req.headers['authorization'] || '';
    const customerToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
    const customerSession = customerToken ? TokenSessionStore.getSession(customerToken) : null;

    // CUSTOMER AUTH BOUNDARY: Checkout requires a valid OTP-verified customer session.
    // The server is the sole authority for customer identity — client-provided phone
    // is never trusted as the sole identity source for order creation.
    if (!customerSession || (customerSession.type !== 'customer' && customerSession.role !== 'customer') || customerSession.brandId !== req.brand_id) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Checkout memerlukan verifikasi OTP. Silakan verifikasi nomor WhatsApp Anda.'
      });
    }

    // Authoritative phone from OTP session — never from request body
    customer.phone = customerSession.phone;

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
    const PrePaymentVerificationGate = require('../../domains/commerce/services/PrePaymentVerificationGate');
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

      const promoConfig = (branch.promo_delivery_discount && branch.promo_min_order)
        ? { enabled: true, target: branch.promo_min_order, discount: branch.promo_delivery_discount }
        : { enabled: true, target: 50000, discount: 10000 };

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

    // 4. Delegate Cleanly to OrderPlacementService (ACID database transaction & event publishing)
    const OrderPlacementService = require('../../domains/commerce/services/OrderPlacementService');
    const placementResult = await OrderPlacementService.submitOrder({
      brand_id: req.brand_id,
      branch_id: branch.id,
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim()
      },
      items,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      delivery_record: deliveryRecord,
      fulfillment_schedule_type: schedule_type,
      scheduled_slot_start: scheduled_slot_start || null,
      scheduled_slot_end: scheduled_slot_end || null,
      payment_method,
      order_channel: 'customer_app',
      order_type,
      selection_mode,
      table_number,
      reservation_date,
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

    // 4. Payment Gateway Resolution (Midtrans Snap or Cash)
    let snapResult = { snap_token: null, redirect_url: null, merchant_id: payment_method === 'cash' ? 'cash' : 'midtrans_default' };

    if (payment_method === 'midtrans') {
      try {
        snapResult = await PaymentService.createSnapTransaction(
          { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount },
          order.items,
          customer
        );
      } catch (payErr) {
        console.error('[Payment Gateway Error / Timeout]:', payErr.message);
        // P1 RECONCILIATION-AWARE FAILURE HANDLING (NEW-01 & NEW-02):
        // Mark payment as 'reconciliation_pending' so if gateway actually processed the transaction,
        // incoming settlement webhook can reconcile and confirm the order cleanly.
        db.exec('BEGIN IMMEDIATE;');
        try {
          db.prepare("UPDATE order_payments SET payment_status = 'reconciliation_pending', updated_at = datetime('now') WHERE order_id = ?").run(orderId);
          db.prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(orderId);
          db.exec('COMMIT;');
        } catch (_) {
          try { db.exec('ROLLBACK;'); } catch (_) {}
        }
        return res.status(502).json({
          success: false,
          error: 'PAYMENT_GATEWAY_TIMEOUT',
          message: `Koneksi ke gateway pembayaran online mengalami kendala (${payErr.message}). Jika Anda sudah melakukan pembayaran, transaksi akan otomatis direkonsiliasi.`
        });
      }
    }

    if (snapResult.snap_token || snapResult.merchant_id) {
      db.prepare(`
        UPDATE order_payments
        SET snap_token = ?, merchant_id = ?, updated_at = ?
        WHERE order_id = ?
      `).run(snapResult.snap_token || null, snapResult.merchant_id || (payment_method === 'cash' ? 'cash' : 'midtrans'), new Date().toISOString(), orderId);
    }

    res.status(201).json({
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      grand_total: grandTotal,
      subtotal,
      delivery_fee: deliveryFee,
      discount_amount: discountAmount,
      payment: {
        method: payment_method,
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

// In-Memory Token & Session Store with TTL
const TokenSessionStore = {
  sessions: new Map(),
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
      expiresAt
    });
    return { token, expiresAt };
  },
  createCustomerSession(phone, brand_id, ttlSeconds = 2592000) {
    const token = 'xnt_cust_' + crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.sessions.set(token, {
      type: 'customer',
      role: 'customer',
      phone: phone.trim(),
      customerPhone: phone.trim(),
      brandId: brand_id,
      brand_id: brand_id,
      expiresAt
    });
    return { token, expiresAt };
  },
  getSession(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  },
  destroySession(token) {
    if (token) this.sessions.delete(token);
  }
};

// Middleware: Require Authenticated Customer Session (Finding 1)
function requireCustomerAuth() {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'CUSTOMER_AUTH_REQUIRED',
        message: 'Akses ditolak: Nomor WhatsApp bukan kredensial. Harap login dan verifikasi OTP untuk mengakses data alamat pribadi Anda.'
      });
    }

    const session = TokenSessionStore.getSession(token);
    if (!session || (session.type !== 'customer' && session.role !== 'customer')) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_OR_EXPIRED_CUSTOMER_SESSION',
        message: 'Sesi akun customer Anda tidak valid atau telah kedaluwarsa. Silakan verifikasi OTP kembali.'
      });
    }

    if (session.brandId !== req.brand_id) {
      return res.status(403).json({
        success: false,
        error: 'TENANT_MISMATCH',
        message: 'Sesi customer tidak valid untuk brand ini.'
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

    // P1 TENANT & ORGANIZATION BOUNDARY ENFORCEMENT via Core Identity
    let isTenantAuthorized = session.brandId === req.brand_id;
    if (!isTenantAuthorized && session.role === 'owner') {
      if (session.organizationId && req.brand && req.brand.organization_id) {
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

    // P1 BRANCH SCOPE BOUNDARY ENFORCEMENT (FINDING-01 & NEW-05)
    // Branch-level roles (branch_manager, cashier, kitchen) MUST be assigned to a branch and cannot access outside it
    const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
    if (branchScopedRoles.includes(session.role)) {
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

// 7. Get Order Details & Live Status (Protected by Ownership or Operator Auth - NEW-01)
router.get('/orders/:id', (req, res) => {
  // P1 TENANT ISOLATION: Join branches to strictly verify brand ownership
  const order = db.prepare(`
    SELECT o.*, b.brand_id 
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE o.id = ? AND b.brand_id = ?
  `).get(req.params.id, req.brand_id);

  if (!order) {
    return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada brand ini.' });
  }

  // P1 HORIZONTAL & BRANCH AUTHORIZATION (IDOR Guard - NEW-01 & NEW-02):
  // Check if caller is authenticated staff/operator (with strict branch isolation) or authenticated customer
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || req.headers['x-customer-token'] || '').trim();
  const session = token ? TokenSessionStore.getSession(token) : null;
  
  let isAuthorized = false;

  if (session) {
    if (session.type === 'customer' || session.role === 'customer') {
      // Customer must own the order and match tenant brand
      if (session.brandId === req.brand_id && session.phone === order.customer_phone) {
        isAuthorized = true;
      }
    } else if (['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'].includes(session.role)) {
      // Operator must match tenant brand
      let isBrandMatch = session.brandId === req.brand_id;
      if (!isBrandMatch && session.role === 'owner' && session.organizationId && req.brand?.organization_id) {
        isBrandMatch = session.organizationId === req.brand.organization_id;
      }

      if (isBrandMatch) {
        // Branch-scoped operator roles (branch_manager, cashier, kitchen) MUST match order's branch
        const branchScopedRoles = ['branch_manager', 'cashier', 'kitchen'];
        if (branchScopedRoles.includes(session.role)) {
          if (session.branchId === order.branch_id) {
            isAuthorized = true;
          }
        } else {
          // Brand-level roles (owner, brand_manager) can view all branches in the brand
          isAuthorized = true;
        }
      }
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORDER_ACCESS',
      message: 'Akses ditolak: Anda tidak memiliki sesi terotentikasi yang sah untuk melihat detail pesanan ini.'
    });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
  const logs = db.prepare('SELECT previous_status, new_status, note, created_at FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  // P1 INFORMATION HIDING & PRIVACY (NEW-01 & NEW-09):
  // Return clean DTO projection to prevent internal data/GPS leakage
  const safeOrder = {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    order_channel: order.order_channel,
    table_number: order.table_number,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    discount_amount: order.discount_amount,
    grand_total: order.grand_total,
    payment_method: order.payment_method,
    order_note: order.order_note,
    created_at: order.created_at,
    updated_at: order.updated_at
  };

  const safeItems = (items || []).map(it => ({
    id: it.id,
    product_id: it.product_id,
    product_name: it.product_name || it.name,
    unit_price: it.unit_price,
    quantity: it.quantity,
    item_subtotal: it.item_subtotal,
    note: it.note || ''
  }));

  const safeDelivery = delivery ? {
    destination_address: delivery.destination_address,
    actual_road_distance_meters: delivery.actual_road_distance_meters,
    delivery_fee_calculated: delivery.delivery_fee_calculated
  } : null;

  const safePayment = payment ? {
    payment_method: payment.payment_method || payment.provider,
    payment_status: payment.payment_status,
    amount: payment.amount,
    settled_at: payment.settled_at,
    created_at: payment.created_at
  } : null;

  res.json({
    success: true,
    order: safeOrder,
    items: safeItems,
    delivery: safeDelivery,
    payment: safePayment,
    logs
  });
});

// 8. Kitchen Display Queue (Strictly Tenant-Scoped & Branch-Scoped for Operator Roles)
router.get('/kitchen/queue', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  // If user is a branch-level operator, strictly enforce their assigned branch
  const effectiveBranchId = (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId)
    ? req.user.branchId
    : req.query.branch_id;

  let sql = `
    SELECT o.*, b.name as branch_name, b.brand_id
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE b.brand_id = ? AND o.status IN ('confirmed', 'preparing', 'ready')
  `;
  const params = [req.brand_id];

  if (effectiveBranchId) {
    sql += ' AND o.branch_id = ?';
    params.push(effectiveBranchId);
  }

  sql += ' ORDER BY o.created_at ASC';

  const orders = db.prepare(sql).all(...params);

  const enriched = orders.map((ord) => ({
    ...ord,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
    delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id)
  }));

  res.json({ success: true, orders: enriched });
});

// 9. Update Order Status (Kitchen / Operator with Auth Binding, Branch Guard & Role-Based Status Transitions)
router.patch('/kitchen/orders/:id/status', requireAuth(['owner', 'brand_manager', 'branch_manager', 'kitchen']), (req, res) => {
  try {
    const { status, note = '' } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'Status target wajib diisi.' });
    }

    // P1 ROLE-BASED TRANSITION AUTHORITY (FINDING-02A)
    // Kitchen role can ONLY advance operational cooking stages ('preparing', 'ready').
    // Manager/Owner can advance the operational fulfillment lifecycle
    // ('preparing' → 'ready' → 'out_for_delivery' → 'completed').
    // R5 BOUNDARY (CHECK-1/CHECK-4): ACCEPT ('confirmed') is EXCLUSIVELY served
    // by POST /orders/:id/branch-acceptance (branch_manager | brand_manager |
    // owner, audited [ACCEPT by <actor>], idempotent); this generic PATCH must
    // NOT offer 'confirmed' — payment/kitchen/generic flows must never silently
    // become Branch operational acceptance. 'cancelled' is likewise removed:
    // after ACCEPT, cancellation is NOT a generic normal operation — it is a
    // Branch Exception / recovery path (R8, later task) or payment-driven
    // failure. Customer cancellation is served by POST /orders/:id/cancel
    // (pending only). Financial/Refund state is EXCLUSIVELY handled via a
    // dedicated recovery flow.
    const ROLE_ALLOWED_TARGET_STATUSES = {
      kitchen: ['preparing', 'ready'],
      branch_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      brand_manager: ['preparing', 'ready', 'out_for_delivery', 'completed'],
      owner: ['preparing', 'ready', 'out_for_delivery', 'completed']
    };

    const allowedTargetStatuses = ROLE_ALLOWED_TARGET_STATUSES[req.user.role] || [];
    if (!allowedTargetStatuses.includes(status)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_ROLE_AUTHORITY',
        message: `Role "${req.user.role}" tidak memiliki wewenang untuk mengubah status pesanan menjadi "${status}".`
      });
    }

    // P1 AUTH BINDING: Use authoritative actor identity from authenticated session
    const actor_type = req.user.role === 'kitchen' ? 'kitchen' : 'staff';
    const actor_id = req.user.userId || req.user.username;

    // Verify order exists and belongs to current brand before transition
    let verifySql = `
      SELECT o.id, o.branch_id, b.brand_id 
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
    `;
    const verifyParams = [req.params.id, req.brand_id];

    // If branch operator, ensure order belongs to their assigned branch
    if (['branch_manager', 'cashier', 'kitchen'].includes(req.user.role) && req.user.branchId) {
      verifySql += ' AND o.branch_id = ?';
      verifyParams.push(req.user.branchId);
    }

    const existingOrder = db.prepare(verifySql).get(...verifyParams);

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    const result = OrderStateMachine.transition({
      order_id: req.params.id,
      target_status: status,
      actor_type,
      actor_id,
      note
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.0 R5 BRANCH ACCEPTANCE — operational acceptance boundary for an order
// awaiting branch acceptance (orders.status = 'pending').
//   ACCEPT → 'confirmed' (ACCEPTED — the locked operational acceptance state:
//           order valid, kitchen/fulfillment may proceed, inventory deducts)
//   REJECT → 'rejected' (REJECTED — terminal, DISTINCT from customer
//           cancellation 'cancelled')
// TIMEOUT is reserved for a separate timeout-worker task (not implemented).
// Decisions are server-authoritative, branch/brand-scoped, atomic
// (OrderStateMachine: BEGIN IMMEDIATE + compare-and-swap + audit log),
// auditable (order_status_logs: order, actor, previous/new state, decision,
// reason, timestamp), and idempotent for repeated identical decisions.
// A rejected branch is NEVER silently rematched to another branch, and an
// order with a settled payment cannot be branch-rejected (refund flow first).
router.post('/orders/:id/branch-acceptance', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { decision, reason = '', note = '' } = req.body;
    if (!decision || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({
        success: false,
        status: 'INVALID_DECISION',
        error: 'decision wajib bernilai "accept" atau "reject".'
      });
    }

    const targetStatus = decision === 'accept' ? 'confirmed' : 'rejected';
    if (decision === 'reject' && !String(reason || '').trim()) {
      return res.status(400).json({
        success: false,
        status: 'REASON_REQUIRED',
        error: 'Alasan penolakan cabang (reason) wajib diisi untuk audit.'
      });
    }

    // Branch scope: branch_manager acts ONLY on their assigned branch;
    // brand_manager/owner are brand-wide. Never trust a client branch_id.
    const verifySql = `
      SELECT o.id, o.branch_id, o.status, b.brand_id
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
      ${(req.user.role === 'branch_manager' && req.user.branchId) ? ' AND o.branch_id = ?' : ''}
    `;
    const verifyParams = [req.params.id, req.brand_id];
    if (req.user.role === 'branch_manager' && req.user.branchId) verifyParams.push(req.user.branchId);

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada kewenangan cabang Anda.' });
    }

    // Idempotency: repeating the SAME decision on an order already in the
    // target state is a safe no-op (no state change, no duplicate audit).
    if (order.status === targetStatus) {
      return res.json({
        success: true,
        order_id: order.id,
        decision,
        previous_status: order.status,
        new_status: order.status,
        idempotent: true
      });
    }

    const actorLabel = req.user.role + ':' + (req.user.username || req.user.userId || 'actor');
    const actorNote = decision === 'accept'
      ? `[ACCEPT by ${actorLabel}] ${note ? note : ''}`.trim()
      : `[REJECT by ${actorLabel}] ${String(reason).trim()}`;

    const result = OrderStateMachine.transition({
      order_id: order.id,
      target_status: targetStatus,
      actor_type: 'branch_actor',
      actor_id: req.user.userId || req.user.username,
      note: actorNote
    });

    res.json({ success: true, decision, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
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
router.post('/orders/:id/cancel', requireCustomerAuth(), (req, res) => {
  try {
    const reason = String(req.body.reason || req.body.note || '').trim();
    const order = db.prepare('SELECT id, status, customer_phone FROM orders WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan.' });
    }
    if (String(order.customer_phone) !== String(req.customer.phone)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_ORDER_OWNERSHIP',
        message: 'Anda hanya dapat membatalkan pesanan milik Anda sendiri.'
      });
    }

    if (order.status !== 'pending') {
      const hint = order.status === 'confirmed'
        ? 'Pesanan sudah diterima cabang dan tidak dapat dibatalkan oleh customer pada tahap ini.'
        : `Pesanan sudah berstatus "${order.status}" dan tidak dapat dibatalkan lagi.`;
      return res.status(400).json({
        success: false,
        status: 'CUSTOMER_CANCEL_NOT_ALLOWED',
        error: hint
      });
    }

    const result = OrderStateMachine.transition({
      order_id: order.id,
      target_status: 'cancelled',
      actor_type: 'customer',
      actor_id: req.customer.phone,
      note: `[CUSTOMER_CANCEL]${reason ? ' ' + reason : ''}`,
      // R11 TOCTOU GUARD: re-validated INSIDE the machine transaction — if a
      // branch ACCEPT (or timeout) committed between the pre-check above and
      // this transaction, the order is no longer pending and the cancel must
      // fail ([STATE_CHANGED]) instead of cancelling an ACCEPTED order.
      expected_current_status: 'pending'
    });

    res.json({ success: true, decision: 'customer_cancel', ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.1 Staff / POS Cash Settlement Endpoint (Authorized Cashiers, Branch Managers, & Brand Owners)
router.post('/pos/orders/:id/settle-cash', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const orderId = req.params.id;
    const { amount_tendered, shift_id } = req.body;

    // Canonical Session Identity Resolution
    const cashierId = req.user ? (req.user.id || req.user.userId) : null;
    const userBranchId = req.user ? (req.user.branch_id || req.user.branchId) : null;

    // Scope & Branch Boundary Enforcement
    let verifySql = 'SELECT * FROM orders WHERE id = ? AND brand_id = ?';
    const verifyParams = [orderId, req.brand_id];

    if (req.user && ['branch_manager', 'cashier'].includes(req.user.role) && userBranchId) {
      verifySql += ' AND branch_id = ?';
      verifyParams.push(userBranchId);
    }

    const order = db.prepare(verifySql).get(...verifyParams);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Pesanan tidak ditemukan atau berada di luar kewenangan cabang Anda.'
      });
    }

    let effectiveShiftId = null;

    // P1 SHIFT RESOLUTION & OVERRIDE POLICY (NEW-04):
    // Cashier MUST use their own active shift on the order's branch.
    // Branch manager / Owner can supply explicit shift_id if it belongs to the same branch.
    if (req.user.role === 'cashier') {
      const activeShift = db.prepare(`
        SELECT id FROM pos_shifts 
        WHERE cashier_id = ? AND branch_id = ? AND status = 'open' 
        ORDER BY opened_at DESC LIMIT 1
      `).get(cashierId, order.branch_id);

      if (activeShift) {
        effectiveShiftId = activeShift.id;
      } else {
        return res.status(400).json({
          success: false,
          error: 'Kasir belum membuka shift aktif. Harap buka shift kasir terlebih dahulu sebelum menerima pembayaran tunai.'
        });
      }
    } else {
      if (shift_id) {
        const checkShift = db.prepare('SELECT id, branch_id FROM pos_shifts WHERE id = ?').get(shift_id);
        if (!checkShift || checkShift.branch_id !== order.branch_id) {
          return res.status(400).json({
            success: false,
            error: 'Shift yang ditentukan tidak valid atau tidak cocok dengan cabang pesanan ini.'
          });
        }
        effectiveShiftId = shift_id;
      }
    }

    // P1 EXPLICIT CASHIER ASSERTION: amount_tendered is strictly required (no silent inference)
    if (amount_tendered === undefined || amount_tendered === null || !Number.isFinite(Number(amount_tendered)) || Number(amount_tendered) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal uang yang diterima (amount_tendered) wajib diisi dengan angka positif yang valid.'
      });
    }

    // Authoritative Domain Settlement Execution (Single Source of Truth)
    const { CashSettlementService } = require('../../domains/payment');
    const result = CashSettlementService.settleCashPayment({
      order_id: orderId,
      amount: Number(order.grand_total),
      amount_tendered: Number(amount_tendered),
      cashier_id: cashierId,
      shift_id: effectiveShiftId
    });

    res.json({
      success: true,
      message: result.message || 'Pembayaran tunai berhasil diselesaikan.',
      idempotent: !!result.idempotent,
      payment: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9.2 POS Shift Management Endpoints (Strictly Authorized Cashiers, Branch Managers & Owners)
router.get('/pos/shifts/current', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = (['cashier', 'branch_manager'].includes(userRole))
      ? (req.user.branch_id || req.user.branchId)
      : (req.user.branch_id || req.user.branchId || req.query.branch_id);
    const targetCashierId = (['owner', 'brand_manager', 'branch_manager'].includes(userRole) && req.query.cashier_id)
      ? req.query.cashier_id
      : cashierId;

    if (!userBranchId) {
      return res.status(400).json({ success: false, error: 'Parameter branch_id wajib disertakan.' });
    }

    const shift = db.prepare(`
      SELECT * FROM pos_shifts 
      WHERE cashier_id = ? AND branch_id = ? AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `).get(targetCashierId, userBranchId);

    res.json({
      success: true,
      has_active_shift: !!shift,
      shift: shift || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/open', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const cashierId = req.user.id || req.user.userId;
    const userRole = req.user.role;
    const userBranchId = req.user.branch_id || req.user.branchId;
    const { starting_float = 0, branch_id: requestedBranchId, cashier_id: requestedCashierId } = req.body;

    let targetBranchId = userBranchId || requestedBranchId;
    let targetCashierId = cashierId;

    // P1 ROLE-BASED BRANCH ENFORCEMENT (NEW-03)
    if (userRole === 'cashier') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Kasir hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      targetCashierId = cashierId; // Cashier cannot open shift on behalf of other cashiers
    } else if (userRole === 'branch_manager') {
      if (userBranchId && requestedBranchId && requestedBranchId !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: `Akses ditolak: Manajer cabang hanya berwenang membuka shift di cabang yang ditugaskan (${userBranchId}).`
        });
      }
      targetBranchId = userBranchId || requestedBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    } else if (['owner', 'brand_manager'].includes(userRole)) {
      targetBranchId = requestedBranchId || userBranchId;
      if (requestedCashierId) {
        targetCashierId = requestedCashierId;
      } else {
        const branchCashier = db.prepare('SELECT id FROM users WHERE branch_id = ? AND role = "cashier" LIMIT 1').get(targetBranchId);
        if (!branchCashier) {
          return res.status(400).json({ success: false, error: 'Parameter cashier_id (user dengan role "cashier") wajib disertakan untuk membuka shift.' });
        }
        targetCashierId = branchCashier.id;
      }
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'Cabang (branch_id) wajib disertakan untuk membuka shift.' });
    }

    // Verify branch belongs to authenticated brand
    const branchCheck = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchCheck) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const shift = PosShiftService.openShift({
      branch_id: targetBranchId,
      cashier_id: targetCashierId,
      starting_float: Number(starting_float) || 0
    });

    res.status(201).json({
      success: true,
      message: 'Shift kasir berhasil dibuka.',
      shift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/cash-movement', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { type, amount, reason = '' } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT MUTATION RBAC & OWNERSHIP GUARD (NEW-01)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang mencatat mutasi kas pada shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang mengelola shift di cabang yang ditugaskan.'
        });
      }
    }

    if (!type || !['in', 'out'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Tipe mutasi kas wajib "in" atau "out".' });
    }
    if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Jumlah uang (amount) harus berupa angka positif.' });
    }

    const { PosShiftService } = require('../../domains/pos');
    const updatedShift = PosShiftService.recordCashMovement({
      shift_id: shiftId,
      type,
      amount: Number(amount),
      reason: String(reason),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: `Mutasi kas (${type === 'in' ? 'Cash In' : 'Cash Out'}) berhasil dicatat.`,
      shift: updatedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/pos/shifts/:id/close', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const shiftId = req.params.id;
    const { actual_cash } = req.body;

    const cashierId = req.user.id || req.user.userId;
    const userBranchId = req.user.branch_id || req.user.branchId;

    // Strict Shift Tenant & Ownership Verification
    const shift = db.prepare(`
      SELECT s.*, b.brand_id 
      FROM pos_shifts s
      JOIN branches b ON b.id = s.branch_id
      WHERE s.id = ? AND b.brand_id = ?
    `).get(shiftId, req.brand_id);

    if (!shift) {
      return res.status(404).json({ success: false, error: 'Shift tidak ditemukan pada brand ini.' });
    }

    // P1 SHIFT CLOSING RBAC & OWNERSHIP GUARD (NEW-01 & NEW-02)
    if (req.user.role === 'cashier') {
      if (shift.cashier_id !== cashierId || (userBranchId && shift.branch_id !== userBranchId)) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Kasir hanya berwenang menutup shift miliknya sendiri.'
        });
      }
    } else if (req.user.role === 'branch_manager') {
      if (userBranchId && shift.branch_id !== userBranchId) {
        return res.status(403).json({
          success: false,
          error: 'Akses ditolak: Manajer cabang hanya berwenang menutup shift di cabang yang ditugaskan.'
        });
      }
    }

    if (actual_cash === undefined || actual_cash === null || !Number.isFinite(Number(actual_cash)) || Number(actual_cash) < 0) {
      return res.status(400).json({
        success: false,
        error: 'Nominal kas fisik aktual (actual_cash) wajib diisi dengan angka valid.'
      });
    }

    const { PosShiftService } = require('../../domains/pos');
    const closedShift = PosShiftService.closeShift({
      shift_id: shiftId,
      actual_cash: Number(actual_cash),
      actor_id: cashierId,
      actor_role: req.user.role
    });

    res.json({
      success: true,
      message: 'Shift kasir berhasil ditutup.',
      shift: closedShift
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10. Midtrans Webhook
router.post('/webhooks/midtrans', (req, res) => {
  try {
    const result = PaymentService.handleWebhook(req.body);
    res.json(result);
  } catch (err) {
    console.error('[Webhook] Midtrans error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 10.1 Merchant Auth Endpoints
router.post('/auth/merchant/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi.' });
    }

    let user = null;
    try {
      user = db.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND brand_id = ?').get(username, username, req.brand_id);
    } catch (_) {}

    if (!user) {
      return res.status(401).json({ success: false, error: 'Username atau password salah.' });
    }

    // P1 SECURE PASSWORD VERIFICATION: Strictly hash-only verification against database password_hash
    const hashedInput = crypto.createHash('sha256').update(password).digest('hex');
    const isValid = user.password_hash === hashedInput;

    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Username atau password salah.' });
    }

    // B1 BRANCH/BRAND INTEGRITY (B1.1, B1.8): a branch-scoped operator account must reference a
    // branch that actually belongs to the brand being logged into. A cross-brand branch reference
    // can never become an active session (defense-in-depth on top of the DB foreign key).
    if (user.branch_id) {
      const ownedBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(user.branch_id, req.brand_id);
      if (!ownedBranch) {
        return res.status(401).json({
          success: false,
          error: 'BRANCH_TENANT_MISMATCH',
          message: 'Akun operator tidak terdaftar pada cabang brand ini. Hubungi pemilik brand.'
        });
      }
    }

    // Register active session in TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(user, req.brand_id);

    res.json({
      success: true,
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        branch_id: user.branch_id || null,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    });
  } catch (err) {
    console.error('[Merchant Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan sistem saat autentikasi.' });
  }
});

// P1 DATA SANITIZATION HELPER (SEC-02 & FINDING 10)
function serializePublicBrand(brand) {
  if (!brand) return null;
  let banners = [];
  try {
    banners = brand.banners ? (typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners) : [];
  } catch (_) {}

  if (!Array.isArray(banners) || banners.length === 0) {
    banners = [
      {
        id: 'banner_1',
        image_url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80',
        title: 'Slalu ada sensasi di setiap gigitan',
        link: '#'
      },
      {
        id: 'banner_2',
        image_url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&auto=format&fit=crop&q=80',
        title: 'Paket Spesial Diskon 20%',
        link: '#'
      },
      {
        id: 'banner_3',
        image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&auto=format&fit=crop&q=80',
        title: 'Ayam Tulang Lunak Khas Bangjo',
        link: '#'
      }
    ];
  }

  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logo_url: brand.logo_url || '/assets/pwa/icon-192.png',
    primary_color: brand.primary_color || '#b6ff00',
    custom_domain: brand.custom_domain || 'app.mybangjo.com',
    tagline: brand.tagline || 'Official Online Food Ordering',
    banners
  };
}

// P1 SECURE ME ENDPOINT: Strictly verifies Bearer token session and sanitizes brand DTO (FINDING 10)
router.get('/auth/merchant/me', requireAuth(), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.fullName,
      role: req.user.role,
      branch_id: req.user.branchId || null,
      brand_name: req.brand ? req.brand.name : 'Bangjo Resto'
    },
    brand: serializePublicBrand(req.brand)
  });
});



/* =========================================================================
   ADMIN & OWNER DASHBOARD API ENDPOINTS (Protected by requireAuth)
   ========================================================================= */

// 11. Admin Brand Profile & Theme
router.get('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let brand = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.brand_id);
    if (!brand) brand = req.brand;
    res.json({
      success: true,
      brand: serializePublicBrand(brand)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/brand', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, primary_color, logo_url, custom_domain, tagline, banners } = req.body;
    const bannersJson = banners ? (typeof banners === 'string' ? banners : JSON.stringify(banners)) : null;

    db.prepare(`
      UPDATE brands 
      SET name = COALESCE(?, name),
          primary_color = COALESCE(?, primary_color),
          logo_url = COALESCE(?, logo_url),
          custom_domain = COALESCE(?, custom_domain),
          tagline = COALESCE(?, tagline),
          banners = COALESCE(?, banners),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      primary_color !== undefined ? primary_color : null,
      logo_url !== undefined ? logo_url : null,
      custom_domain !== undefined ? custom_domain : null,
      tagline !== undefined ? tagline : null,
      bannersJson,
      req.brand_id
    );

    if (req.brand) {
      req.brand.name = name || req.brand.name;
      req.brand.primary_color = primary_color || req.brand.primary_color;
      req.brand.logo_url = logo_url || req.brand.logo_url;
      req.brand.custom_domain = custom_domain || req.brand.custom_domain;
      req.brand.tagline = tagline || req.brand.tagline;
      if (bannersJson) req.brand.banners = bannersJson;
    }

    let parsedBanners = [];
    try {
      parsedBanners = bannersJson ? JSON.parse(bannersJson) : (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners);
    } catch (_) {}

    res.json({
      success: true,
      message: 'Pengaturan brand dan tema berhasil diperbarui.',
      brand: {
        id: req.brand.id,
        name: req.brand.name,
        slug: req.brand.slug,
        logo_url: req.brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: req.brand.primary_color || '#b6ff00',
        custom_domain: req.brand.custom_domain || 'app.mybangjo.com',
        tagline: req.brand.tagline || 'Official Online Food Ordering',
        banners: Array.isArray(parsedBanners) ? parsedBanners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11.1 Add/Delete Banners
router.post('/admin/banners', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { image_url, title = '', link = '#' } = req.body;
    if (!image_url) {
      return res.status(400).json({ success: false, error: 'URL gambar banner wajib diisi.' });
    }
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    if (banners.length >= 5) {
      return res.status(400).json({ success: false, error: 'Maksimal 5 slide banner promo.' });
    }
    const newBanner = {
      id: 'banner_' + Date.now(),
      image_url,
      title,
      link
    };
    banners.push(newBanner);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil ditambahkan.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/banners/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let banners = [];
    try {
      banners = req.brand.banners ? (typeof req.brand.banners === 'string' ? JSON.parse(req.brand.banners) : req.brand.banners) : [];
    } catch(e) {}
    if (!Array.isArray(banners)) banners = [];
    banners = banners.filter(b => b.id !== req.params.id);
    const bannersJson = JSON.stringify(banners);
    db.prepare('UPDATE brands SET banners = ?, updated_at = datetime(\'now\') WHERE id = ?').run(bannersJson, req.brand_id);
    if (req.brand) req.brand.banners = bannersJson;
    res.json({ success: true, message: 'Banner berhasil dihapus.', banners });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Admin Categories CRUD
router.get('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let categories = db.prepare('SELECT * FROM categories WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    if (!categories || categories.length === 0) {
      categories = [
        { id: 1, name: 'Makanan Utama', slug: 'makanan-utama', image: '/assets/icons/delivery.png', sort_order: 1 },
        { id: 2, name: 'Minuman Segar', slug: 'minuman-segar', image: '/assets/icons/dine_in.png', sort_order: 2 },
        { id: 3, name: 'Camilan & Side', slug: 'camilan', image: '/assets/icons/pick_up.png', sort_order: 3 }
      ];
    }
    res.json({ success: true, categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/categories', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });

    const id = 'cat_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    db.prepare(`
      INSERT INTO categories (id, brand_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE brand_id = ?))
    `).run(id, req.brand_id, name, slug, req.brand_id);

    res.status(201).json({
      success: true,
      category: { id, name, slug, image: image || '/assets/icons/delivery.png' }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, image, sort_order } = req.body;
    db.prepare(`
      UPDATE categories 
      SET name = COALESCE(?, name),
          sort_order = COALESCE(?, sort_order)
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      sort_order !== undefined ? sort_order : null,
      req.params.id,
      req.brand_id
    );

    res.json({ success: true, message: 'Kategori berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/categories/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    db.prepare('DELETE FROM categories WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    res.json({ success: true, message: 'Kategori berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Admin Products CRUD
router.get('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    let products = db.prepare('SELECT * FROM products WHERE brand_id = ? ORDER BY sort_order ASC').all(req.brand_id);
    if (!products || products.length === 0) {
      products = [
        { id: 1, category_id: 1, name: 'Ayam Bakar Madu Bangjo', price: 28000, regular_price: 32000, description: 'Ayam bakar dengan lumuran madu asli rempah khas Bangjo.', image: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=400', is_active: 1 },
        { id: 2, category_id: 1, name: 'Bebek Goreng Crispy', price: 34000, regular_price: 38000, description: 'Bebek ungkep gurih digoreng renyah dengan sambal korek pedas.', image: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400', is_active: 1 },
        { id: 3, category_id: 1, name: 'Nasi Goreng Spesial Bangjo', price: 25000, regular_price: 25000, description: 'Nasi goreng racikan istimewa telur mata sapi dan acar.', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400', is_active: 1 },
        { id: 4, category_id: 2, name: 'Es Teh Manis Jumbo', price: 6000, regular_price: 6000, description: 'Teh melati seduh dingin segar porsi besar.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400', is_active: 1 },
        { id: 5, category_id: 2, name: 'Es Jeruk Peras Asli', price: 10000, regular_price: 12000, description: 'Jeruk peras murni tanpa pengawet.', image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400', is_active: 1 }
      ];
    }
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/admin/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, error: 'Nama dan harga menu wajib diisi.' });

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    const id = 'prod_' + Date.now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    db.prepare(`
      INSERT INTO products (id, brand_id, category_id, name, slug, description, price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products WHERE brand_id = ?))
    `).run(
      id,
      req.brand_id,
      category_id !== undefined ? category_id : null,
      name,
      slug,
      description !== undefined ? description : '',
      Number(price),
      req.brand_id
    );

    res.status(201).json({
      success: true,
      product: {
        id,
        name,
        category_id,
        price: Number(price),
        regular_price: regular_price ? Number(regular_price) : Number(price),
        description,
        image: image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
        is_active: 1
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, category_id, price, regular_price, description, image, is_active } = req.body;

    // P1 TENANT CATEGORY INTEGRITY GUARD (FINDING 02)
    if (category_id !== undefined && category_id !== null) {
      const validCategory = db.prepare('SELECT id FROM categories WHERE id = ? AND brand_id = ?').get(category_id, req.brand_id);
      if (!validCategory) {
        return res.status(400).json({
          success: false,
          error: 'Kategori produk tidak ditemukan atau bukan milik brand ini.'
        });
      }
    }

    const stmt = db.prepare(`
      UPDATE products 
      SET name = COALESCE(?, name),
          category_id = COALESCE(?, category_id),
          price = COALESCE(?, price),
          description = COALESCE(?, description),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      category_id !== undefined ? category_id : null,
      price !== undefined ? price : null,
      description !== undefined ? description : null,
      is_active !== undefined ? is_active : null,
      req.params.id,
      req.brand_id
    );

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Menu produk berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/admin/products/:id/toggle', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare(`
      UPDATE products 
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(req.params.id, req.brand_id);

    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan atau tidak berubah.' });
    }

    res.json({ success: true, message: 'Status ketersediaan menu berhasil diubah.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/admin/products/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM products WHERE id = ? AND brand_id = ?').run(req.params.id, req.brand_id);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });
    }
    res.json({ success: true, message: 'Menu berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Admin Branches & Delivery Settings
router.get('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const branches = db.prepare(`
      SELECT 
        b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.whatsapp_number, b.is_active, b.is_open_override,
        s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ?
    `).all(req.brand_id);

    res.json({ success: true, branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1 Create Branch (Mandatory Branch WhatsApp Business Number - FINDING-03)
router.post('/admin/branches', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      name,
      address_text,
      latitude,
      longitude,
      phone,
      whatsapp_number,
      free_delivery_km,
      price_per_km,
      max_radius_km,
      promo_min_order,
      promo_delivery_discount
    } = req.body;

    const rawWa = (whatsapp_number || phone || '').trim();

    // P1 BUSINESS INVARIANT (FINDING-03): Branch WhatsApp Business identity is mandatory & must be a valid mobile WA number
    if (!rawWa) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp Business cabang wajib diisi saat pendaftaran cabang.'
      });
    }

    // Validate standard Indonesian WhatsApp mobile format (e.g. 08..., 628..., +628...)
    const cleanDigits = rawWa.replace(/[^0-9]/g, '');
    const isIndoMobile = cleanDigits.startsWith('08') || cleanDigits.startsWith('628') || cleanDigits.startsWith('8');
    if (!isIndoMobile || cleanDigits.length < 9 || cleanDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif (contoh: 081234567890 atau 6281234567890).'
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Nama cabang wajib diisi.'
      });
    }

    const branchId = 'branch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const branchPhone = (phone || rawWa).trim();
    const branchWa = rawWa;

    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, whatsapp_number, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      branchId,
      req.brand_id,
      name.trim(),
      slug,
      address_text ? address_text.trim() : '',
      latitude !== undefined ? latitude : 0,
      longitude !== undefined ? longitude : 0,
      branchPhone,
      branchWa
    );

    const deliverySettingsId = 'bds_' + branchId;
    db.prepare(`
      INSERT OR REPLACE INTO branch_delivery_settings (id, branch_id, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      deliverySettingsId,
      branchId,
      free_delivery_km !== undefined ? free_delivery_km : 0,
      price_per_km !== undefined ? price_per_km : 3000,
      max_radius_km !== undefined ? max_radius_km : 10,
      promo_min_order !== undefined ? promo_min_order : 50000,
      promo_delivery_discount !== undefined ? promo_delivery_discount : 0
    );

    res.status(201).json({
      success: true,
      message: 'Cabang berhasil didaftarkan.',
      branch_id: branchId,
      branch: {
        id: branchId,
        brand_id: req.brand_id,
        name: name.trim(),
        slug,
        phone: branchPhone,
        whatsapp_number: branchWa,
        address_text: address_text || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/branches/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount } = req.body;
    const targetPhone = phone !== undefined ? phone : null;
    const targetWa = whatsapp_number !== undefined ? whatsapp_number : null;

    // B1 OPERATIONAL STATE VALIDATION (B1.3): authoritative branch operational booleans
    // (is_active lifecycle, is_open_override open/close switch) accept ONLY 0 or 1.
    // Rejects invalid transitions instead of silently persisting arbitrary client values.
    const normBoolField = (value) => {
      if (value === undefined || value === null) return null;
      if (value === true) return 1;
      if (value === false) return 0;
      const n = Number(value);
      if (n !== 0 && n !== 1) return undefined; // sentinel: invalid
      return n;
    };
    const providedIsActive = normBoolField(is_active);
    const providedIsOpenOverride = normBoolField(is_open_override);
    if (is_active !== undefined && providedIsActive === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_active tidak valid. Gunakan 0 atau 1.' });
    }
    if (is_open_override !== undefined && providedIsOpenOverride === undefined) {
      return res.status(400).json({ success: false, error: 'Nilai is_open_override tidak valid. Gunakan 0 atau 1.' });
    }

    // P1 RBAC BRANCH SCOPE GUARD: Branch Manager can ONLY update their assigned branch profile
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan untuk memperbarui profil cabang yang ditugaskan.'
        });
      }
      // GLOBAL BRANCH ACTIVATION GUARD: Only Owner / Brand Manager can mutate is_active
      if (is_active !== undefined) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah status aktivasi global cabang.'
        });
      }
    }

    if (targetWa !== null && targetWa !== undefined) {
      const cleanWaDigits = String(targetWa).replace(/[^0-9]/g, '');
      const isIndoMobile = cleanWaDigits.startsWith('08') || cleanWaDigits.startsWith('628') || cleanWaDigits.startsWith('8');
      if (String(targetWa).trim() === '' || !isIndoMobile || cleanWaDigits.length < 9) {
        return res.status(400).json({
          success: false,
          error: 'Format nomor WhatsApp cabang tidak valid. Harap gunakan format nomor ponsel WhatsApp aktif.'
        });
      }
    }

    // P1 TENANT WRITE BOUNDARY GUARD (FINDING 01): Verify branch ownership before ANY mutation
    // B1: full pre-mutation snapshot is captured so every authorized change is auditable (B1.10).
    const existingBranch = db.prepare(`
      SELECT id, name, address_text, latitude, longitude, phone, whatsapp_number, is_active, is_open_override
      FROM branches WHERE id = ? AND brand_id = ?
    `).get(req.params.id, req.brand_id);
    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }
    const existingSettings = db.prepare(`
      SELECT free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount
      FROM branch_delivery_settings WHERE branch_id = ?
    `).get(req.params.id) || {};

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        UPDATE branches 
        SET name = COALESCE(?, name),
            address_text = COALESCE(?, address_text),
            latitude = COALESCE(?, latitude),
            longitude = COALESCE(?, longitude),
            phone = COALESCE(?, phone),
            whatsapp_number = COALESCE(?, whatsapp_number),
            is_active = COALESCE(?, is_active),
            is_open_override = COALESCE(?, is_open_override),
            updated_at = datetime('now')
        WHERE id = ? AND brand_id = ?
      `).run(
        name !== undefined ? name : null,
        address_text !== undefined ? address_text : null,
        latitude !== undefined ? latitude : null,
        longitude !== undefined ? longitude : null,
        targetPhone !== undefined ? targetPhone : null,
        targetWa !== undefined ? targetWa : null,
        providedIsActive,
        providedIsOpenOverride,
        req.params.id,
        req.brand_id
      );

      // Scoped update with explicit tenant subquery guard
      db.prepare(`
        UPDATE branch_delivery_settings
        SET free_delivery_km = COALESCE(?, free_delivery_km),
            price_per_km = COALESCE(?, price_per_km),
            max_radius_km = COALESCE(?, max_radius_km),
            promo_min_order = COALESCE(?, promo_min_order),
            promo_delivery_discount = COALESCE(?, promo_delivery_discount)
        WHERE branch_id = ? AND branch_id IN (
          SELECT id FROM branches WHERE id = ? AND brand_id = ?
        )
      `).run(
        free_delivery_km !== undefined ? free_delivery_km : null,
        price_per_km !== undefined ? price_per_km : null,
        max_radius_km !== undefined ? max_radius_km : null,
        promo_min_order !== undefined ? promo_min_order : null,
        promo_delivery_discount !== undefined ? promo_delivery_discount : null,
        req.params.id,
        req.params.id,
        req.brand_id
      );

      // B1 OPERATIONAL AUDIT TRAIL (B1.10): append-only branch_operation_logs rows for every
      // field actually changed by this AUTHORIZED mutation. Records what changed, which branch,
      // who performed it (actor id + role), and that authorization/scope was satisfied.
      const stringifyScalar = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
      const normNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
      const scalarChanged = (prev, next, isNum) => {
        const p = prev === undefined ? null : prev;
        const n = next === undefined ? null : next;
        if (p === null && n === null) return false;
        if (p === null || n === null) return true;
        if (isNum) return Number(p) !== Number(n);
        return String(p) !== String(n);
      };

      const prevOpen = (existingBranch.is_open_override === null || existingBranch.is_open_override === undefined) ? 1 : existingBranch.is_open_override;
      const tracked = [
        { field: 'name', prev: existingBranch.name, next: name !== undefined ? String(name) : existingBranch.name, isNum: false },
        { field: 'address_text', prev: existingBranch.address_text, next: address_text !== undefined ? String(address_text) : existingBranch.address_text, isNum: false },
        { field: 'latitude', prev: existingBranch.latitude, next: latitude !== undefined ? normNum(latitude) : existingBranch.latitude, isNum: true },
        { field: 'longitude', prev: existingBranch.longitude, next: longitude !== undefined ? normNum(longitude) : existingBranch.longitude, isNum: true },
        { field: 'phone', prev: existingBranch.phone, next: targetPhone !== undefined ? String(targetPhone) : existingBranch.phone, isNum: false },
        { field: 'whatsapp_number', prev: existingBranch.whatsapp_number || null, next: targetWa !== undefined ? String(targetWa) : (existingBranch.whatsapp_number || null), isNum: false },
        { field: 'is_active', prev: existingBranch.is_active, next: providedIsActive !== null ? providedIsActive : existingBranch.is_active, isNum: true },
        { field: 'is_open_override', prev: prevOpen, next: providedIsOpenOverride !== null ? providedIsOpenOverride : prevOpen, isNum: true }
      ];

      const hadSettingsRow = Boolean(db.prepare('SELECT 1 FROM branch_delivery_settings WHERE branch_id = ?').get(req.params.id));
      if (hadSettingsRow) {
        const sPrev = existingSettings;
        tracked.push(
          { field: 'free_delivery_km', prev: sPrev.free_delivery_km, next: free_delivery_km !== undefined ? normNum(free_delivery_km) : sPrev.free_delivery_km, isNum: true },
          { field: 'price_per_km', prev: sPrev.price_per_km, next: price_per_km !== undefined ? normNum(price_per_km) : sPrev.price_per_km, isNum: true },
          { field: 'max_radius_km', prev: sPrev.max_radius_km, next: max_radius_km !== undefined ? normNum(max_radius_km) : sPrev.max_radius_km, isNum: true },
          { field: 'promo_min_order', prev: sPrev.promo_min_order, next: promo_min_order !== undefined ? normNum(promo_min_order) : sPrev.promo_min_order, isNum: true },
          { field: 'promo_delivery_discount', prev: sPrev.promo_delivery_discount, next: promo_delivery_discount !== undefined ? normNum(promo_delivery_discount) : sPrev.promo_delivery_discount, isNum: true }
        );
      }

      const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
      const actorRole = req.user ? (req.user.role || 'system') : 'system';
      for (const t of tracked) {
        if (!scalarChanged(t.prev, t.next, t.isNum)) continue;
        db.prepare(`
          INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
          VALUES (?, ?, ?, ?, 'branch.update', ?, ?, ?, ?, ?, 1)
        `).run(
          'bol_' + crypto.randomUUID(),
          existingBranch.id,
          req.brand_id,
          req.organization_id || null,
          t.field,
          stringifyScalar(t.prev),
          stringifyScalar(t.next),
          actorId,
          actorRole
        );
      }

      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({
      success: true,
      message: 'Pengaturan cabang & ongkir berhasil disimpan.',
      branch: {
        id: existingBranch.id,
        is_active: providedIsActive !== null ? providedIsActive : existingBranch.is_active,
        is_open_override: providedIsOpenOverride !== null ? providedIsOpenOverride : (existingBranch.is_open_override == null ? 1 : existingBranch.is_open_override)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================================
   C1 — PRODUCT → BRANCH ASSIGNMENT BOUNDARY
   Product Master stays brand-owned (products.brand_id). A branch_products row
   is the EXPLICIT assignment of a brand product to a branch of the SAME brand.
   - Assignment (create/list) = Owner / Brand authority.
   - Operational availability toggle (is_available) = Branch Manager within
     their own branch, or Owner / Brand.
   - Assignment NEVER mutates stock: physical stock belongs to the Inventory
     domain and is intentionally not fabricated here (stock stays NULL).
   ========================================================================= */

// C1 List assignments of one branch
router.get('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const assignments = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold,
             p.name AS product_name, p.is_active AS is_master_active
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.params.id);

    res.json({ success: true, branch_id: req.params.id, assignments: assignments || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1 Assign an existing brand product to a branch of the SAME brand (Owner/Brand authority)
router.post('/admin/branches/:id/products', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    // C1.3 Brand consistency: the product master must belong to the SAME brand as the branch.
    // (A product of another brand is not found here → cross-brand assignment is impossible.)
    const product = db.prepare('SELECT id, brand_id, price FROM products WHERE id = ? AND brand_id = ?').get(productId, req.brand_id);
    if (!product) {
      return res.status(400).json({
        success: false,
        error: 'PRODUCT_BRAND_MISMATCH',
        message: 'Produk tidak ditemukan atau bukan milik brand ini; produk hanya dapat dialokasikan ke cabang brand yang sama.'
      });
    }

    // C1.4 Assignment != Inventory: the assignment row is created WITHOUT fabricating stock.
    // stock stays NULL until the Inventory domain records actual branch stock.
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO branch_products (branch_id, product_id, price, stock)
      VALUES (?, ?, ?, NULL)
    `).run(req.params.id, productId, product.price != null ? product.price : null);
    const alreadyAssigned = !stmt || stmt.changes === 0;

    const assignment = db.prepare(`
      SELECT branch_id, product_id, price, stock, is_available, low_stock_threshold
      FROM branch_products WHERE branch_id = ? AND product_id = ?
    `).get(req.params.id, productId);

    res.status(alreadyAssigned ? 200 : 201).json({
      success: true,
      already_assigned: alreadyAssigned,
      assignment
    });
  } catch (err) {
    if (String(err && err.message).includes('CROSS_BRAND_ASSIGNMENT_REJECTED')) {
      return res.status(400).json({
        success: false,
        error: 'CROSS_BRAND_ASSIGNMENT_REJECTED',
        message: 'Produk dan cabang harus berasal dari brand yang sama.'
      });
    }
    console.error('[API Error POST /admin/branches/:id/products]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1 Toggle operational availability (is_available) of an assigned product.
// Branch Manager limited to own branch; Owner/Brand anywhere in their brand.
router.patch('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Strict 0|1 validation of the availability flag.
    const rawAvail = req.body && req.body.is_available;
    let nextAvailability = null;
    if (rawAvail !== undefined && rawAvail !== null) {
      if (rawAvail === true) nextAvailability = 1;
      else if (rawAvail === false) nextAvailability = 0;
      else {
        const n = Number(rawAvail);
        if (n !== 0 && n !== 1) {
          return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
        }
        nextAvailability = n;
      }
    } else if (rawAvail === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available tidak valid. Gunakan 0 atau 1.' });
    }
    if (nextAvailability === null) {
      return res.status(400).json({ success: false, error: 'Nilai is_available wajib diisi (0 atau 1).' });
    }

    // Branch Manager may only toggle their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership + assignment existence with brand-consistent product.
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }
    const assignment = db.prepare(`
      SELECT bp.branch_id, bp.product_id, bp.is_available, p.name AS product_name
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({
        success: false,
        error: 'Produk tidak dialokasikan ke cabang ini.'
      });
    }

    const previousValue = assignment.is_available;
    const stmt = db.prepare(`
      UPDATE branch_products SET is_available = ?, updated_at = datetime('now')
      WHERE branch_id = ? AND product_id = ?
    `).run(nextAvailability, req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alokasi produk tidak ditemukan.' });
    }

    // B1/C1 operational audit trail (append-only).
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.update', 'is_available', ?, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify(previousValue),
      JSON.stringify(nextAvailability),
      req.user.userId || req.user.id || req.user.username || 'system',
      req.user.role || 'system'
    );

    res.json({
      success: true,
      assignment: {
        branch_id: req.params.id,
        product_id: req.params.productId,
        product_name: assignment.product_name,
        is_available: nextAvailability
      }
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =========================================================================
   C2 — BRANCH INVENTORY BOUNDARY
   Physical stock is owned and mutated at the Branch boundary. Mutations go
   through InventoryStockService (atomic guarded UPDATE + immutable
   inventory_movements ledger). Only operational adjustments are exposed
   here: audit_adjustment (+/-) and waste_spoilage (-). Stock intake via
   purchase_in belongs to the Purchase Order flow and sale_deduction belongs
   to order settlement — neither is exposed as a manual operation.
   ========================================================================= */

// C2 Branch inventory list (read-only; branch-scoped for Branch Manager)
router.get('/admin/branches/:id/inventory', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const rows = db.prepare(`
      SELECT bp.product_id, p.name AS product_name, bp.price, bp.stock, bp.is_available, bp.low_stock_threshold
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    res.json({ success: true, branch_id: req.params.id, inventory: rows || [] });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/inventory]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C2 Branch inventory mutation (operational adjustment)
// body: { movement_type: 'audit_adjustment'|'waste_spoilage', quantity: <signed int>, mutation_id?, notes? }
router.patch('/admin/branches/:id/inventory/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    // Branch Manager may only mutate their OWN branch.
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({
          success: false,
          error: 'FORBIDDEN_BRANCH_SCOPE',
          message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
        });
      }
    }

    // Branch ownership (tenant-scoped)
    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const movement_type = req.body && req.body.movement_type;
    const rawQuantity = req.body && req.body.quantity;
    const mutation_id = (req.body && req.body.mutation_id) ? String(req.body.mutation_id).trim() : null;
    const notes = (req.body && req.body.notes) ? String(req.body.notes) : '';

    // Only operational adjustments are exposed; purchase_in / sale_deduction stay owned by
    // their respective flows (PO receipt / order settlement).
    const MANUAL_MOVEMENT_TYPES = ['audit_adjustment', 'waste_spoilage'];
    if (!MANUAL_MOVEMENT_TYPES.includes(movement_type)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_MOVEMENT_TYPE',
        message: 'Jenis mutasi manual hanya mendukung audit_adjustment atau waste_spoilage. Penerimaan PO dan pemotongan pesanan dikelola oleh alurnya masing-masing.'
      });
    }

    // C2.9 Quantity validation (finite integer; never silently coerced)
    const quantity = Number(rawQuantity);
    if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '' ||
        !Number.isFinite(Number(rawQuantity)) || !Number.isInteger(quantity) || quantity === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'Quantity harus berupa bilangan bulat bukan-nol (mis. +5 atau -3).'
      });
    }
    if (movement_type === 'waste_spoilage' && quantity > 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_QUANTITY',
        message: 'waste_spoilage hanya menerima pengurangan stok (quantity negatif).'
      });
    }

    // Assignment + brand consistency must already hold (C1 trigger enforces it at the DB too).
    const assignment = db.prepare(`
      SELECT bp.branch_id
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!assignment) {
      return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
    }

    try {
      const movement = InventoryStockService.recordMovement({
        branch_id: req.params.id,
        product_id: req.params.productId,
        movement_type,
        quantity,
        mutation_id,
        reference_id: null,
        actor_id: req.user.userId || req.user.id || req.user.username || 'system',
        actor_role: req.user.role || 'system',
        notes
      });

      const current = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
      res.json({
        success: true,
        movement,
        stock: current ? current.stock : 0
      });
    } catch (stockErr) {
      const msg = String(stockErr && stockErr.message || '');
      if (msg.includes('Stok tidak boleh negatif')) {
        return res.status(409).json({ success: false, error: 'INSUFFICIENT_STOCK', message: stockErr.message });
      }
      if (msg.includes('tidak terdaftar di cabang')) {
        return res.status(404).json({ success: false, error: 'Produk tidak dialokasikan ke cabang ini.' });
      }
      console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', stockErr);
      res.status(500).json({ success: false, error: stockErr.message });
    }
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/inventory/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 15. Admin Orders List & Analytics Summary
router.get('/admin/orders', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT o.*, b.name as branch_name 
      FROM orders o
      LEFT JOIN branches b ON b.id = o.branch_id
      WHERE o.brand_id = ?
      ORDER BY o.created_at DESC
      LIMIT 50
    `).all(req.brand_id);

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id),
      delivery: db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(ord.id)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/analytics/summary', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE brand_id = ?').get(req.brand_id);
    const totalOmzet = db.prepare('SELECT SUM(grand_total) as sum FROM orders WHERE brand_id = ?').get(req.brand_id);
    const activeProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE brand_id = ? AND is_active = 1').get(req.brand_id);

    res.json({
      success: true,
      summary: {
        total_orders: totalOrders ? totalOrders.count : 0,
        total_omzet: totalOmzet && totalOmzet.sum ? totalOmzet.sum : 0,
        active_products: activeProducts ? activeProducts.count : 5
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 16. Reporting Domain Single-Entrypoint API (Protected with Granular Per-Report RBAC Matrix)
const { ReportingEngine } = require('../../domains/reporting');
router.get('/reports/:report_type', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { report_type } = req.params;
    const { branch_id, start_date, end_date } = req.query;

    // P1 GRANULAR REPORT AUTHORIZATION MATRIX
    // Multi-branch comparison / leaderboard is strictly reserved for Owner & Brand Executive scope
    const REPORT_ALLOWED_ROLES = {
      sales: ['owner', 'brand_manager', 'branch_manager'],
      payment: ['owner', 'brand_manager', 'branch_manager'],
      inventory: ['owner', 'brand_manager', 'branch_manager'],
      pos_shifts: ['owner', 'brand_manager', 'branch_manager'],
      products: ['owner', 'brand_manager', 'branch_manager'],
      branches: ['owner', 'brand_manager'],
      branch_comparison: ['owner', 'brand_manager']
    };

    const allowedRoles = REPORT_ALLOWED_ROLES[report_type];
    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_REPORT_AUTHORITY',
        message: `Role "${req.user.role}" tidak memiliki wewenang untuk mengakses laporan multi-cabang "${report_type}". Laporan ini khusus untuk wewenang Owner / Brand Manager.`
      });
    }

    const report = ReportingEngine.generateReport(report_type, {
      brand_id: req.brand_id,
      branch_id: branch_id || req.query.branchId,
      start_date,
      end_date,
      actor: req.user
    });

    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;

