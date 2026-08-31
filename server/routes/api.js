const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database/db');
const BranchMatcher = require('../services/BranchMatcher');
const DeliveryCalculator = require('../services/DeliveryCalculator');
const PaymentService = require('../services/PaymentService');
const OrderStateMachine = require('../services/OrderStateMachine');
const RouteService = require('../services/RouteService');

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
          s.is_delivery_active, s.is_pickup_active, s.free_delivery_km, s.price_per_km, s.max_radius_km
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
    const { latitude, longitude, subtotal = 0 } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({
        success: false,
        error: 'Parameter latitude dan longitude wajib dikirim.'
      });
    }

    const match = await BranchMatcher.matchNearestBranch({
      brand_id: req.brand_id,
      customer_lat: Number(latitude),
      customer_lng: Number(longitude),
      subtotal: Number(subtotal)
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
  challenges: new Map(), // challenge_id -> { phone, otpHash, expiresAt, attempts, verified, brandId }
  createChallenge(phone, brandId, otpCode) {
    const challengeId = 'ch_' + crypto.randomBytes(8).toString('hex');
    const otpHash = crypto.createHash('sha256').update(String(otpCode)).digest('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes TTL
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

  // Generate 6-digit OTP code (in dev/test use 123456 or random)
  const otpCode = process.env.NODE_ENV === 'production' 
    ? Math.floor(100000 + Math.random() * 900000).toString() 
    : '123456';

  const { challengeId } = OtpChallengeStore.createChallenge(phone.trim(), req.brand_id, otpCode);
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

  res.json(result);
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

  res.json({ success: true, trusted: true });
});

// 4.9 Manual / Webhook Catalog Sync from WooCommerce (Protected by requireAuth)
router.all(['/catalog/sync', '/catalog/refresh'], requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const syncCatalog = require('../database/syncWoo');
    await syncCatalog(req.brand_id);
    res.json({ success: true, message: `Catalog synced successfully for brand "${req.brand_id}".` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Menu Catalog & Home
router.get(['/catalog/menu', '/home'], (req, res) => {
  try {
    let categories = [];
    let products = [];

    try {
      categories = db
        .prepare('SELECT * FROM categories WHERE brand_id = ? ORDER BY sort_order ASC')
        .all(req.brand_id);

      products = db
        .prepare('SELECT * FROM products WHERE brand_id = ? AND is_active = 1 ORDER BY sort_order ASC')
        .all(req.brand_id);
    } catch (dbErr) {
      console.warn('[Catalog Menu DB Warn]:', dbErr.message);
    }

    if (!categories || categories.length === 0) {
      categories = [
        { id: 1, name: 'Rekom', slug: 'rekom', image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=200&auto=format&fit=crop&q=80' },
        { id: 2, name: 'Paket Ayam', slug: 'paket-ayam', image: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=200&auto=format&fit=crop&q=80' },
        { id: 3, name: 'Mie Bangjo', slug: 'mie-bangjo', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=200&auto=format&fit=crop&q=80' },
        { id: 4, name: 'Minuman Segar', slug: 'minuman-segar', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&auto=format&fit=crop&q=80' },
        { id: 5, name: 'Camilan', slug: 'camilan', image: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?w=200&auto=format&fit=crop&q=80' }
      ];
    }

    if (!products || products.length === 0) {
      products = [
        { id: 1, category_id: 1, name: 'Paket Spesial Semar', price: 35000, regular_price: 38000, description: 'Nasi + Ayam Tulang Lunak Goreng + Telor Ceplok + Tempe Goreng + Es Teh.', image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400' },
        { id: 2, category_id: 2, name: 'Ayam Bakar Madu Bangjo', price: 28000, regular_price: 32000, description: 'Ayam bakar dengan lumuran madu asli rempah khas Bangjo.', image: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=400' },
        { id: 3, category_id: 2, name: 'Ayam Geprek Sambal Bawang', price: 24000, regular_price: 24000, description: 'Ayam goreng crispy dibalut sambal bawang pedas nendang.', image: 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400' },
        { id: 4, category_id: 3, name: 'Mie Godog Jawa Asli', price: 26000, regular_price: 30000, description: 'Mie kuah gurih kental berkaldu ayam kampung dengan sayur segar.', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400' },
        { id: 5, category_id: 3, name: 'Mie Goreng Spesial Bangjo', price: 25000, regular_price: 25000, description: 'Mie goreng rempah khas racikan istimewa telur mata sapi.', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400' },
        { id: 6, category_id: 4, name: 'Es Teh Manis Jasmine', price: 6000, regular_price: 6000, description: 'Teh melati wangi diseduh segar dingin menyegarkan.', image: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400' },
        { id: 7, category_id: 4, name: 'Es Jeruk Peras Asli', price: 10000, regular_price: 12000, description: 'Jeruk peras murni tanpa pengawet.', image: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400' }
      ];
    }

    const normalizedProducts = products.map((p) => ({
      ...p,
      image: p.image || p.image_url || '',
      image_url: p.image_url || p.image || '',
      regular_price: p.regular_price || p.price,
      sale_price: p.price
    }));

    const tree = categories.map((cat) => {
      let catProducts = [];
      try {
        catProducts = db.prepare(`
          SELECT DISTINCT p.* FROM products p
          JOIN product_categories pc ON pc.product_id = p.id
          WHERE pc.category_id = ? AND p.is_active = 1
          ORDER BY p.sort_order ASC
        `).all(cat.id);
      } catch (_) {}

      if (!catProducts || catProducts.length === 0) {
        catProducts = products.filter((p) => String(p.category_id) === String(cat.id));
      }

      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'),
        image: cat.image || cat.image_url || '',
        products: catProducts.map((p) => ({
          ...p,
          image: p.image_url || p.image || '',
          image_url: p.image_url || p.image || '',
          regular_price: p.regular_price || p.price,
          sale_price: p.price
        }))
      };
    });

    const allNormalized = products.map((p) => ({
      ...p,
      image: p.image_url || p.image || '',
      image_url: p.image_url || p.image || '',
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
    const cat = req.query.category;
    let products = [];
    try {
      if (cat && cat !== 'all') {
        products = db.prepare(`
          SELECT DISTINCT p.* FROM products p
          LEFT JOIN product_categories pc ON pc.product_id = p.id
          LEFT JOIN categories c ON c.id = pc.category_id AND c.brand_id = p.brand_id
          WHERE p.brand_id = ?
            AND (c.id = ? OR c.slug = ? OR p.category_id = ?)
            AND p.is_active = 1
          ORDER BY p.sort_order ASC
        `).all(req.brand_id, cat, cat, cat);
      } else {
        products = db.prepare('SELECT * FROM products WHERE brand_id = ? AND is_active = 1 ORDER BY sort_order ASC').all(req.brand_id);
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

// 5.3 Addresses
let savedAddressesMemory = [];
router.get('/addresses', (req, res) => {
  res.json({ success: true, addresses: savedAddressesMemory });
});
router.post('/addresses', (req, res) => {
  const { label = 'Rumah', address = '', detail = '', note = '', latitude, longitude } = req.body;
  
  if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
    return res.status(400).json({
      success: false,
      error: 'Titik koordinat (latitude & longitude) wajib diisi dengan angka yang valid.'
    });
  }

  const addr = {
    id: 'addr_' + Date.now(),
    label,
    address,
    detail,
    note,
    latitude: Number(latitude),
    longitude: Number(longitude),
    is_primary: savedAddressesMemory.length === 0 ? 1 : 0
  };
  savedAddressesMemory.unshift(addr);
  res.json({ success: true, address: addr });
});
router.delete('/addresses/:id', (req, res) => {
  savedAddressesMemory = savedAddressesMemory.filter(a => String(a.id) !== String(req.params.id));
  res.json({ success: true });
});

// 6. Create Order & Submit Checkout
router.post(['/checkout/create-order', '/checkout/submit'], async (req, res) => {
  try {
    let {
      branch_id,
      customer = {},
      order_type,
      fulfillment = {},
      schedule_type = 'asap',
      scheduled_slot_start,
      scheduled_slot_end,
      delivery,
      address,
      items = [],
      payment_method = 'cash',
      note = '',
      order_note = ''
    } = req.body;

    order_type = order_type || fulfillment.type || 'delivery';
    order_note = order_note || note || '';
    if (address && !delivery) {
      delivery = {
        latitude: address.latitude || -7.2912,
        longitude: address.longitude || 112.7167,
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

    // Locked Decision: Customer information must be valid
    if (!customer.phone || !customer.phone.trim()) {
      return res.status(400).json({ success: false, error: 'Nomor telepon customer wajib diisi.' });
    }
    if (!customer.name || !customer.name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama customer wajib diisi.' });
    }

    // P1 LOGIC VALIDATION: For delivery orders, coordinates must be explicitly provided (no silent default location)
    if (order_type === 'delivery') {
      if (!delivery || delivery.latitude == null || delivery.longitude == null || isNaN(Number(delivery.latitude)) || isNaN(Number(delivery.longitude))) {
        return res.status(400).json({
          success: false,
          error: 'Titik koordinat pengantaran (latitude & longitude) wajib disertakan untuk pesanan delivery.'
        });
      }
    }

    // 1. Resolve Branch (Scoped strictly to current brand)
    let branch = null;
    if (branch_id) {
      branch = db.prepare(`
        SELECT 
          b.id, b.brand_id, b.name, b.latitude, b.longitude,
          s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
        FROM branches b 
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
        WHERE b.id = ? AND b.brand_id = ?
      `).get(branch_id, req.brand_id);
    }
    if (!branch) {
      branch = db.prepare(`
        SELECT 
          b.id, b.brand_id, b.name, b.latitude, b.longitude,
          s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
        FROM branches b 
        LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id 
        WHERE b.brand_id = ?
        LIMIT 1
      `).get(req.brand_id);
    }

    if (!branch) {
      return res.status(404).json({ success: false, error: 'Cabang restoran tidak ditemukan untuk brand ini.' });
    }

    // 2. Validate Items: Strictly require items payload and isolate products to current brand
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Keranjang pesanan tidak boleh kosong.' });
    }

    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const isPromoFree = String(item.id) === 'promo-es-teh-gratis';
      
      // P1 TENANT ISOLATION HARDENING: Product lookup MUST be strictly scoped to req.brand_id (NO fallback to global product ID)
      const prod = isPromoFree ? null : db.prepare('SELECT * FROM products WHERE id = ? AND brand_id = ?').get(item.id, req.brand_id);

      if (!isPromoFree && !prod) {
        return res.status(400).json({
          success: false,
          error: `Produk "${item.id}" tidak ditemukan pada menu brand ini.`
        });
      }

      const unitPrice = isPromoFree ? 0 : Number(prod.price);
      const prodName = isPromoFree ? 'Es Teh (Gratis Install)' : prod.name;
      const prodId = isPromoFree ? 'promo-es-teh-gratis' : prod.id;
      
      // P1 DATA-INTEGRITY: Strictly validate quantity as positive integer (NO silent clamping to 1)
      const rawQty = item.quantity != null ? item.quantity : item.qty;
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          error: `Jumlah pesanan (quantity) untuk produk "${prodName}" harus berupa bilangan bulat positif (> 0).`
        });
      }

      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      validatedItems.push({
        id: 'item_' + crypto.randomBytes(6).toString('hex'),
        product_id: prodId,
        product_name: prodName,
        unit_price: unitPrice,
        quantity: qty,
        item_subtotal: lineTotal,
        item_note: item.note || ''
      });
    }

    // 3. Compute Delivery Fee
    let deliveryFee = 0;
    let discountAmount = 0;
    let deliveryRecord = null;

    if (order_type === 'delivery') {
      const custLat = (delivery && delivery.latitude != null) ? Number(delivery.latitude) : -7.2912;
      const custLng = (delivery && delivery.longitude != null) ? Number(delivery.longitude) : 112.7167;

      const road = await RouteService.getRoadDistance(
        branch.latitude,
        branch.longitude,
        custLat,
        custLng
      );

      const promoConfig = (branch.promo_delivery_discount && branch.promo_min_order)
        ? { enabled: true, target: branch.promo_min_order, discount: branch.promo_delivery_discount }
        : { enabled: true, target: 50000, discount: 10000 };

      const feeCalc = DeliveryCalculator.calculate({
        distance_meters: road.distance_meters,
        free_km: branch.free_delivery_km || 0,
        price_per_km: branch.price_per_km || 3000,
        max_radius_km: branch.max_radius_km || 30,
        subtotal,
        promo_config: promoConfig
      });

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

    const grandTotal = Math.max(0, subtotal + deliveryFee - discountAmount);
    const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `XN-${today}-${randSuffix}`;

    // 4. Save to Database within Atomic ACID Transaction (Guarded Stock Deduction & Ledger Recording)
    const initialOrderStatus = payment_method === 'cash' ? 'confirmed' : 'pending';
    const now = new Date().toISOString();

    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO orders (
          id, order_number, brand_id, branch_id, customer_phone, customer_name,
          order_type, fulfillment_schedule_type, scheduled_slot_start, scheduled_slot_end,
          status, subtotal, discount_amount, delivery_fee, grand_total, order_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        orderNumber,
        req.brand_id,
        branch.id,
        customer.phone,
        customer.name || '',
        order_type,
        schedule_type,
        scheduled_slot_start || null,
        scheduled_slot_end || null,
        initialOrderStatus,
        subtotal,
        discountAmount,
        deliveryFee,
        grandTotal,
        order_note
      );

      // Save order items
      const insertItem = db.prepare(`
        INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, item_subtotal, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Guarded Stock Deduction & Inventory Movement Ledger
      const guardedDeductStock = db.prepare(`
        UPDATE branch_products
        SET stock = stock - ?, updated_at = datetime('now')
        WHERE branch_id = ? AND product_id = ? AND stock >= ?
      `);

      for (const it of validatedItems) {
        insertItem.run(it.id, orderId, it.product_id, it.product_name, it.unit_price, it.quantity, it.item_subtotal, it.item_note || '');

        // Deduct branch stock for regular catalog products (excluding special promo hooks)
        if (it.product_id !== 'promo-es-teh-gratis') {
          const bpBefore = db.prepare('SELECT stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(branch.id, it.product_id);
          if (bpBefore) {
            const prevStock = Number(bpBefore.stock || 0);
            const deductResult = guardedDeductStock.run(it.quantity, branch.id, it.product_id, it.quantity);
            if (!deductResult || deductResult.changes === 0) {
              throw new Error(`Stok untuk produk "${it.product_name}" di cabang ini tidak mencukupi (sisa: ${prevStock}).`);
            }
            const currentStock = prevStock - Number(it.quantity);
            const movementId = 'mov_' + crypto.randomBytes(6).toString('hex');
            db.prepare(`
              INSERT INTO inventory_movements (
                id, branch_id, product_id, movement_type, quantity, previous_stock, current_stock, reference_id, actor_id, notes, created_at
              ) VALUES (?, ?, ?, 'sale_deduction', ?, ?, ?, ?, ?, ?, ?)
            `).run(
              movementId,
              branch.id,
              it.product_id,
              -Number(it.quantity),
              prevStock,
              currentStock,
              orderNumber,
              customer.phone || 'customer_checkout',
              `Pemotongan stok otomatis pesanan online ${orderNumber} (${order_type})`,
              now
            );
          }
        }
      }

      // Save delivery record
      if (deliveryRecord) {
        db.prepare(`
          INSERT INTO order_deliveries (
            id, order_id, destination_address, destination_latitude, destination_longitude,
            actual_road_distance_meters, actual_duration_seconds, chargeable_distance_km,
            free_km_applied, rate_per_km_applied, delivery_fee_calculated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          deliveryRecord.id,
          orderId,
          deliveryRecord.destination_address,
          deliveryRecord.destination_latitude,
          deliveryRecord.destination_longitude,
          deliveryRecord.actual_road_distance_meters,
          deliveryRecord.actual_duration_seconds,
          deliveryRecord.chargeable_distance_km,
          deliveryRecord.free_km_applied,
          deliveryRecord.rate_per_km_applied,
          deliveryRecord.delivery_fee_calculated
        );
      }

      db.exec('COMMIT;');
    } catch (orderTxErr) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      return res.status(400).json({
        success: false,
        error: orderTxErr.message || 'Gagal memproses pesanan karena perubahan ketersediaan stok.'
      });
    }

    // 5. Payment Resolution
    let snapResult = { snap_token: null, redirect_url: null, merchant_id: 'midtrans_default' };
    try {
      snapResult = await PaymentService.createSnapTransaction(
        { id: orderId, grand_total: grandTotal, branch_id: branch.id, brand_id: req.brand_id, delivery_fee: deliveryFee, discount_amount: discountAmount },
        validatedItems,
        customer
      );
    } catch (payErr) {
      console.warn('[Payment Snap Warn]:', payErr.message);
    }

    const paymentId = 'pay_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO order_payments (id, order_id, provider, merchant_id, snap_token, payment_status, amount)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(paymentId, orderId, payment_method, snapResult.merchant_id || 'manual', snapResult.snap_token || null, grandTotal);

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
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      brandId: brand_id,
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

    // Strict Tenant Isolation: Ensure token brand matches incoming tenant
    if (session.brandId !== req.brand_id && session.role !== 'owner') {
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

    req.session = session;
    req.user = session;
    next();
  };
}

// 7. Get Order Details & Live Status (Tenant-Scoped to req.brand_id)
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

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const delivery = db.prepare('SELECT * FROM order_deliveries WHERE order_id = ?').get(order.id);
  const payment = db.prepare('SELECT * FROM order_payments WHERE order_id = ?').get(order.id);
  const logs = db.prepare('SELECT * FROM order_status_logs WHERE order_id = ? ORDER BY created_at ASC').all(order.id);

  res.json({
    success: true,
    order,
    items,
    delivery,
    payment,
    logs
  });
});

// 8. Kitchen Display Queue (Strictly Tenant-Scoped to req.brand_id)
router.get('/kitchen/queue', requireAuth(['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen']), (req, res) => {
  const branch_id = req.query.branch_id;
  let sql = `
    SELECT o.*, b.name as branch_name, b.brand_id
    FROM orders o
    JOIN branches b ON b.id = o.branch_id
    WHERE b.brand_id = ? AND o.status IN ('confirmed', 'preparing', 'ready')
  `;
  const params = [req.brand_id];

  if (branch_id) {
    sql += ' AND o.branch_id = ?';
    params.push(branch_id);
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

// 9. Update Order Status (Kitchen / Operator with Auth Binding)
router.patch('/kitchen/orders/:id/status', requireAuth(['owner', 'brand_manager', 'branch_manager', 'kitchen']), (req, res) => {
  try {
    const { status, note = '' } = req.body;
    
    // P1 AUTH BINDING: Use authoritative actor identity from authenticated session
    const actor_type = req.user.role === 'kitchen' ? 'kitchen' : 'staff';
    const actor_id = req.user.userId || req.user.username;

    // Verify order exists and belongs to current brand before transition
    const existingOrder = db.prepare(`
      SELECT o.id, b.brand_id 
      FROM orders o
      JOIN branches b ON b.id = o.branch_id
      WHERE o.id = ? AND b.brand_id = ?
    `).get(req.params.id, req.brand_id);

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan pada brand ini.' });
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
        brand_name: (req.brand && req.brand.name) ? req.brand.name : 'Bangjo Resto'
      }
    });
  } catch (err) {
    console.error('[Merchant Auth Error]:', err);
    res.status(500).json({ success: false, error: 'Terjadi kesalahan sistem saat autentikasi.' });
  }
});

// P1 SECURE ME ENDPOINT: Strictly verifies Bearer token session
router.get('/auth/merchant/me', requireAuth(), (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.userId,
      username: req.user.username,
      email: req.user.email,
      full_name: req.user.fullName,
      role: req.user.role,
      brand_name: req.brand.name
    },
    brand: req.brand
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
    let banners = [];
    try {
      banners = brand.banners ? (typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners) : [];
    } catch(e) {}
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
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logo_url: brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: brand.primary_color || '#b6ff00',
        custom_domain: brand.custom_domain || 'dev.mybangjo.com',
        tagline: brand.tagline || 'Official Online Food Ordering',
        banners
      }
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
          banners = COALESCE(?, banners),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : null,
      primary_color !== undefined ? primary_color : null,
      logo_url !== undefined ? logo_url : null,
      custom_domain !== undefined ? custom_domain : null,
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
        custom_domain: req.brand.custom_domain || 'dev.mybangjo.com',
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
    db.prepare(`
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
        b.id, b.name, b.slug, b.address_text, b.latitude, b.longitude, b.phone, b.is_active,
        s.free_delivery_km, s.price_per_km, s.max_radius_km, s.promo_delivery_discount, s.promo_min_order
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ?
    `).all(req.brand_id);

    res.json({ success: true, branches });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14.1 Create Branch (Mandatory Branch WhatsApp Number)
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

    const branchPhone = (phone || whatsapp_number || '').trim();

    if (!branchPhone) {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp / telepon cabang wajib diisi saat pendaftaran cabang.'
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

    db.prepare(`
      INSERT INTO branches (id, brand_id, name, slug, address_text, latitude, longitude, phone, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      branchId,
      req.brand_id,
      name.trim(),
      slug,
      address_text ? address_text.trim() : '',
      latitude !== undefined ? latitude : 0,
      longitude !== undefined ? longitude : 0,
      branchPhone
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
        address_text: address_text || ''
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/branches/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, address_text, latitude, longitude, phone, whatsapp_number, is_active, free_delivery_km, price_per_km, max_radius_km, promo_min_order, promo_delivery_discount } = req.body;
    const targetPhone = phone !== undefined ? phone : whatsapp_number;

    if (targetPhone !== undefined && targetPhone !== null && String(targetPhone).trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nomor WhatsApp / telepon cabang tidak boleh dikosongkan.'
      });
    }

    db.prepare(`
      UPDATE branches 
      SET name = COALESCE(?, name),
          address_text = COALESCE(?, address_text),
          latitude = COALESCE(?, latitude),
          longitude = COALESCE(?, longitude),
          phone = COALESCE(?, phone),
          is_active = COALESCE(?, is_active)
      WHERE id = ? AND brand_id = ?
    `).run(
      name !== undefined ? name : null,
      address_text !== undefined ? address_text : null,
      latitude !== undefined ? latitude : null,
      longitude !== undefined ? longitude : null,
      targetPhone !== undefined ? targetPhone : null,
      is_active !== undefined ? is_active : null,
      req.params.id,
      req.brand_id
    );

    db.prepare(`
      UPDATE branch_delivery_settings
      SET free_delivery_km = COALESCE(?, free_delivery_km),
          price_per_km = COALESCE(?, price_per_km),
          max_radius_km = COALESCE(?, max_radius_km),
          promo_min_order = COALESCE(?, promo_min_order),
          promo_delivery_discount = COALESCE(?, promo_delivery_discount)
      WHERE branch_id = ?
    `).run(
      free_delivery_km !== undefined ? free_delivery_km : null,
      price_per_km !== undefined ? price_per_km : null,
      max_radius_km !== undefined ? max_radius_km : null,
      promo_min_order !== undefined ? promo_min_order : null,
      promo_delivery_discount !== undefined ? promo_delivery_discount : null,
      req.params.id
    );

    res.json({ success: true, message: 'Pengaturan cabang & ongkir berhasil disimpan.' });
  } catch (err) {
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

// 16. Reporting Domain Single-Entrypoint API
const { ReportingEngine } = require('../../domains/reporting');
router.get('/reports/:report_type', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { report_type } = req.params;
    const { branch_id, start_date, end_date } = req.query;

    const report = ReportingEngine.generateReport(report_type, {
      brand_id: req.brand_id,
      branch_id: branch_id || req.query.branchId,
      start_date,
      end_date
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

