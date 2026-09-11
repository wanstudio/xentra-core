const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const RoutePersistenceRepository = require('../../core/data/repositories/RoutePersistenceRepository');
const db = new RoutePersistenceRepository();
const BranchMatcher = require('../services/BranchMatcher');
const DeliveryCalculator = require('../services/DeliveryCalculator');
const PaymentService = require('../services/PaymentService');
const OrderStateMachine = require('../services/OrderStateMachine');
const RouteService = require('../services/RouteService');
const { PromotionEngineService } = require('../../domains/promotion');
const { InventoryStockService, InventoryMovementModel } = require('../../domains/inventory');
const CatalogService = require('../../domains/commerce/services/CatalogService');
const PricingPolicyModel = require('../../domains/commerce/models/PricingPolicyModel');
const { XentraConnectorClient, XentraConnectorError } = require('../../core/integration/XentraConnectorClient');

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

// 4. Address Search Suggestion (Nominatim with proximity ranking)
router.get('/location/search', async (req, res) => {
  const q = req.query.q || '';
  const lat = req.query.lat || req.query.latitude;
  const lng = req.query.lng || req.query.longitude;
  const results = await RouteService.searchAddress(q, lat, lng);
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

// Rate Limiter for sensitive endpoints (login, password change, etc.)
const RateLimiter = {
  attempts: new Map(),
  
  check(key, maxAttempts = 5, windowSeconds = 300) {
    const now = Date.now();
    const record = this.attempts.get(key) || { count: 0, firstAttempt: now };
    
    // Reset if window expired
    if (now - record.firstAttempt > windowSeconds * 1000) {
      record.count = 0;
      record.firstAttempt = now;
    }
    
    record.count++;
    this.attempts.set(key, record);
    
    return {
      allowed: record.count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - record.count),
      retryAfter: record.count > maxAttempts ? Math.ceil((record.firstAttempt + windowSeconds * 1000 - now) / 1000) : 0
    };
  },
  
  reset(key) {
    this.attempts.delete(key);
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
router.get(['/catalog/menu', '/home'], async (req, res) => {
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

    if (branchScope) {
      // Branch-scoped catalog: read from Connector (client-owned data).
      // Core must NOT fall back to Core DB for branch catalog data.
      let connectorClient;
      try {
        connectorClient = new XentraConnectorClient();
      } catch (_e) {
        // Connector not configured — fail closed for branch catalog
        return res.status(503).json({ success: false, error: 'branch catalog connector not configured' });
      }

      let connectorResult;
      try {
        connectorResult = await connectorClient.getCatalog(branchScope.id);
      } catch (err) {
        const statusCode = (err.code === 'TIMEOUT_ERROR' || err.code === 'ETIMEDOUT') ? 504 : 502;
        console.error('[Connector] catalog.get failed:', err.code, err.message);
        return res.status(statusCode).json({ success: false, error: 'connector catalog unavailable' });
      }

      // Map connector response to existing Public API response shape.
      // Connector returns flat items with category_id + category_name,
      // plus a categories array with branch category metadata.
      const connectorCategories = connectorResult.categories || [];
      const connectorItems = connectorResult.items || [];

      const categories = connectorCategories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug || String(c.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: c.image_url || '',
        image_url: c.image_url || '',
        products: connectorItems
          .filter((item) => String(item.category_id) === String(c.id))
          .map((p) => ({
            id: p.product_id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            image: p.image_url || '',
            image_url: p.image_url || '',
            price: p.price,
            regular_price: p.price,
            is_available: Boolean(p.is_available),
            stock_estimate: p.stock,
            category_id: p.category_id
          }))
      }));

      const allNormalized = connectorItems.map((p) => ({
        id: p.product_id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        image: p.image_url || '',
        image_url: p.image_url || '',
        price: p.price,
        regular_price: p.price,
        is_available: Boolean(p.is_available),
        stock_estimate: p.stock,
        category_id: p.category_id
      }));

      return res.json({
        success: true,
        categories,
        all_products: allNormalized,
        products: { items: allNormalized },
        promo: {
          enabled: true,
          target: 50000,
          discount: 5000,
          label: 'Selamat, kamu berhasil dapetin diskon Rp 5.000 ketika checkout!'
        }
      });
    }

    // Brand-wide catalog: read from Core DB (unchanged).
    const menu = CatalogService.getMenu({ brand_id: brandId, branch_id: null });

    const categories = menu.categories.map((c) => {
      const img = c.image_url || c.icon_url || c.image || '';
      return {
        ...c,
        image: img,
        image_url: img
      };
    });
    const products = menu.products;

    const tree = categories.map((cat) => {
      const catProducts = products.filter((p) => String(p.category_id) === String(cat.id));
      const catImg = cat.image_url || cat.image || cat.icon_url || '';

      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || String(cat.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: catImg,
        image_url: catImg,
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
      ORDER BY is_primary DESC, updated_at DESC, created_at DESC
    `).all(req.brand_id, customerPhone);

    res.json({ success: true, addresses: addresses || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const { label = 'Rumah', address = '', detail = '', note = '', latitude, longitude, is_primary } = req.body;
    const customerPhone = req.customer.phone;

    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return res.status(400).json({
        success: false,
        error: 'Titik koordinat (latitude & longitude) wajib diisi dengan angka yang valid.'
      });
    }

    if (!address || !String(address).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Alamat lengkap wajib diisi.'
      });
    }

    const addrId = 'addr_' + crypto.randomBytes(6).toString('hex');
    const existingCount = db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_phone = ?').get(req.brand_id, customerPhone);
    
    let isPrimary = 0;
    if (is_primary !== undefined) {
      isPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
    } else {
      isPrimary = (!existingCount || existingCount.cnt === 0) ? 1 : 0;
    }

    // If marked as primary, demote any existing primary addresses for this customer & brand
    if (isPrimary === 1) {
      db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_phone = ?').run(req.brand_id, customerPhone);
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO customer_addresses (
        id, brand_id, customer_phone, label, address, detail, note, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addrId,
      req.brand_id,
      customerPhone,
      (label || 'Rumah').trim(),
      String(address).trim(),
      (detail || '').trim(),
      (note || '').trim(),
      Number(latitude),
      Number(longitude),
      isPrimary,
      now,
      now
    );

    const created = {
      id: addrId,
      brand_id: req.brand_id,
      customer_phone: customerPhone,
      label: (label || 'Rumah').trim(),
      address: String(address).trim(),
      detail: (detail || '').trim(),
      note: (note || '').trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      is_primary: isPrimary,
      created_at: now,
      updated_at: now
    };

    res.status(201).json({ success: true, address: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const existing = db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_phone = ?').get(req.params.id, req.brand_id, customerPhone);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }

    const { label, address, detail, note, latitude, longitude, is_primary } = req.body;

    const newLabel = label !== undefined ? String(label).trim() : existing.label;
    const newAddress = address !== undefined ? String(address).trim() : existing.address;
    const newDetail = detail !== undefined ? String(detail).trim() : existing.detail;
    const newNote = note !== undefined ? String(note).trim() : existing.note;

    if (newAddress === '') {
      return res.status(400).json({ success: false, error: 'Alamat lengkap tidak boleh kosong.' });
    }

    let newLat = existing.latitude;
    let newLng = existing.longitude;
    if (latitude !== undefined) {
      if (latitude == null || isNaN(Number(latitude))) {
        return res.status(400).json({ success: false, error: 'Latitude harus berupa angka valid.' });
      }
      newLat = Number(latitude);
    }
    if (longitude !== undefined) {
      if (longitude == null || isNaN(Number(longitude))) {
        return res.status(400).json({ success: false, error: 'Longitude harus berupa angka valid.' });
      }
      newLng = Number(longitude);
    }

    let newIsPrimary = existing.is_primary;
    if (is_primary !== undefined) {
      newIsPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
      if (newIsPrimary === 1) {
        db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_phone = ? AND id != ?').run(req.brand_id, customerPhone, req.params.id);
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE customer_addresses
      SET label = ?, address = ?, detail = ?, note = ?, latitude = ?, longitude = ?, is_primary = ?, updated_at = ?
      WHERE id = ? AND brand_id = ? AND customer_phone = ?
    `).run(
      newLabel,
      newAddress,
      newDetail,
      newNote,
      newLat,
      newLng,
      newIsPrimary,
      now,
      req.params.id,
      req.brand_id,
      customerPhone
    );

    const updated = {
      id: req.params.id,
      brand_id: req.brand_id,
      customer_phone: customerPhone,
      label: newLabel,
      address: newAddress,
      detail: newDetail,
      note: newNote,
      latitude: newLat,
      longitude: newLng,
      is_primary: newIsPrimary,
      created_at: existing.created_at,
      updated_at: now
    };

    res.json({ success: true, address: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const result = db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_phone = ?').run(req.params.id, req.brand_id, customerPhone);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }
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
      const { DiningTableService } = require('../../domains/pos');
      const reqTableIds = Array.isArray(req.body.table_ids) ? req.body.table_ids : [];
      if (reqTableIds.length === 0 && table_number) {
        // Resolve table_id from table_number if table_ids array not directly sent
        const tblRow = db.prepare('SELECT id FROM branch_tables WHERE branch_id = ? AND (table_number = ? OR label = ?)').get(branch.id, table_number, table_number);
        if (tblRow) reqTableIds.push(tblRow.id);
      }

      if (reqTableIds.length > 0) {
        // Authoritatively check availability
        const availCheck = DiningTableService.validateTablesAvailable(branch.id, reqTableIds);
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

    // 4a. Dine-in Table Hold for Payment Stage (15-minute hold) or Immediate Session for Cash
    if (order_type === 'dine_in' && tableIdsToHold.length > 0) {
      const { DiningTableService } = require('../../domains/pos');
      try {
        if (payment_method === 'midtrans') {
          DiningTableService.holdTablesForPayment({
            branch_id: branch.id,
            table_ids: tableIdsToHold,
            customer_phone: customer.phone,
            hold_reference_id: orderId
          });
        } else if (payment_method === 'cash') {
          DiningTableService.createOrAttachDiningSession({
            branch_id: branch.id,
            table_ids: tableIdsToHold,
            order_id: orderId,
            customer_name: customer.name,
            customer_phone: customer.phone,
            guest_count: guest_count || 1,
            hold_reference_id: null
          });
        }
      } catch (tblHoldErr) {
        console.warn('[Checkout Dine-In Table Hold Warning]:', tblHoldErr.message);
      }
    }

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
    if (this.revokedTokens.has(token)) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  },
  destroySession(token) {
    if (token) {
      this.sessions.delete(token);
      this.revokedTokens.add(token);
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

    // Platform Owner is platform-scoped and cannot access tenant-scoped operations as a merchant user
    if (session.role === 'platform_owner') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_TENANT_ACCESS',
        message: 'Platform Owner adalah akun platform-scoped dan tidak dapat mengakses operasi tenant secara langsung tanpa support context.'
      });
    }

    // P1 TENANT & ORGANIZATION BOUNDARY ENFORCEMENT via Core Identity
    let isTenantAuthorized = session.brandId === req.brand_id;
    if (!isTenantAuthorized && session.role === 'owner') {
      if (req.path === '/auth/merchant/me' || (req.originalUrl && req.originalUrl.includes('/auth/merchant/me')) ||
          req.path === '/auth/handoff/create' || (req.originalUrl && req.originalUrl.includes('/auth/handoff/create'))) {
        // Safe profile & handoff generation: owner operating across their organization
        isTenantAuthorized = true;
      } else if (session.organizationId && req.brand && req.brand.organization_id) {
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
    // Exclude safe identity/verification-UX routes so unverified users can inspect their status, log out, or resend
    const verificationExemptRoutes = ['/auth/merchant/me', '/auth/logout', '/auth/resend-verification'];
    const isExemptRoute = verificationExemptRoutes.includes(req.path);

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

// 6.0 Platform Owner Authentication Endpoint
router.post(['/platform/auth/login', '/api/v1/platform/auth/login'], (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const identifier = (email || username || '').trim();

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: 'Email/username dan password wajib diisi.'
      });
    }

    // Rate limiting: 5 attempts per 5 minutes per identifier/IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const rateLimitKey = `platform_login:${clientIp}:${identifier.toLowerCase()}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak percobaan login platform. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { PlatformBootstrapService } = require('../../core/identity');
    const platformService = new PlatformBootstrapService(db);
    const authResult = platformService.authenticate(identifier, password);

    if (!authResult.success) {
      const statusCode = authResult.error === 'ACCOUNT_DISABLED' ? 403 : 401;
      return res.status(statusCode).json({
        success: false,
        error: authResult.error || 'INVALID_CREDENTIALS',
        message: authResult.message || 'Email atau password salah.'
      });
    }

    // Reset rate limiter on successful authentication
    RateLimiter.reset(rateLimitKey);

    const user = authResult.user;

    // Register active platform session in TokenSessionStore (brand_id is strictly null)
    const { token, expiresAt } = TokenSessionStore.createSession(user, null);

    res.json({
      success: true,
      message: 'Login Platform Owner berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      platform_user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        mfa_status: {
          mfa_enrolled: Boolean(user.mfa_enabled),
          mfa_required: true,
          mfa_ready: true,
          mfa_enforced: false,
          note: 'MFA readiness established. Enforcement is reserved for future implementation.'
        }
      }
    });
  } catch (err) {
    console.error('[Platform Login Error]:', err);
    res.status(500).json({
      success: false,
      error: 'PLATFORM_AUTH_ERROR',
      message: 'Terjadi kesalahan sistem pada autentikasi platform.'
    });
  }
});

// 6.1 Platform Control Plane Endpoints
router.get(['/platform/me', '/api/v1/platform/me'], requirePlatformAuth(), (req, res) => {
  try {
    const userRow = db.prepare(`
      SELECT id, username, email, full_name, role, status, mfa_enabled, mfa_enrolled_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(req.platformUser.id || req.platformUser.userId);

    if (!userRow) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    res.json({
      success: true,
      platform_user: {
        id: userRow.id,
        username: userRow.username,
        email: userRow.email,
        full_name: userRow.full_name,
        role: userRow.role,
        status: userRow.status,
        mfa_status: {
          mfa_enrolled: Boolean(userRow.mfa_enabled),
          mfa_required: true,
          mfa_ready: true,
          mfa_enforced: false, // Explicit: MFA is not claimed to be enforced yet
          note: 'MFA readiness established. Enforcement is reserved for future implementation.'
        },
        created_at: userRow.created_at,
        updated_at: userRow.updated_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// 7.1 Customer Order History (Protected by Customer Auth)
router.get('/customer/orders', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const orders = db.prepare(`
      SELECT o.id, o.order_number, o.status, o.order_type, o.subtotal, o.delivery_fee, o.discount_amount,
             o.grand_total, o.payment_method, o.created_at, b.name as branch_name
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE b.brand_id = ? AND o.customer_phone = ?
      ORDER BY o.created_at DESC
      LIMIT 50
    `).all(req.brand_id, customerPhone);

    const enriched = orders.map(ord => ({
      ...ord,
      items: db.prepare('SELECT id, product_name, quantity, unit_price, item_subtotal FROM order_items WHERE order_id = ?').all(ord.id)
    }));

    res.json({ success: true, orders: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

// 10.0 SaaS Control Plane Business Registration Endpoint
router.post('/auth/register', (req, res) => {
  try {
    const { email, password, full_name, business_name, brand_name, branch_name, phone, address_text } = req.body;

    // Rate limiting: 5 registration attempts per 10 minutes per IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `register:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 600);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan pendaftaran. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { RegistrationService, WorkforceService } = require('../../core/identity');
    const registration = new RegistrationService();
    const result = registration.registerBusiness({
      email,
      password,
      full_name,
      business_name,
      brand_name,
      branch_name,
      phone,
      address_text
    });

    // Create session token for newly registered owner
    const sessionUser = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      full_name: result.user.full_name,
      role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      status: 'active',
      email_verified: false
    };

    const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, result.brand.id);

    // Audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.user.id,
      actor_role: 'owner',
      action: 'BUSINESS_REGISTERED',
      target_user_id: result.user.id,
      target_role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      result: 'success',
      metadata: { email: result.user.email, org_name: result.organization.name }
    });

    res.status(201).json({
      success: true,
      message: 'Pendaftaran bisnis berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: result.user,
      organization: result.organization,
      brand: result.brand,
      branch: result.branch
    });
  } catch (err) {
    const status = err.status || 500;
    const errorMsg = err.message || 'Terjadi kesalahan sistem saat pendaftaran.';
    res.status(status).json({
      success: false,
      code: err.code || 'REGISTRATION_ERROR',
      error: errorMsg
    });
  }
});

// 10.0.1 Email Verification Endpoints (GET /verify-email & POST /auth/verify-email)
const handleEmailVerification = (req, res) => {
  try {
    const rawToken = req.query.token || req.body.token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'TOKEN_REQUIRED',
        error: 'Token verifikasi wajib disertakan.'
      });
    }

    const { EmailVerificationService, WorkforceService } = require('../../core/identity');
    const emailVerification = new EmailVerificationService();
    const result = emailVerification.verifyToken(rawToken);

    // Security event audit logging
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.userId,
      actor_role: result.role || 'owner',
      action: 'EMAIL_VERIFIED',
      target_user_id: result.userId,
      target_role: result.role || 'owner',
      brand_id: result.brandId,
      organization_id: result.organizationId,
      result: 'success',
      metadata: { email: result.email, verified_at: result.verifiedAt }
    });

    res.json({
      success: true,
      message: 'Email berhasil diverifikasi.',
      email: result.email,
      verified_at: result.verifiedAt
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'VERIFICATION_FAILED',
      error: err.message || 'Verifikasi email gagal.'
    });
  }
};

router.get('/verify-email', handleEmailVerification);
router.get('/auth/verify-email', handleEmailVerification);
router.post('/auth/verify-email', handleEmailVerification);

// 10.0.2 Resend Email Verification Endpoint
router.post('/auth/resend-verification', async (req, res) => {
  try {
    let targetEmail = req.body && req.body.email;

    if (!targetEmail) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();
      if (token) {
        const session = TokenSessionStore.getSession(token);
        if (session && session.email) {
          targetEmail = session.email;
        }
      }
    }

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        code: 'EMAIL_REQUIRED',
        error: 'Alamat email wajib disertakan.'
      });
    }

    // Rate limiting: 3 resend attempts per 15 minutes per email/IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const cleanEmail = String(targetEmail).trim().toLowerCase();
    const rateLimitKey = `resend-verify:${cleanEmail}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 3, 900);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak permintaan kirim ulang. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const { EmailVerificationService } = require('../../core/identity');
    const emailVerification = new EmailVerificationService();
    const result = await emailVerification.resendVerificationEmail(cleanEmail);

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'RESEND_FAILED',
      error: err.message || 'Gagal mengirim ulang email verifikasi.'
    });
  }
});

// GET /auth/merchant/me: Authenticated operator/merchant profile
router.get('/auth/merchant/me', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id || req.user.userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.full_name,
      role: req.user.role,
      brand_id: req.user.brandId || req.user.brand_id,
      organization_id: req.user.organizationId || req.user.organization_id,
      branch_id: req.user.branchId || req.user.branch_id,
      email_verified: req.user.email_verified
    }
  });
});

// 10.1 Merchant Auth Endpoints
const handleMerchantLogin = (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi.' });
    }

    // Rate limiting: 5 attempts per 5 minutes per username+brand
    const rateLimitKey = `login:${req.brand_id}:${username}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        success: false, 
        error: 'TOO_MANY_REQUESTS',
        message: `Terlalu banyak percobaan login. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    // Use WorkforceService for authentication (bcrypt + account lockout + status check)
    const { WorkforceService } = require('../../core/identity');
    const workforce = new WorkforceService();
    const authResult = workforce.authenticate(username, password, req.brand_id);

    if (!authResult.success) {
      // Log failed attempt
      workforce.logSecurityEvent({
        action: 'LOGIN_FAILED',
        brand_id: req.brand_id,
        result: 'failure',
        metadata: { username, reason: authResult.error }
      });

      const statusCode = authResult.error === 'ACCOUNT_DISABLED' ? 403 : 
                         authResult.error === 'ACCOUNT_LOCKED' ? 423 : 401;
      return res.status(statusCode).json({ 
        success: false, 
        error: authResult.error === 'INVALID_CREDENTIALS' ? 'Username atau password salah.' : authResult.message 
      });
    }

    const user = authResult.user;

    // B1 BRANCH/BRAND INTEGRITY: branch-scoped operator must reference owned branch
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

    // Reset rate limiter on successful login
    RateLimiter.reset(rateLimitKey);

    // Log successful login
    workforce.logSecurityEvent({
      actor_id: user.id,
      actor_role: user.role,
      action: 'LOGIN_SUCCESS',
      brand_id: req.brand_id,
      result: 'success'
    });

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
        email_verified: user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    });
  } catch (err) {
    console.error('[Merchant Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan sistem saat autentikasi.' });
  }
};

router.post('/auth/merchant/login', handleMerchantLogin);
router.post('/auth/login', handleMerchantLogin);

// 10.2 Google Authentication & Account Linking Endpoints
const GoogleAuthService = require('../services/GoogleAuthService');
const { AuthProviderService } = require('../../core/identity');

// POST /auth/google: Google-First Authentication
router.post('/auth/google', async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Rate limiting: 10 attempts per 5 minutes per Google sub + IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `google-auth:${verifiedClaims.sub}:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 10, 300);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_REQUESTS',
        error: `Terlalu banyak percobaan autentikasi Google. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    // Lookup provider identity strictly by (google, sub)
    const authProviderService = new AuthProviderService();
    const identity = authProviderService.findIdentity('google', verifiedClaims.sub);

    if (!identity) {
      return res.status(404).json({
        success: false,
        code: 'ACCOUNT_NOT_LINKED',
        error: 'Akun Google belum terhubung ke akun Xentra.',
        google: {
          sub: verifiedClaims.sub,
          email: verifiedClaims.email,
          email_verified: verifiedClaims.email_verified
        }
      });
    }

    const user = identity.user;

    // Check account active status
    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        error: 'Akun telah dinonaktifkan. Hubungi administrator.'
      });
    }

    // Tenant / Branch boundary checks
    // If tenant brand is provided on request host/context, verify accessibility
    if (req.brand_id && user.brand_id && user.brand_id !== req.brand_id) {
      // If user is owner, check organization match
      let isAllowed = false;
      if (user.role === 'owner' && user.organization_id && req.brand && req.brand.organization_id) {
        isAllowed = user.organization_id === req.brand.organization_id;
      }
      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_TENANT_ACCESS',
          error: 'Akun Anda tidak memiliki akses ke tenant brand ini.'
        });
      }
    }

    // Branch check if branch-scoped operator
    const effectiveBrandId = req.brand_id || user.brand_id;
    if (user.branch_id && effectiveBrandId) {
      const ownedBranch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(user.branch_id, effectiveBrandId);
      if (!ownedBranch) {
        return res.status(401).json({
          success: false,
          code: 'BRANCH_TENANT_MISMATCH',
          error: 'Akun operator tidak terdaftar pada cabang brand ini.'
        });
      }
    }

    // Register active session using existing TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(user, effectiveBrandId);

    // Reset rate limiter on success
    RateLimiter.reset(rateLimitKey);

    // Log security audit event
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: user.id,
      actor_role: user.role,
      action: 'GOOGLE_LOGIN_SUCCESS',
      brand_id: effectiveBrandId,
      organization_id: user.organization_id,
      branch_id: user.branch_id,
      result: 'success',
      metadata: { sub: verifiedClaims.sub, email: verifiedClaims.email }
    });

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
        email_verified: user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'GOOGLE_AUTH_ERROR',
      error: err.message || 'Terjadi kesalahan saat autentikasi Google.'
    });
  }
});

// POST /auth/google-onboard: Google-First Business Registration & Onboarding
// Used when an unlinked Google account completes onboarding on xentra.cloud
router.post('/auth/google-onboard', async (req, res) => {
  try {
    const { credential, id_token, business_name, brand_name, branch_name, phone, address_text } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    // Rate limiting: 5 onboarding registrations per 10 minutes per IP
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const rateLimitKey = `google-onboard:${clientIp}`;
    const rateCheck = RateLimiter.check(rateLimitKey, 5, 600);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_REQUESTS',
        error: `Terlalu banyak permintaan onboarding. Coba lagi dalam ${rateCheck.retryAfter} detik.`
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Email must be verified by Google
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({
        success: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        error: 'Email akun Google belum diverifikasi oleh Google. Tidak dapat melakukan pendaftaran.'
      });
    }

    const { RegistrationService, WorkforceService } = require('../../core/identity');
    const registration = new RegistrationService();

    const result = registration.registerBusinessWithGoogle({
      googleSub: verifiedClaims.sub,
      email: verifiedClaims.email,
      full_name: verifiedClaims.name,
      picture: verifiedClaims.picture,
      business_name,
      brand_name,
      branch_name,
      phone,
      address_text
    });

    // Create session token for the newly onboarded owner
    const sessionUser = {
      id: result.user.id,
      username: result.user.username,
      email: result.user.email,
      full_name: result.user.full_name,
      role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      status: 'active',
      email_verified: true
    };

    const { token, expiresAt } = TokenSessionStore.createSession(sessionUser, result.brand.id);

    // Reset rate limiter on success
    RateLimiter.reset(rateLimitKey);

    // Security audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: result.user.id,
      actor_role: 'owner',
      action: 'GOOGLE_BUSINESS_ONBOARDED',
      target_user_id: result.user.id,
      target_role: 'owner',
      brand_id: result.brand.id,
      organization_id: result.organization.id,
      branch_id: result.branch.id,
      result: 'success',
      metadata: {
        sub: verifiedClaims.sub,
        email: result.user.email,
        org_name: result.organization.name
      }
    });

    res.status(201).json({
      success: true,
      message: 'Onboarding bisnis dengan Google berhasil.',
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        ...result.user,
        brand_name: result.brand.name
      },
      organization: result.organization,
      brand: result.brand,
      branch: result.branch
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'GOOGLE_ONBOARD_ERROR',
      error: err.message || 'Terjadi kesalahan saat onboarding Google.'
    });
  }
});

// POST /auth/handoff/create: Issue single-use, time-limited cross-domain handoff ticket
router.post('/auth/handoff/create', requireAuth(['owner', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { brand_id } = req.body || {};
    const targetBrandId = brand_id || req.user.brandId || req.brand_id;

    if (!targetBrandId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_BRAND_ID',
        error: 'Target brand_id wajib disertakan untuk pembuatan handoff.'
      });
    }

    const { HandoffService } = require('../../core/identity');
    const handoffService = new HandoffService(db);
    const userId = req.user.userId || req.user.id;

    const result = handoffService.createTicket({
      userId,
      brandId: targetBrandId,
      ttlSeconds: 60 // 60s TTL for secure cross-domain handoff
    });

    res.json({
      success: true,
      handoff_ticket: result.ticket,
      expires_at: result.expires_at,
      redirect_url: result.redirect_url,
      brand_id: result.brand_id,
      custom_domain: result.custom_domain
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'HANDOFF_CREATE_ERROR',
      error: err.message || 'Gagal membuat tiket handoff.'
    });
  }
});

// POST /auth/handoff/exchange: Consume handoff ticket and issue tenant session token
router.post('/auth/handoff/exchange', async (req, res) => {
  try {
    const { handoff_ticket, ticket } = req.body || {};
    const rawTicket = handoff_ticket || ticket;

    if (!rawTicket) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_TICKET',
        error: 'Tiket handoff wajib disertakan.'
      });
    }

    // Must be bound to a tenant domain context
    const targetBrandId = req.brand_id;
    if (!targetBrandId) {
      return res.status(400).json({
        success: false,
        code: 'TENANT_REQUIRED',
        error: 'Penukaran tiket handoff harus dilakukan pada domain tenant brand.'
      });
    }

    const { HandoffService, WorkforceService } = require('../../core/identity');
    const handoffService = new HandoffService(db);

    const consumed = handoffService.consumeTicket({
      ticket: rawTicket,
      targetBrandId
    });

    // Create brand-bound session in TokenSessionStore
    const { token, expiresAt } = TokenSessionStore.createSession(consumed.user, targetBrandId);

    // Audit log
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: consumed.user.id,
      actor_role: consumed.user.role,
      action: 'HANDOFF_SESSION_EXCHANGED',
      brand_id: targetBrandId,
      organization_id: consumed.organizationId,
      branch_id: consumed.user.branch_id,
      result: 'success',
      metadata: { userId: consumed.user.id, targetBrandId }
    });

    res.json({
      success: true,
      token,
      expires_at: new Date(expiresAt).toISOString(),
      user: {
        id: consumed.user.id,
        username: consumed.user.username,
        email: consumed.user.email,
        full_name: consumed.user.full_name,
        role: consumed.user.role,
        branch_id: consumed.user.branch_id || null,
        email_verified: consumed.user.email_verified,
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Merchant Resto'
      }
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'HANDOFF_EXCHANGE_ERROR',
      error: err.message || 'Gagal menukarkan tiket handoff.'
    });
  }
});

// POST /auth/link-google: Explicit Google Account Linking for Authenticated User
router.post('/auth/link-google', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), async (req, res) => {
  try {
    const { credential, id_token } = req.body || {};
    const rawToken = credential || id_token;

    if (!rawToken) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_GOOGLE_CREDENTIAL',
        error: 'Credential token Google wajib dikirim.'
      });
    }

    const googleAuth = new GoogleAuthService();
    const verifiedClaims = await googleAuth.verifyIdToken(rawToken);

    // Explicit security requirement: email_verified must be true
    if (!verifiedClaims.email_verified) {
      return res.status(400).json({
        success: false,
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        error: 'Email akun Google belum diverifikasi oleh Google. Tidak dapat menghubungkan akun.'
      });
    }

    // Invariant: Target user is ALWAYS derived strictly from the authenticated session, never request body!
    const targetUserId = req.user.userId || req.user.id;

    const authProviderService = new AuthProviderService();
    const linkResult = authProviderService.linkProvider({
      userId: targetUserId,
      provider: 'google',
      providerUserId: verifiedClaims.sub,
      email: verifiedClaims.email,
      metadata: {
        name: verifiedClaims.name,
        picture: verifiedClaims.picture
      }
    });

    // Log security audit event
    const workforce = new WorkforceService();
    workforce.logSecurityEvent({
      actor_id: targetUserId,
      actor_role: req.user.role,
      action: 'GOOGLE_ACCOUNT_LINKED',
      target_user_id: targetUserId,
      target_role: req.user.role,
      brand_id: req.user.brandId || req.brand_id,
      organization_id: req.user.organizationId,
      branch_id: req.user.branchId,
      result: 'success',
      metadata: {
        sub: verifiedClaims.sub,
        email: verifiedClaims.email,
        already_linked: linkResult.alreadyLinked
      }
    });

    res.json({
      success: true,
      message: linkResult.alreadyLinked
        ? 'Akun Google ini sudah terhubung ke akun Anda.'
        : 'Akun Google berhasil dihubungkan ke akun Xentra Anda.',
      provider: 'google',
      already_linked: linkResult.alreadyLinked,
      linked_at: new Date().toISOString()
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'LINK_GOOGLE_ERROR',
      error: err.message || 'Gagal menghubungkan akun Google.'
    });
  }
});

// GET /auth/config: Public auth provider client configuration
router.get('/auth/config', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
  res.json({
    success: true,
    google_enabled: Boolean(googleClientId),
    google_client_id: googleClientId || null
  });
});

// ==================== WORKFORCE MANAGEMENT ENDPOINTS ====================
const { WorkforceService } = require('../../core/identity');

// Helper: extract workforce actor context from session
function getWorkforceActor(req) {
  return {
    actor_id: req.user.userId || req.user.id,
    actor_role: req.user.role,
    actor_branch_id: req.user.branchId || req.user.branch_id
  };
}

// List users within authorized scope
router.get('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { role, branch_id, status, limit, offset } = req.query;
    
    // Branch managers can only see users in their branch
    const filters = {};
    if (role) filters.role = role;
    if (status) filters.status = status;
    if (req.user.role === 'branch_manager') {
      filters.branch_id = req.user.branchId || req.user.branch_id;
    } else if (branch_id) {
      filters.branch_id = branch_id;
    }
    if (limit) filters.limit = parseInt(limit);
    if (offset) filters.offset = parseInt(offset);

    const users = workforce.listUsers(req.brand_id, filters);
    res.json({ success: true, users });
  } catch (err) {
    console.error('[Admin Users List Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single user
router.get('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const user = workforce.getUser(req.params.id, req.brand_id);
    
    // Branch managers can only see users in their branch
    if (req.user.role === 'branch_manager' && user.branch_id !== (req.user.branchId || req.user.branch_id)) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
    }

    res.json({ success: true, user });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Create user
router.post('/admin/users', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { username, email, password, full_name, role, branch_id } = req.body;

    // Authorization: determine what role/scope the actor can assign
    let allowedRoles = [];
    let targetBranchId = branch_id;

    if (actor.actor_role === 'owner') {
      allowedRoles = ['brand_manager', 'branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'brand_manager') {
      allowedRoles = ['branch_manager', 'cashier', 'kitchen'];
    } else if (actor.actor_role === 'branch_manager') {
      allowedRoles = ['cashier'];
      targetBranchId = actor.actor_branch_id; // Force to own branch
    }

    if (!allowedRoles.includes(role)) {
      workforce.logSecurityEvent({
        ...actor,
        action: 'USER_CREATED',
        brand_id: req.brand_id,
        result: 'denied',
        metadata: { reason: 'FORBIDDEN_ROLE_CEILING', requested_role: role }
      });
      return res.status(403).json({ 
        success: false, 
        error: 'FORBIDDEN_ROLE_CEILING',
        message: 'Anda tidak memiliki izin untuk membuat akun dengan role ini.' 
      });
    }

    // Validate branch scope
    if (targetBranchId) {
      const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH' });
      }
      
      // Branch manager cannot assign to different branch
      if (actor.actor_role === 'branch_manager' && targetBranchId !== actor.actor_branch_id) {
        workforce.logSecurityEvent({
          ...actor,
          action: 'USER_CREATED',
          brand_id: req.brand_id,
          result: 'denied',
          metadata: { reason: 'FORBIDDEN_SCOPE_ESCALATION', requested_branch: targetBranchId }
        });
        return res.status(403).json({ success: false, error: 'FORBIDDEN_SCOPE_ESCALATION' });
      }
    }

    // Get organization_id from brand
    const brand = db.prepare('SELECT organization_id FROM brands WHERE id = ?').get(req.brand_id);
    
    const newUser = workforce.createUser({
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      username,
      email,
      password,
      full_name,
      role,
      created_by: actor.actor_id
    });

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_CREATED',
      target_user_id: newUser.id,
      target_role: role,
      brand_id: req.brand_id,
      organization_id: brand.organization_id,
      branch_id: targetBranchId,
      result: 'success',
      metadata: { username }
    });

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Update user profile
router.put('/admin/users/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const target = workforce.getUser(req.params.id, req.brand_id);

    // Branch managers can only update Cashier in their branch
    if (actor.actor_role === 'branch_manager') {
      if (target.role !== 'cashier' || target.branch_id !== actor.actor_branch_id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const updated = workforce.updateUser(req.params.id, req.brand_id, req.body, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_UPDATED',
      target_user_id: target.id,
      target_role: target.role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { fields: Object.keys(req.body) }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Disable user
router.post('/admin/users/:id/disable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const disabled = workforce.disableUser(req.params.id, req.brand_id, actor);

    // Invalidate all sessions for the disabled user
    workforce.invalidateUserSessions(req.params.id);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_DISABLED',
      target_user_id: disabled.id,
      target_role: disabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: disabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Enable user
router.post('/admin/users/:id/enable', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const enabled = workforce.enableUser(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'USER_ENABLED',
      target_user_id: enabled.id,
      target_role: enabled.role,
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, user: enabled });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Change user role (Owner only)
router.post('/admin/users/:id/role', requireAuth(['owner']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { role } = req.body;

    const updated = workforce.changeUserRole(req.params.id, req.brand_id, role, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'ROLE_CHANGED',
      target_user_id: updated.id,
      target_role: role,
      brand_id: req.brand_id,
      result: 'success',
      metadata: { previous_role: updated.role }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Change user branch scope
router.post('/admin/users/:id/scope', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);
    const { branch_id } = req.body;

    const updated = workforce.changeUserScope(req.params.id, req.brand_id, branch_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'SCOPE_CHANGED',
      target_user_id: updated.id,
      target_role: updated.role,
      brand_id: req.brand_id,
      branch_id: branch_id,
      result: 'success',
      metadata: { previous_branch_id: updated.branch_id }
    });

    res.json({ success: true, user: updated });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// ==================== PASSWORD MANAGEMENT ====================

// Self password change
router.post('/auth/change-password', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({ success: false, error: 'CURRENT_PASSWORD_REQUIRED' });
    }

    workforce.selfChangePassword(
      req.user.userId || req.user.id,
      req.brand_id,
      current_password,
      new_password,
      confirm_password
    );

    // Invalidate all sessions except current one (force re-login on other devices)
    const currentToken = req.headers['authorization']?.startsWith('Bearer ') 
      ? req.headers['authorization'].substring(7).trim()
      : req.headers['x-auth-token'];
    
    // Revoke all sessions for this user except the current one
    const userId = req.user.userId || req.user.id;
    for (const [token, session] of TokenSessionStore.sessions.entries()) {
      if ((session.userId === userId || session.id === userId) && token !== currentToken) {
        TokenSessionStore.sessions.delete(token);
      }
    }

    workforce.logSecurityEvent({
      actor_id: userId,
      actor_role: req.user.role,
      action: 'PASSWORD_CHANGED',
      brand_id: req.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil diubah.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Admin reset password (generates one-time token)
router.post('/admin/users/:id/reset-password', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const actor = getWorkforceActor(req);

    const result = workforce.adminResetPassword(req.params.id, req.brand_id, actor);

    workforce.logSecurityEvent({
      ...actor,
      action: 'PASSWORD_RESET_REQUESTED',
      target_user_id: req.params.id,
      brand_id: req.brand_id,
      result: 'success'
    });

    // NOTE: The raw reset token is returned ONCE to the administrator
    // who must securely transmit it to the target user.
    // It is NEVER logged or stored in plaintext.
    res.json({ 
      success: true, 
      reset_token: result.reset_token,
      expires_at: result.expires_at,
      message: 'Reset token berhasil dibagikan. Berikan token ini kepada pengguna secara aman.' 
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Complete password reset (using one-time token)
router.post('/auth/reset-password', (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      return res.status(400).json({ success: false, error: 'Token dan password baru wajib diisi.' });
    }

    const result = workforce.completePasswordReset(token, new_password);

    workforce.logSecurityEvent({
      action: 'PASSWORD_RESET_COMPLETED',
      target_user_id: result.user_id,
      brand_id: result.brand_id,
      result: 'success'
    });

    res.json({ success: true, message: 'Password berhasil direset. Silakan login dengan password baru.' });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
});

// Logout
router.post('/auth/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : (req.headers['x-auth-token'] || '').trim();

    if (token) {
      const session = TokenSessionStore.getSession(token);
      if (session) {
        const workforce = new WorkforceService();
        workforce.logSecurityEvent({
          actor_id: session.userId || session.id,
          actor_role: session.role,
          action: 'LOGOUT',
          brand_id: req.brand_id,
          result: 'success'
        });
      }
      TokenSessionStore.destroySession(token);
    }

    res.json({ success: true, message: 'Berhasil logout.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Security audit log (Owner/Brand Manager only)
router.get('/admin/security-audit', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const workforce = new WorkforceService();
    const { action, actor_id, target_user_id, limit, offset } = req.query;

    const logs = workforce.getSecurityAuditLog(req.brand_id, {
      action,
      actor_id,
      target_user_id,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== END WORKFORCE MANAGEMENT ====================

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
      email_verified: req.user.email_verified !== undefined ? req.user.email_verified : true,
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
    const { name, category_id, price, regular_price, description, image, pricing_mode, min_price, max_price } = req.body;
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
      INSERT INTO products (id, brand_id, category_id, name, slug, description, price, regular_price, pricing_mode, min_price, max_price, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM products WHERE brand_id = ?))
    `).run(
      id,
      req.brand_id,
      category_id !== undefined ? category_id : null,
      name,
      slug,
      description !== undefined ? description : '',
      Number(price),
      regular_price ? Number(regular_price) : Number(price),
      pricing_mode || 'lock',
      min_price !== undefined ? Number(min_price) : null,
      max_price !== undefined ? Number(max_price) : null,
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
    const { name, category_id, price, regular_price, description, image, is_active, pricing_mode, min_price, max_price } = req.body;

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
          regular_price = COALESCE(?, regular_price),
          pricing_mode = COALESCE(?, pricing_mode),
          min_price = COALESCE(?, min_price),
          max_price = COALESCE(?, max_price),
          description = COALESCE(?, description),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      category_id !== undefined ? category_id : null,
      price !== undefined ? price : null,
      regular_price !== undefined ? regular_price : null,
      pricing_mode !== undefined ? pricing_mode : null,
      min_price !== undefined ? min_price : null,
      max_price !== undefined ? max_price : null,
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
      // DELIVERY SETTINGS GUARD: Branch Manager cannot change delivery fee policy (ongkir formula)
      const deliveryFields = [free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount];
      const deliveryFieldNames = ['free_delivery_km', 'price_per_km', 'max_radius_km', 'promo_min_order', 'promo_delivery_discount'];
      const hasDeliveryChange = deliveryFields.some((v, i) => v !== undefined && v !== null && String(v) !== String(Object.values(existingSettings)[i] ?? ''));
      if (hasDeliveryChange) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Hanya Pemilik Toko (Owner) atau Brand Manager yang berwenang mengubah pengaturan ongkir dan promosi pengiriman.'
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

router.delete('/admin/branches/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const existing = db.prepare('SELECT id, name FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cabang tidak ditemukan pada brand ini.'
      });
    }

    // B1 FINANCIAL INTEGRITY: soft-delete only — branch with order history
    // is deactivated (is_active=0) but the row stays for FK anchor.
    db.prepare("UPDATE branches SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND brand_id = ?")
      .run(req.params.id, req.brand_id);

    res.json({
      success: true,
      message: 'Cabang berhasil dinonaktifkan.',
      branch_id: req.params.id
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

// C1.5 Comprehensive Branch Catalog View (Adopted & Available Master Products)
router.get('/admin/branches/:id/catalog', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const branch = db.prepare('SELECT id, name, slug, address_text, is_active FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const branchCategories = db.prepare(`
      SELECT id, brand_id, branch_id, name, slug, image_url, sort_order
      FROM branch_categories
      WHERE branch_id = ? AND brand_id = ?
      ORDER BY sort_order ASC, name ASC
    `).all(req.params.id, req.brand_id);

    const adoptedProducts = db.prepare(`
      SELECT 
        bp.product_id,
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override,
        bp.description_override,
        bp.image_override,
        p.name as master_name,
        p.description as master_description,
        p.image_url as master_image_url,
        bp.branch_category_id,
        bc.name as branch_category_name,
        bp.price,
        p.price as master_price,
        p.pricing_mode,
        p.min_price,
        p.max_price,
        bp.stock,
        bp.is_available
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ?
      ORDER BY p.sort_order ASC, p.name ASC
    `).all(req.brand_id, req.params.id);

    const adoptedIds = adoptedProducts.map(ap => ap.product_id);
    const placeholders = adoptedIds.length > 0 ? adoptedIds.map(() => '?').join(',') : null;
    const masterQuery = placeholders
      ? `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? AND id NOT IN (${placeholders}) ORDER BY sort_order ASC, name ASC`
      : `SELECT id, category_id, name, slug, description, price, regular_price, image_url, is_active, pricing_mode, min_price, max_price
         FROM products WHERE brand_id = ? ORDER BY sort_order ASC, name ASC`;
    const masterParams = placeholders ? [req.brand_id, ...adoptedIds] : [req.brand_id];
    const availableMasterProducts = db.prepare(masterQuery).all(...masterParams);

    res.json({
      success: true,
      branch,
      categories: branchCategories,
      adopted_products: adoptedProducts,
      available_master_products: availableMasterProducts
    });
  } catch (err) {
    console.error('[API Error GET /admin/branches/:id/catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.6 Adopt / Add Product to Branch Catalog with Pricing Policy enforcement
router.post('/admin/branches/:id/adopt', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const productId = String((req.body && req.body.product_id) || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'product_id wajib diisi.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const product = db.prepare(`
      SELECT id, brand_id, category_id, name, description, image_url, price, pricing_mode, min_price, max_price
      FROM products WHERE id = ? AND brand_id = ?
    `).get(productId, req.brand_id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produk master tidak ditemukan pada brand ini.' });
    }

    // Resolve price according to locked PricingPolicyModel:
    // If pricing_mode is 'lock', branch CANNOT override price (enforces master price)
    const mode = (product.pricing_mode || 'lock').toLowerCase();
    const rawPriceInput = mode === 'lock'
      ? null
      : (req.body.price !== undefined && req.body.price !== null && req.body.price !== '' ? Number(req.body.price) : null);

    let resolved;
    try {
      resolved = PricingPolicyModel.resolvePrice(
        {
          price: product.price,
          pricing_mode: product.pricing_mode || 'lock',
          min_price: product.min_price,
          max_price: product.max_price
        },
        rawPriceInput
      );
    } catch (pricingErr) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_BRANCH_PRICE',
        message: pricingErr.message
      });
    }

    // Branch Category handling:
    let branchCategoryId = req.body.branch_category_id ? String(req.body.branch_category_id).trim() : null;
    if (branchCategoryId) {
      const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ?').get(branchCategoryId, req.params.id);
      if (!validCat) branchCategoryId = null;
    }

    // If no branch category specified, resolve or auto-create branch category from master category name
    if (!branchCategoryId) {
      const masterCat = product.category_id ? db.prepare('SELECT name, slug FROM categories WHERE id = ?').get(product.category_id) : null;
      const catName = masterCat?.name || 'Menu Utama';
      const catSlug = masterCat?.slug || 'menu-utama';

      let existingBranchCat = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND name = ?').get(req.params.id, catName);
      if (!existingBranchCat) {
        const newBcId = 'bc_' + crypto.randomUUID();
        db.prepare(`
          INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
          VALUES (?, ?, ?, ?, ?, 99)
        `).run(newBcId, req.brand_id, req.params.id, catName, catSlug);
        branchCategoryId = newBcId;
      } else {
        branchCategoryId = existingBranchCat.id;
      }
    }

    // Insert or adopt branch_products (override columns start NULL = inherit master).
    // Override columns (name_override, description_override, image_override) are NOT populated
    // here; they remain NULL so the branch inherits live Master Product values at query time.
    // Use PATCH /admin/branches/:id/products/:productId/override to set branch-specific overrides.
    db.prepare(`
      INSERT INTO branch_products (
        branch_id, product_id, branch_category_id, price, is_available, stock
      ) VALUES (?, ?, ?, ?, 1, 100)
      ON CONFLICT(branch_id, product_id) DO UPDATE SET
        branch_category_id = excluded.branch_category_id,
        price = excluded.price,
        is_available = 1,
        updated_at = datetime('now')
    `).run(
      req.params.id,
      product.id,
      branchCategoryId,
      resolved.effective_price
    );

    // Audit trail
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.adopt', 'product_id', NULL, ?, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      product.id,
      JSON.stringify({ product_id: product.id, price: resolved.effective_price, branch_category_id: branchCategoryId }),
      actorId,
      actorRole
    );

    res.status(201).json({
      success: true,
      message: 'Produk berhasil diadopsi ke katalog cabang.',
      adopted: {
        branch_id: req.params.id,
        product_id: product.id,
        price: resolved.effective_price,
        branch_category_id: branchCategoryId
      }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/adopt]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.7 Remove (Un-adopt) Product from Branch Catalog
router.delete('/admin/branches/:id/products/:productId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const stmt = db.prepare('DELETE FROM branch_products WHERE branch_id = ? AND product_id = ?').run(req.params.id, req.params.productId);
    if (!stmt || stmt.changes === 0) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Audit log
    const actorId = req.user ? (req.user.userId || req.user.id || req.user.username || 'system') : 'system';
    const actorRole = req.user ? (req.user.role || 'system') : 'system';
    db.prepare(`
      INSERT INTO branch_operation_logs (id, branch_id, brand_id, organization_id, product_id, action, field, previous_value, new_value, actor_id, actor_role, authorized)
      VALUES (?, ?, ?, ?, ?, 'branch_product.remove', 'product_id', ?, NULL, ?, ?, 1)
    `).run(
      'bol_' + crypto.randomUUID(),
      req.params.id,
      req.brand_id,
      req.organization_id || null,
      req.params.productId,
      JSON.stringify({ product_id: req.params.productId }),
      actorId,
      actorRole
    );

    res.json({
      success: true,
      message: 'Produk berhasil dihapus dari katalog cabang.'
    });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/products/:productId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.9 Sync Branch Catalog to Connector — pushes branch catalog data from Core DB to the
// enterprise connector's client DB. Idempotent, safe to run repeatedly.
router.post('/admin/branches/:id/sync-catalog', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const branchId = req.params.id;
    const brandId = req.brand_id;

    const branch = db.prepare('SELECT id, brand_id, name FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Branch not found' });
    }

    let connectorClient;
    try {
      connectorClient = new XentraConnectorClient();
    } catch (_e) {
      return res.status(503).json({ success: false, error: 'Connector not configured' });
    }

    const branchCategories = db.prepare(
      'SELECT id, brand_id, branch_id, name, image_url, sort_order FROM branch_categories WHERE branch_id = ?'
    ).all(branchId);

    const branchProducts = db.prepare(
      'SELECT branch_id, product_id, branch_category_id, name_override, description_override, image_override, price, stock, is_available, low_stock_threshold, created_at FROM branch_products WHERE branch_id = ?'
    ).all(branchId);

    if (branchProducts.length === 0) {
      return res.status(400).json({ success: false, error: 'Branch has no products to sync' });
    }

    const productIds = branchProducts.map((bp) => bp.product_id);
    const placeholders = productIds.map(() => '?').join(',');
    const masterProducts = db.prepare(
      `SELECT id, brand_id, name, slug, description, image_url, category_id FROM products WHERE brand_id = ? AND id IN (${placeholders})`
    ).all(brandId, ...productIds);

    if (masterProducts.length !== branchProducts.length) {
      return res.status(409).json({ success: false, error: 'Branch catalog contains products outside this brand' });
    }

    const mutationId = `catalog_sync_${branchId}_${Date.now()}`;

    const result = await connectorClient.syncBranchCatalog({
      mutation_id: mutationId,
      brand_id: brandId,
      branch_id: branchId,
      categories: branchCategories.map((c) => ({
        id: c.id,
        name: c.name,
        image_url: c.image_url || null,
        sort_order: c.sort_order || 0,
      })),
      products: masterProducts.map((p) => {
        const bp = branchProducts.find((b) => b.product_id === p.id);
        return {
          id: p.id,
          name: p.name,
          slug: p.slug || '',
          description: p.description || '',
          image_url: p.image_url || null,
          category_id: p.category_id || null,
          branch_category_id: bp.branch_category_id || null,
          name_override: bp.name_override || null,
          description_override: bp.description_override || null,
          image_override: bp.image_override || null,
          price: bp.price,
          stock: bp.stock,
          is_available: Boolean(bp.is_available),
          low_stock_threshold: bp.low_stock_threshold,
          created_at: bp.created_at || new Date().toISOString(),
        };
      }),
    });

    res.json({
      success: true,
      branch_id: branchId,
      categories_synced: result.result.categories_upserted,
      products_synced: result.result.products_upserted,
      branch_products_synced: result.result.branch_products_upserted,
      replay: Boolean(result.replay),
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/sync-catalog]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8-OVR Branch Product Override — set or clear per-field content overrides
// plus pricing policy (price) and category assignment (branch_category_id).
// NULL body field = clear override (branch falls back to live Master Product value).
// Non-null body field = branch override wins at query time via COALESCE in CatalogService.
router.patch('/admin/branches/:id/products/:productId/override', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const bp = db.prepare(`
      SELECT bp.branch_id, bp.branch_category_id, bp.price,
             p.price as master_price, p.pricing_mode, p.min_price, p.max_price
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id AND p.brand_id = ?
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.brand_id, req.params.id, req.params.productId);
    if (!bp) {
      return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });
    }

    // Only fields explicitly present in the request body are updated.
    // Pass null to clear an override; omit the key entirely to leave it untouched.
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
      updates.name_override = req.body.name != null ? String(req.body.name).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      updates.description_override = req.body.description != null ? String(req.body.description).trim() || null : null;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'image_url')) {
      updates.image_override = req.body.image_url != null ? String(req.body.image_url).trim() || null : null;
    }

    // price — enforced by the same locked PricingPolicyModel used at adopt time:
    //   lock  → branch CANNOT change price (custom price rejected, master wins)
    //   range → branch price must sit inside [min_price, max_price]
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')) {
      const rawPrice = req.body.price;
      const mode = (bp.pricing_mode || 'lock').toLowerCase();

      const branchPrice = (rawPrice === null || rawPrice === '' || rawPrice === undefined)
        ? bp.master_price
        : Number(rawPrice);
      if (!Number.isFinite(branchPrice) || branchPrice < 0) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: 'Harga cabang harus berupa angka positif.' });
      }
      if (mode === 'lock' && branchPrice !== bp.master_price) {
        return res.status(403).json({
          success: false,
          error: 'PRICE_LOCKED',
          message: 'Harga cabang dikunci owner. Tidak dapat diubah oleh cabang.'
        });
      }
      try {
        const resolved = PricingPolicyModel.resolvePrice(
          {
            price: bp.master_price,
            pricing_mode: mode,
            min_price: bp.min_price,
            max_price: bp.max_price
          },
          branchPrice
        );
        updates.price = resolved.effective_price;
      } catch (pricingErr) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_PRICE', message: pricingErr.message });
      }
    }

    // branch_category_id — move the adopted product to another Branch-owned
    // category. Empty/null clears the assignment; the value must belong to THIS
    // branch (authoritative validation, never trust a cross-branch id).
    if (Object.prototype.hasOwnProperty.call(req.body, 'branch_category_id')) {
      const rawCat = req.body.branch_category_id;
      if (rawCat === null || rawCat === '' || rawCat === undefined) {
        updates.branch_category_id = null;
      } else {
        const catId = String(rawCat).trim();
        const validCat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
          .get(catId, req.params.id, req.brand_id);
        if (!validCat) {
          return res.status(400).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Kategori cabang tidak valid untuk cabang ini.'
          });
        }
        updates.branch_category_id = catId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada field override yang disediakan (name, description, image_url, price, branch_category_id).' });
    }

    const setParts = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id, req.params.productId];
    db.prepare(`UPDATE branch_products SET ${setParts}, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?`).run(...values);

    // Read back the resolved state for the response
    const resolved = db.prepare(`
      SELECT
        COALESCE(bp.name_override, p.name) as name,
        COALESCE(bp.description_override, p.description) as description,
        COALESCE(bp.image_override, p.image_url) as image_url,
        bp.name_override, bp.description_override, bp.image_override,
        p.name as master_name, p.description as master_description, p.image_url as master_image_url,
        bp.price, p.price as master_price, p.pricing_mode, p.min_price, p.max_price,
        bp.branch_category_id, bc.name as branch_category_name,
        bp.is_available, bp.stock
      FROM branch_products bp
      JOIN products p ON p.id = bp.product_id
      LEFT JOIN branch_categories bc ON bc.id = bp.branch_category_id
      WHERE bp.branch_id = ? AND bp.product_id = ?
    `).get(req.params.id, req.params.productId);

    res.json({
      success: true,
      message: 'Override produk berhasil disimpan.',
      override: resolved
    });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/products/:productId/override]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// C1.8 Create Branch-owned Category
router.post('/admin/branches/:id/categories', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Nama kategori cabang wajib diisi.' });
    }
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan pada brand ini.' });
    }

    const bcId = 'bc_' + crypto.randomUUID();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sortOrder = req.body.sort_order ? Number(req.body.sort_order) : 99;

    db.prepare(`
      INSERT INTO branch_categories (id, brand_id, branch_id, name, slug, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bcId, req.brand_id, req.params.id, name, slug, sortOrder);

    res.status(201).json({
      success: true,
      category: { id: bcId, name, slug, sort_order: sortOrder }
    });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rename a branch category
router.patch('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi.' });
    if (name.length > 40) {
      return res.status(400).json({ success: false, error: 'Nama kategori maksimal 40 karakter.' });
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      db.prepare("UPDATE branch_categories SET name = ?, slug = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, slug, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET name = ?, slug = ? WHERE id = ?")
          .run(name, slug, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, name, slug } });
  } catch (err) {
    console.error('[API Error PATCH /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace a branch category's image.
// Follows the same storage pattern already used across Xentra for menu photos:
// the file is persisted to disk under the app's static /assets tree and only the
// resulting persistent URL is written to the database — never a base64 blob.
// The size limit and MIME map are shared by the category and menu image upload
// endpoints so both accept exactly the same files.
const IMAGE_MAX_BYTES = 3 * 1024 * 1024; // 3MB
const IMAGE_MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};
const CATEGORY_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/categories');
const PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/products');
const BRANCH_PRODUCT_IMAGE_DIR = path.join(__dirname, '../../apps/customer-pwa/assets/uploads/branch-products');

router.post('/admin/branches/:id/categories/:catId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar kategori wajib diunggah.' });
    }

    const ext = IMAGE_MIME_TO_EXT[String(mime_type || '').toLowerCase()];
    if (!ext) {
      return res.status(400).json({ success: false, error: 'Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.' });
    }

    // Strip an optional data URL prefix (e.g. "data:image/png;base64,...") before decoding.
    const rawBase64 = image_base64.includes(',') ? image_base64.split(',').pop() : image_base64;
    let buffer;
    try {
      buffer = Buffer.from(rawBase64, 'base64');
    } catch (decodeErr) {
      return res.status(400).json({ success: false, error: 'Gambar tidak dapat diproses (data tidak valid).' });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Gambar kosong atau rusak.' });
    }
    if (buffer.length > IMAGE_MAX_BYTES) {
      return res.status(400).json({ success: false, error: 'Ukuran gambar melebihi batas maksimal 3MB.' });
    }

    fs.mkdirSync(CATEGORY_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.catId}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(CATEGORY_IMAGE_DIR, fileName), buffer);

    const imageUrl = `/assets/uploads/categories/${fileName}`;
    try {
      db.prepare("UPDATE branch_categories SET image_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(imageUrl, req.params.catId);
    } catch (e) {
      if (String(e).includes('no such column')) {
        db.prepare("UPDATE branch_categories SET image_url = ? WHERE id = ?")
          .run(imageUrl, req.params.catId);
      } else {
        throw e;
      }
    }

    res.json({ success: true, category: { id: req.params.catId, image_url: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/categories/:catId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace a master product (menu item) image.
// Mirrors the branch-category image upload contract above: base64 + mime_type in
// JSON, the same allowed formats/size, the file persisted to disk, and only the
// resulting URL stored in the database. Writes BOTH products.image_url (consumed
// by the customer PWA and public APIs) and products.image (consumed by the
// owner/branch dashboard tables and the Edit Menu modal).
router.post('/admin/products/:productId/image', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?')
      .get(req.params.productId, req.brand_id);
    if (!product) return res.status(404).json({ success: false, error: 'Menu produk tidak ditemukan.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const ext = IMAGE_MIME_TO_EXT[String(mime_type || '').toLowerCase()];
    if (!ext) {
      return res.status(400).json({ success: false, error: 'Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.' });
    }

    // Strip an optional data URL prefix (e.g. "data:image/png;base64,...") before decoding.
    const rawBase64 = image_base64.includes(',') ? image_base64.split(',').pop() : image_base64;
    let buffer;
    try {
      buffer = Buffer.from(rawBase64, 'base64');
    } catch (decodeErr) {
      return res.status(400).json({ success: false, error: 'Gambar tidak dapat diproses (data tidak valid).' });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Gambar kosong atau rusak.' });
    }
    if (buffer.length > IMAGE_MAX_BYTES) {
      return res.status(400).json({ success: false, error: 'Ukuran gambar melebihi batas maksimal 3MB.' });
    }

    fs.mkdirSync(PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.productId}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(PRODUCT_IMAGE_DIR, fileName), buffer);

    const imageUrl = `/assets/uploads/products/${fileName}`;
    db.prepare("UPDATE products SET image_url = ?, image = ?, updated_at = datetime('now') WHERE id = ?")
      .run(imageUrl, imageUrl, req.params.productId);

    res.json({ success: true, product: { id: req.params.productId, image_url: imageUrl, image: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload / replace an adopted (branch) product's own photo override.
// Mirrors the branch-category and master-product image upload contract so the
// branch UI uses the same base64 + mime_type flow and the same 3MB limit.
// The override image is stored per branch (never touches the master product),
// persisted to disk, and only the resulting URL is written to
// branch_products.image_override (COALESCE pick-up in CatalogService).
router.post('/admin/branches/:id/products/:productId/image', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    const bp = db.prepare('SELECT branch_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(req.params.id, req.params.productId);
    if (!bp) return res.status(404).json({ success: false, error: 'Produk tidak ditemukan di katalog cabang ini.' });

    const { image_base64, mime_type } = req.body || {};
    if (!image_base64 || typeof image_base64 !== 'string') {
      return res.status(400).json({ success: false, error: 'Gambar menu wajib diunggah.' });
    }

    const ext = IMAGE_MIME_TO_EXT[String(mime_type || '').toLowerCase()];
    if (!ext) {
      return res.status(400).json({ success: false, error: 'Format gambar tidak didukung. Gunakan JPG, PNG, atau WEBP.' });
    }

    const rawBase64 = image_base64.includes(',') ? image_base64.split(',').pop() : image_base64;
    let buffer;
    try {
      buffer = Buffer.from(rawBase64, 'base64');
    } catch (decodeErr) {
      return res.status(400).json({ success: false, error: 'Gambar tidak dapat diproses (data tidak valid).' });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ success: false, error: 'Gambar kosong atau rusak.' });
    }
    if (buffer.length > IMAGE_MAX_BYTES) {
      return res.status(400).json({ success: false, error: 'Ukuran gambar melebihi batas maksimal 3MB.' });
    }

    fs.mkdirSync(BRANCH_PRODUCT_IMAGE_DIR, { recursive: true });
    const fileName = `${req.params.id}-${req.params.productId}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(BRANCH_PRODUCT_IMAGE_DIR, fileName), buffer);

    const imageUrl = `/assets/uploads/branch-products/${fileName}`;
    db.prepare("UPDATE branch_products SET image_override = ?, updated_at = datetime('now') WHERE branch_id = ? AND product_id = ?")
      .run(imageUrl, req.params.id, req.params.productId);

    res.json({ success: true, product: { branch_id: req.params.id, product_id: req.params.productId, image_url: imageUrl, image_override: imageUrl } });
  } catch (err) {
    console.error('[API Error POST /admin/branches/:id/products/:productId/image]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a branch category (products in it remain, just lose category assignment)
router.delete('/admin/branches/:id/categories/:catId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const cat = db.prepare('SELECT id FROM branch_categories WHERE id = ? AND branch_id = ? AND brand_id = ?')
      .get(req.params.catId, req.params.id, req.brand_id);
    if (!cat) return res.status(404).json({ success: false, error: 'Kategori cabang tidak ditemukan.' });

    // Unassign products, delete the category, then re-pack the remaining categories'
    // sort_order into a contiguous 1..N sequence — all inside one atomic transaction
    // so Home never observes a gap (e.g. 1, 4, 7) or a half-applied delete.
    const remaining = db.prepare(
      'SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ? AND id != ? ORDER BY sort_order ASC, name ASC'
    ).all(req.params.id, req.brand_id, req.params.catId);

    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE branch_products SET branch_category_id = NULL WHERE branch_category_id = ? AND branch_id = ?')
        .run(req.params.catId, req.params.id);
      db.prepare('DELETE FROM branch_categories WHERE id = ?').run(req.params.catId);
      remaining.forEach((c, idx) => updateSort.run(idx + 1, c.id));
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error DELETE /admin/branches/:id/categories/:catId]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reorder branch categories — accepts ordered array of category IDs, updates sort_order atomically
router.put('/admin/branches/:id/categories/reorder', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    if (req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && assignedBranchId !== req.params.id) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      }
    }

    const { order } = req.body; // array of category IDs in desired display order
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, error: 'Payload "order" harus berupa array ID kategori.' });
    }

    // Reject duplicate IDs in the payload — a duplicate would make ordering ambiguous
    // and would silently clobber another category's sort_order.
    const uniqueIds = new Set(order.map(String));
    if (uniqueIds.size !== order.length) {
      return res.status(400).json({ success: false, error: 'Payload "order" mengandung ID kategori duplikat.' });
    }

    const branch = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(req.params.id, req.brand_id);
    if (!branch) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan.' });

    // AUTHORITATIVE VALIDATION: every ID in the payload must actually belong to THIS
    // branch (and brand). Reject the whole request up front — never let one branch's
    // reorder touch another branch's categories, and never trust client-sent order
    // for IDs we haven't verified ownership of.
    const owned = db.prepare('SELECT id FROM branch_categories WHERE branch_id = ? AND brand_id = ?')
      .all(req.params.id, req.brand_id);
    const ownedIds = new Set(owned.map((c) => String(c.id)));
    const invalidIds = order.filter((catId) => !ownedIds.has(String(catId)));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Sebagian ID kategori tidak valid atau bukan milik cabang ini.'
      });
    }

    // Categories that exist for this branch but were NOT included in the payload keep
    // their relative order and are placed deterministically after the reordered set,
    // so no category is ever left with an undefined/garbage sort_order.
    const orderedIdStrings = order.map(String);
    const untouched = owned
      .map((c) => String(c.id))
      .filter((id) => !uniqueIds.has(id));
    const finalOrder = [...orderedIdStrings, ...untouched];

    // Update every category's sort_order inside a single atomic transaction — if
    // anything throws mid-way, the whole transaction rolls back and the previous
    // ordering stays fully intact.
    const updateSort = db.prepare('UPDATE branch_categories SET sort_order = ? WHERE id = ? AND branch_id = ? AND brand_id = ?');

    db.exec('BEGIN IMMEDIATE;');
    try {
      finalOrder.forEach((catId, idx) => {
        updateSort.run(idx + 1, catId, req.params.id, req.brand_id);
      });
      db.exec('COMMIT;');
    } catch (txErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw txErr;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API Error PUT /admin/branches/:id/categories/reorder]:', err);
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

// =========================================================================
// DINE-IN TABLE FLOOR PLAN & OPERATIONAL DOMAIN APIS
// =========================================================================
const { DiningTableService, TableRecommendationService } = require('../../domains/pos');

// Customer / Public: Get Branch Floor Plan & Operational Table State
router.get('/dine-in/layout', (req, res) => {
  try {
    let branchId = req.query.branch_id || (req.query.branchId ? req.query.branchId : null);
    if (!branchId && req.brand_id) {
      const defaultBranch = db.prepare('SELECT id FROM branches WHERE brand_id = ? AND is_active = 1 ORDER BY is_delivery_active DESC, created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branchId = defaultBranch.id;
    }

    if (!branchId) {
      return res.status(400).json({ success: false, error: 'branch_id parameter wajib disertakan.' });
    }

    const layout = DiningTableService.getBranchLayout(branchId);
    res.json({ success: true, layout });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Recommend Table(s) based on Guest Count & Spatial Proximity
router.post('/dine-in/recommend-tables', (req, res) => {
  try {
    let { branch_id, guest_count } = req.body || {};
    if (!branch_id && req.brand_id) {
      const defaultBranch = db.prepare('SELECT id FROM branches WHERE brand_id = ? AND is_active = 1 ORDER BY is_delivery_active DESC, created_at ASC LIMIT 1').get(req.brand_id);
      if (defaultBranch) branch_id = defaultBranch.id;
    }

    if (!branch_id) {
      return res.status(400).json({ success: false, error: 'branch_id wajib diisi.' });
    }

    const layout = DiningTableService.getBranchLayout(branch_id);
    const recommendation = TableRecommendationService.recommendTables({
      tables: layout.tables,
      guest_count: Number(guest_count) || 1
    });

    res.json({ success: true, recommendation });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Customer: Resolve Branch & Table from scanned QR token
router.get('/dine-in/qr/:token', (req, res) => {
  try {
    const resolved = DiningTableService.resolveFromQr(req.params.token);
    if (!resolved) {
      return res.status(404).json({ success: false, error: 'QR Meja tidak valid atau telah dicabut.' });
    }
    res.json({ success: true, table: resolved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / Owner: Regenerate QR Token for a table
router.post('/dine-in/tables/:id/regenerate-qr', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const result = DiningTableService.regenerateQrToken(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Block or Unblock a table
router.post('/dine-in/tables/:id/block', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const { is_blocked, reason } = req.body;
    const result = DiningTableService.setTableBlockedState(req.params.id, Boolean(is_blocked), reason);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Complete Active Dining Session (Releases tables)
router.post('/dine-in/sessions/:id/complete', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const actorId = req.user ? (req.user.id || req.user.username) : 'staff';
    const result = DiningTableService.completeDiningSession(req.params.id, actorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / POS: Operational Table Reassignment for Active Dining Session
router.post('/dine-in/sessions/:id/reassign-tables', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier']), (req, res) => {
  try {
    const { table_ids } = req.body;
    const result = DiningTableService.reassignSessionTables({
      session_id: req.params.id,
      new_table_ids: table_ids
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Staff / Manager: Update Branch Dining Layout Configuration (Editor persistence)
router.put('/dine-in/layout/:branch_id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const branchId = req.params.branch_id;
    const { canvas, sections, non_table_objects, tables } = req.body;

    const existingLayout = db.prepare('SELECT id FROM branch_dining_layouts WHERE branch_id = ?').get(branchId);
    const layoutId = existingLayout ? existingLayout.id : `layout_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`
        INSERT INTO branch_dining_layouts (
          id, branch_id, canvas_config, sections_config, non_table_objects_config, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(branch_id) DO UPDATE SET
          canvas_config = excluded.canvas_config,
          sections_config = excluded.sections_config,
          non_table_objects_config = excluded.non_table_objects_config,
          updated_at = excluded.updated_at
      `).run(
        layoutId,
        branchId,
        JSON.stringify(canvas || { width: 380, height: 620 }),
        JSON.stringify(sections || []),
        JSON.stringify(non_table_objects || []),
        now,
        now
      );

      if (Array.isArray(tables)) {
        for (const t of tables) {
          const tableId = t.id || `tbl_${branchId}_${t.table_number}`;
          const qrToken = t.qr_token || `qr_${crypto.randomBytes(8).toString('hex')}`;

          db.prepare(`
            INSERT INTO branch_tables (
              id, branch_id, table_number, label, capacity, section_id,
              x, y, width, height, shape, orientation, qr_token, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(branch_id, table_number) DO UPDATE SET
              label = excluded.label,
              capacity = excluded.capacity,
              section_id = excluded.section_id,
              x = excluded.x,
              y = excluded.y,
              width = excluded.width,
              height = excluded.height,
              shape = excluded.shape,
              orientation = excluded.orientation,
              is_active = excluded.is_active,
              updated_at = excluded.updated_at
          `).run(
            tableId,
            branchId,
            String(t.table_number),
            t.label || `meja ${t.table_number}`,
            Number(t.capacity) || 4,
            t.section_id || null,
            Number(t.x) || 0,
            Number(t.y) || 0,
            Number(t.width) || 80,
            Number(t.height) || 60,
            t.shape || 'rectangle',
            t.orientation || 'horizontal',
            qrToken,
            t.is_active !== undefined ? (t.is_active ? 1 : 0) : 1,
            now,
            now
          );

          if (t.operational_state) {
            db.prepare(`
              INSERT INTO branch_table_states (table_id, operational_state, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(table_id) DO UPDATE SET
                operational_state = excluded.operational_state,
                updated_at = excluded.updated_at
            `).run(tableId, t.operational_state, now);
          }
        }
      }

      db.exec('COMMIT;');
    } catch (saveErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      throw saveErr;
    }

    res.json({ success: true, message: 'Tata letak meja berhasil diperbarui.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// JSON 404 for any unmatched API request (all methods) — prevents clients that
// parse with res.json() from ever receiving Express's HTML default body.
router.use((req, res) => {
  res.status(404).json({ success: false, error: 'ENDPOINT_NOT_FOUND', status_code: 404 });
});

module.exports = router;

