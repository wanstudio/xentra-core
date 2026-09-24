/**
 * XENTRA CORE — ADMIN SETTINGS ROUTES
 *
 * Owner / Brand Manager / Branch Manager settings and integration status.
 * Business logic stays in repositories/services; this module owns HTTP routing
 * and response shaping for the settings surface.
 */
'use strict';

module.exports = function registerSettingsRoutes(router, deps) {
  const {
    db,
    requireAuth,
    coreBrandRepo,
    coreBranchRepo,
    coreUserRepo,
    corePaymentRepo
  } = deps;

// 1. Settings Overview / Metadata Tree
router.get('/admin/settings/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const branches = db.prepare('SELECT id, name, is_active FROM branches WHERE brand_id = ?').all(req.brand_id);
    const branchCount = branches ? branches.length : 0;

    res.json({
      success: true,
      brand_id: req.brand_id,
      brand_name: brand ? brand.name : 'Unknown Brand',
      sections: {
        business: { status: 'configured', subcategories: ['profile', 'info', 'legal'] },
        locations: { status: 'configured', subcategories: ['defaults'], total_branches: branchCount },
        commerce: { status: 'configured', subcategories: ['orders', 'payments', 'fulfillment'] },
        channels: { status: 'configured', subcategories: ['website', 'customer-app', 'pos', 'kiosk'] },
        system: { status: 'configured', subcategories: ['notifications', 'security'] },
        integrations: { status: 'configured', subcategories: ['integrations'] }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Business Settings
// 2.1 Brand Profile (GET)
router.get('/admin/settings/business/profile', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    let banners = [];
    try {
      banners = brand && brand.banners ? (typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners) : [];
    } catch (_) {}

    res.json({
      success: true,
      profile: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        tagline: brand.tagline || '',
        logo_url: brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: brand.primary_color || '#b6ff00',
        custom_domain: brand.custom_domain || '',
        banners: Array.isArray(banners) ? banners : []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.2 Brand Profile (PUT - Owner/Brand Manager only)
router.put('/admin/settings/business/profile', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { name, tagline, logo_url, primary_color, banners } = req.body;
    coreBrandRepo.updateBrandProfile(req.brand_id, {
      name,
      tagline,
      logo_url,
      primary_color,
      banners
    });

    const updated = coreBrandRepo.findById(req.brand_id);
    res.json({
      success: true,
      message: 'Profil brand berhasil diperbarui.',
      profile: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        tagline: updated.tagline,
        logo_url: updated.logo_url,
        primary_color: updated.primary_color,
        custom_domain: updated.custom_domain
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.3 Business Info
router.get('/admin/settings/business/info', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(brand.organization_id);
    const primaryBranch = db.prepare('SELECT address_text, phone, whatsapp_number FROM branches WHERE brand_id = ? ORDER BY created_at ASC LIMIT 1').get(req.brand_id);

    res.json({
      success: true,
      info: {
        brand_name: brand.name,
        organization_name: org ? org.name : 'Xentra Merchant Group',
        organization_slug: org ? org.slug : '',
        primary_address: primaryBranch ? primaryBranch.address_text : '',
        contact_phone: primaryBranch ? primaryBranch.phone : '',
        contact_whatsapp: primaryBranch ? primaryBranch.whatsapp_number : '',
        registered_at: brand.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2.4 Legal / Tax (Honest not-configured state)
router.get('/admin/settings/business/legal', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    is_supported: false,
    tax_configured: false,
    npwp: null,
    vat_percentage: 0,
    pb1_percentage: 0,
    terms_url: null,
    privacy_url: null,
    message: 'Konfigurasi pajak (PPN / PB1) dan entitas legal belum dikonfigurasi pada Core engine v1. Semua harga transaksi dianggap harga final (nett).'
  });
});

// 3. Locations / Branch Defaults
router.get('/admin/settings/locations/defaults', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const branches = db.prepare(`
      SELECT b.id, b.name, b.slug, b.is_active, b.is_open_override,
             s.is_delivery_active, s.is_pickup_active, s.max_radius_km, s.free_delivery_km, s.price_per_km, s.min_order_amount
      FROM branches b
      LEFT JOIN branch_delivery_settings s ON s.branch_id = b.id
      WHERE b.brand_id = ?
      ORDER BY b.created_at ASC
    `).all(req.brand_id);

    res.json({
      success: true,
      defaults: {
        delivery_enabled_default: true,
        pickup_enabled_default: true,
        dine_in_enabled_default: true,
        default_max_radius_km: 10.0,
        default_free_delivery_km: 3.0,
        default_price_per_km: 2500.0,
        branches_count: branches.length,
        branches: branches.map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          is_active: b.is_active === 1,
          is_delivery_active: b.is_delivery_active !== null ? b.is_delivery_active === 1 : true,
          is_pickup_active: b.is_pickup_active !== null ? b.is_pickup_active === 1 : true,
          max_radius_km: b.max_radius_km || 10.0,
          price_per_km: b.price_per_km || 2500.0
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Commerce Settings
// 4.1 Order Settings
router.get('/admin/settings/commerce/orders', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    policies: {
      order_acceptance_mode: 'manual_or_pos',
      allow_preorder: false,
      reservation_lead_days_min: 1,
      reservation_rule: 'Reservasi hanya dapat dipesan untuk H+1 ke atas (pemesanan hari yang sama/same-day dilarang sesuai OrderEngine)',
      overdue_timeout_seconds: 900,
      supported_order_types: ['delivery', 'takeaway', 'dine_in', 'reservation'],
      supported_order_channels: ['web', 'pwa', 'pos', 'kiosk']
    }
  });
});

// 4.2 Payment Settings
router.get('/admin/settings/commerce/payments', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
    let parsedBrandConfig = null;
    if (brandConfig && brandConfig.default_payment_config) {
      try { parsedBrandConfig = JSON.parse(brandConfig.default_payment_config); } catch (_) {}
    }

    let branchOverride = null;
    if (effectiveBranchId && effectiveBranchId !== 'all') {
      const branchRow = corePaymentRepo.findBranchPaymentConfig(effectiveBranchId, req.brand_id);
      if (branchRow && branchRow.payment_config_override) {
        try { branchOverride = JSON.parse(branchRow.payment_config_override); } catch (_) {}
      }
    }

    const effectiveConfig = branchOverride || parsedBrandConfig || {};
    const hasOverride = Boolean(branchOverride);
    const midtransConfigured = Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY);
    const dokuConfigured = Boolean(effectiveConfig.client_id && effectiveConfig.secret_key);
    const activeProvider = Object.prototype.hasOwnProperty.call(effectiveConfig, 'provider')
      ? (effectiveConfig.provider || '')
      : (midtransConfigured ? 'midtrans' : (dokuConfigured ? 'doku' : ''));

    res.json({
      success: true,
      payment_settings: {
        branch_id: effectiveBranchId || null,
        has_branch_override: hasOverride,
        active_provider: activeProvider,
        server_key_configured: Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY),
        // Client Key Midtrans bersifat publishable (dipakai di sisi browser oleh Snap),
        // jadi ditampilkan seperti merchant_id. Server Key tetap rahasia.
        client_key: effectiveConfig.client_key || '',
        client_key_configured: Boolean(effectiveConfig.client_key || process.env.MIDTRANS_CLIENT_KEY),
        merchant_id: effectiveConfig.merchant_id || process.env.MIDTRANS_MERCHANT_ID || '',
        is_production: Boolean(effectiveConfig.is_production !== undefined ? effectiveConfig.is_production : (process.env.MIDTRANS_IS_PRODUCTION === 'true')),
        doku_is_production: Boolean(effectiveConfig.doku_is_production),
        // Client ID dan Callback URL bukan rahasia — dikirim seperti merchant_id
        // Midtrans, supaya form bisa menampilkan yang sudah tersimpan. Secret key
        // tetap tidak pernah dikirim; hanya statusnya.
        doku_client_id: effectiveConfig.client_id || '',
        doku_callback_url: effectiveConfig.callback_url || '',
        doku_client_id_configured: Boolean(effectiveConfig.client_id),
        doku_secret_key_configured: Boolean(effectiveConfig.secret_key),
        providers: [
          { code: 'midtrans', name: 'Midtrans Payment Gateway', enabled: Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY), is_active: activeProvider === 'midtrans' },
          { code: 'doku', name: 'DOKU Payment Gateway', enabled: Boolean(effectiveConfig.client_id && effectiveConfig.secret_key), is_active: activeProvider === 'doku' }
        ],
        methods: [
          { code: 'cash', name: 'Tunai Kasir', enabled: true, mode: 'pos_cashier' },
          {
            code: 'qris_static',
            name: 'QRIS Statis',
            enabled: Boolean(effectiveConfig.qris_static && effectiveConfig.qris_static.image_url),
            mode: 'static_manual',
            image_url: (effectiveConfig.qris_static && effectiveConfig.qris_static.image_url) || effectiveConfig.qris_static_image_url || '',
            merchant_name: (effectiveConfig.qris_static && effectiveConfig.qris_static.merchant_name) || '',
            instructions: (effectiveConfig.qris_static && effectiveConfig.qris_static.instructions) || ''
          },
          { code: 'midtrans', name: 'Midtrans Payment Gateway', enabled: Boolean(effectiveConfig.server_key || process.env.MIDTRANS_SERVER_KEY), mode: 'online', is_active_provider: activeProvider === 'midtrans' },
          { code: 'doku', name: 'DOKU Payment Gateway', enabled: Boolean(effectiveConfig.client_id && effectiveConfig.secret_key), mode: 'online', is_active_provider: activeProvider === 'doku' }
        ]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.3 Payment Settings (PUT - Owner/Brand Manager only)
router.put('/admin/settings/commerce/payments', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { branch_id, server_key, client_key, merchant_id, is_production, provider, doku_client_id, doku_secret_key, doku_callback_url, doku_is_production } = req.body;

    const isBranchScope = Boolean(branch_id && branch_id !== 'all');

    // Config yang sudah tersimpan jadi DASAR-nya, bukan dibuang. Dulu payload dibangun
    // dari nol lalu menimpa seluruhnya, jadi menyimpan tab Midtrans menghapus kredensial
    // DOKU — dan sebaliknya. Kredensial juga tidak pernah dikirim balik ke klien, jadi
    // kolom yang dibiarkan kosong HARUS berarti "pertahankan yang tersimpan".
    let existing = {};
    if (isBranchScope) {
      const row = corePaymentRepo.findBranchPaymentConfig(branch_id, req.brand_id);
      if (row && row.payment_config_override) {
        try { existing = JSON.parse(row.payment_config_override) || {}; } catch (_) { existing = {}; }
      }
    }
    if (!Object.keys(existing).length) {
      const brandRow = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
      if (brandRow && brandRow.default_payment_config) {
        try { existing = JSON.parse(brandRow.default_payment_config) || {}; } catch (_) { existing = {}; }
      }
    }

    const merged = Object.assign({}, existing);

    // `provider` = satu-satunya gateway online yang aktif. Tidak dikirim berarti
    // tidak diubah; dikirim kosong berarti tidak ada yang aktif.
    if (typeof provider !== 'undefined') {
      merged.provider = provider || '';
    } else if (!Object.prototype.hasOwnProperty.call(merged, 'provider')) {
      merged.provider = '';
    }
    // Environment disimpan per gateway: `is_production` milik Midtrans,
    // `doku_is_production` milik DOKU. Tidak ada lagi satu flag untuk keduanya.
    if (typeof is_production !== 'undefined') merged.is_production = Boolean(is_production);
    if (typeof doku_is_production !== 'undefined') merged.doku_is_production = Boolean(doku_is_production);

    // Kredensial: kosong = pertahankan yang lama.
    if (server_key) merged.server_key = server_key;
    if (client_key) merged.client_key = client_key;
    if (doku_secret_key) merged.secret_key = doku_secret_key;
    if (merchant_id) merged.merchant_id = merchant_id;
    if (doku_client_id) merged.client_id = doku_client_id;
    if (doku_callback_url) merged.callback_url = doku_callback_url;

    // Satu gateway online aktif, dan hanya yang benar-benar punya kredensial yang
    // boleh dinyalakan — kalau tidak, tamu akan diarahkan ke gateway yang tidak jalan.
    if (merged.provider === 'midtrans' || merged.provider === 'doku') {
      const credentialsReady = merged.provider === 'midtrans'
        ? Boolean(merged.server_key || process.env.MIDTRANS_SERVER_KEY)
        : Boolean(merged.client_id && merged.secret_key);
      if (!credentialsReady) {
        return res.status(400).json({
          success: false,
          error: 'Kredensial ' + (merged.provider === 'doku' ? 'DOKU' : 'Midtrans') + ' belum lengkap. Simpan kredensialnya dulu sebelum diaktifkan.'
        });
      }
    }

    const jsonStr = JSON.stringify(merged);

    if (isBranchScope) {
      // Branch-specific override
      const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
      if (!belongs) {
        return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau bukan milik brand ini.' });
      }
      corePaymentRepo.updateBranchPaymentConfig(branch_id, jsonStr);
      return res.json({ success: true, message: 'Override pembayaran cabang berhasil disimpan.', is_branch_override: true });
    }

    // Brand-level default
    corePaymentRepo.updateBrandPaymentConfig(req.brand_id, jsonStr);
    res.json({ success: true, message: 'Pengaturan pembayaran default brand berhasil disimpan.', is_branch_override: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/admin/settings/commerce/payments/qris-static', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { branch_id, enabled, image_url, merchant_name, instructions } = req.body || {};
    const isBranchScope = Boolean(branch_id && branch_id !== 'all');
    let existing = {};

    if (isBranchScope) {
      const row = corePaymentRepo.findBranchPaymentConfig(branch_id, req.brand_id);
      if (row && row.payment_config_override) {
        try { existing = JSON.parse(row.payment_config_override) || {}; } catch (_) {}
      }
    } else {
      const brandRow = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
      if (brandRow && brandRow.default_payment_config) {
        try { existing = JSON.parse(brandRow.default_payment_config) || {}; } catch (_) {}
      }
    }

    const merged = Object.assign({}, existing);
    const qris = Object.assign({}, (merged.qris_static && typeof merged.qris_static === 'object') ? merged.qris_static : {});

    if (typeof enabled !== 'undefined') qris.enabled = Boolean(enabled);
    if (typeof image_url !== 'undefined') qris.image_url = String(image_url || '').trim();
    if (typeof merchant_name !== 'undefined') qris.merchant_name = String(merchant_name || '').trim();
    if (typeof instructions !== 'undefined') qris.instructions = String(instructions || '').trim();

    merged.qris_static = qris;
    const jsonStr = JSON.stringify(merged);

    if (isBranchScope) {
      const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
      if (!belongs) return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau bukan milik brand ini.' });
      corePaymentRepo.updateBranchPaymentConfig(branch_id, jsonStr);
      return res.json({ success: true, is_branch_override: true, qris_static: qris });
    }

    corePaymentRepo.updateBrandPaymentConfig(req.brand_id, jsonStr);
    res.json({ success: true, is_branch_override: false, qris_static: qris });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// // 4.3b Kredensial per provider — SATU pintu masuk per gateway.
// Menyimpan kredensial DOKU hanya menyentuh field DOKU; Midtrans tidak dibaca,
// tidak ditulis, dan tidak tersentuh. Endpoint terpisah ini membuat pencampuran
// itu tidak mungkin secara struktur, bukan sekadar dijaga oleh percabangan.
router.put('/admin/settings/commerce/payments/:provider/credentials', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const provider = String(req.params.provider || '').toLowerCase();
    if (provider !== 'midtrans' && provider !== 'doku') {
      return res.status(400).json({ success: false, error: 'Provider pembayaran tidak dikenal.' });
    }

    const { branch_id } = req.body;
    const isBranchScope = Boolean(branch_id && branch_id !== 'all');

    // Baca config tersimpan sebagai dasar, supaya provider lain tidak ikut hilang.
    let existing = {};
    if (isBranchScope) {
      const row = corePaymentRepo.findBranchPaymentConfig(branch_id, req.brand_id);
      if (row && row.payment_config_override) {
        try { existing = JSON.parse(row.payment_config_override) || {}; } catch (_) { existing = {}; }
      }
    }
    if (!Object.keys(existing).length) {
      const brandRow = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
      if (brandRow && brandRow.default_payment_config) {
        try { existing = JSON.parse(brandRow.default_payment_config) || {}; } catch (_) { existing = {}; }
      }
    }

    const merged = Object.assign({}, existing);
    if (!Object.prototype.hasOwnProperty.call(merged, 'provider')) merged.provider = '';

    if (provider === 'midtrans') {
      const { server_key, client_key, merchant_id, is_production } = req.body;
      // Kosong = pertahankan yang tersimpan (nilai rahasia tidak pernah dikirim balik).
      if (server_key) merged.server_key = server_key;
      if (client_key) merged.client_key = client_key;
      if (merchant_id) merged.merchant_id = merchant_id;
      if (typeof is_production !== 'undefined') merged.is_production = Boolean(is_production);
    } else {
      const { doku_client_id, doku_secret_key, doku_callback_url, doku_is_production } = req.body;
      if (doku_client_id) merged.client_id = doku_client_id;
      if (doku_secret_key) merged.secret_key = doku_secret_key;
      if (doku_callback_url) merged.callback_url = doku_callback_url;
      if (typeof doku_is_production !== 'undefined') merged.doku_is_production = Boolean(doku_is_production);
    }

    const jsonStr = JSON.stringify(merged);
    if (isBranchScope) {
      const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
      if (!belongs) {
        return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau bukan milik brand ini.' });
      }
      corePaymentRepo.updateBranchPaymentConfig(branch_id, jsonStr);
      return res.json({ success: true, provider, is_branch_override: true, message: 'Kredensial ' + (provider === 'doku' ? 'DOKU' : 'Midtrans') + ' berhasil disimpan.' });
    }

    corePaymentRepo.updateBrandPaymentConfig(req.brand_id, jsonStr);
    res.json({ success: true, provider, is_branch_override: false, message: 'Kredensial ' + (provider === 'doku' ? 'DOKU' : 'Midtrans') + ' berhasil disimpan.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.4 Fulfillment Settings
router.get('/admin/settings/commerce/fulfillment', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let targetBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      targetBranchId = req.user.branch_id || req.user.branchId;
    }

    if (!targetBranchId || targetBranchId === 'all') {
      const firstBranch = db.prepare('SELECT id FROM branches WHERE brand_id = ? ORDER BY created_at ASC LIMIT 1').get(req.brand_id);
      targetBranchId = firstBranch ? firstBranch.id : null;
    }

    if (!targetBranchId) {
      return res.json({
        success: true,
        fulfillment: {
          branch_id: null,
          is_delivery_active: true,
          is_pickup_active: true,
          is_dine_in_active: true,
          max_radius_km: 10.0,
          free_delivery_km: 3.0,
          price_per_km: 2500.0,
          min_order_amount: 0.0,
          promo_delivery_discount: 0.0,
          promo_min_order: 0.0
        }
      });
    }

    const settings = coreBranchRepo.findBranchDeliverySettings(targetBranchId);
    res.json({
      success: true,
      fulfillment: {
        branch_id: targetBranchId,
        branch_name: settings ? settings.branch_name : 'Cabang Utama',
        is_delivery_active: settings ? settings.is_delivery_active === 1 : true,
        is_pickup_active: settings ? settings.is_pickup_active === 1 : true,
        is_dine_in_active: true,
        max_radius_km: settings ? settings.max_radius_km : 10.0,
        free_delivery_km: settings ? settings.free_delivery_km : 3.0,
        price_per_km: settings ? settings.price_per_km : 2500.0,
        min_order_amount: settings ? settings.min_order_amount : 0.0,
        promo_delivery_discount: settings ? settings.promo_delivery_discount : 0.0,
        promo_min_order: settings ? settings.promo_min_order : 0.0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4.5 Fulfillment Settings (PUT - Branch Manager / Brand Manager / Owner)
router.put('/admin/settings/commerce/fulfillment', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    let { branch_id, is_delivery_active, is_pickup_active, max_radius_km, free_delivery_km, price_per_km, min_order_amount, promo_delivery_discount, promo_min_order } = req.body;
    if (req.user.role === 'branch_manager') {
      branch_id = req.user.branch_id || req.user.branchId;
    }

    if (!branch_id || branch_id === 'all') {
      return res.status(400).json({ success: false, error: 'ID cabang spesifik diperlukan untuk memperbarui pemenuhan pesanan.' });
    }

    const belongs = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branch_id, req.brand_id);
    if (!belongs) {
      return res.status(404).json({ success: false, error: 'Cabang tidak ditemukan atau tidak memiliki akses.' });
    }

    coreBranchRepo.updateBranchDeliverySettings(branch_id, {
      is_delivery_active,
      is_pickup_active,
      max_radius_km,
      free_delivery_km,
      price_per_km,
      min_order_amount,
      promo_delivery_discount,
      promo_min_order
    });

    res.json({ success: true, message: 'Konfigurasi pemenuhan pesanan cabang berhasil diperbarui.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Channels Status & Config
// 5.1 Website
router.get('/admin/settings/channels/website', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    const hostHeader = (req.get('host') || '').split(':')[0];
    const resolvedDomain = brand.custom_domain || hostHeader || 'localhost';
    res.json({
      success: true,
      channel: {
        code: 'website',
        name: 'Official Merchant Web Ordering',
        status: 'active',
        domain: resolvedDomain,
        url: 'https://' + resolvedDomain + '/',
        features: ['Desktop Catalog', 'Checkout', 'Midtrans Gateway', 'Order Tracking']
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.2 Customer App (PWA)
router.get('/admin/settings/channels/customer-app', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brand = coreBrandRepo.findById(req.brand_id) || req.brand;
    res.json({
      success: true,
      channel: {
        code: 'customer-app',
        name: 'Customer PWA (Progressive Web App)',
        status: 'active',
        manifest_url: '/manifest.json',
        pwa_icon: brand.logo_url || '/assets/pwa/icon-192.png',
        primary_color: brand.primary_color || '#b6ff00',
        installable: true,
        offline_shell: true
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.3 POS
router.get('/admin/settings/channels/pos', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const openShifts = db.prepare(`
      SELECT s.id, s.branch_id, b.name as branch_name, s.cashier_id, s.opened_at
      FROM pos_shifts s
      JOIN branches b ON s.branch_id = b.id
      WHERE b.brand_id = ? AND s.status = 'open'
    `).all(req.brand_id);

    res.json({
      success: true,
      channel: {
        code: 'pos',
        name: 'Point of Sale (POS Kasir)',
        status: 'active',
        active_shifts_count: openShifts ? openShifts.length : 0,
        open_shifts: openShifts || [],
        features: ['Cashier Shift Management', 'Split / Merge Order', 'Cash Drawer Movements', 'Receipt Printing']
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5.4 Kiosk (Honest not-configured state)
router.get('/admin/settings/channels/kiosk', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    channel: {
      code: 'kiosk',
      name: 'Self-Service Kiosk Terminal',
      status: 'not_configured',
      is_supported: false,
      message: 'Self-Service Ordering Kiosk belum dikonfigurasi untuk brand ini. Dapat diaktifkan saat perangkat terminal kiosk fisik terhubung.'
    }
  });
});

// 6. Integrations Status API
router.get('/admin/settings/integrations', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
    let parsedConfig = null;
    if (brandConfig && brandConfig.default_payment_config) {
      try { parsedConfig = JSON.parse(brandConfig.default_payment_config); } catch (_) {}
    }

    const midtransActive = Boolean(parsedConfig?.server_key || process.env.MIDTRANS_SERVER_KEY);
    const midtransEnv = (parsedConfig?.is_production || process.env.MIDTRANS_IS_PRODUCTION === 'true') ? 'production' : 'sandbox';
    const dokuActive = Boolean(parsedConfig?.client_id && parsedConfig?.secret_key);
    const activeProvider = parsedConfig?.provider || (dokuActive ? 'doku' : (midtransActive ? 'midtrans' : ''));

    res.json({
      success: true,
      integrations: [
        {
          id: 'payment_gateway_midtrans',
          name: 'Midtrans Payment Gateway',
          category: 'payment',
          status: midtransActive ? 'connected' : 'disconnected',
          environment: midtransEnv,
          description: 'Payment gateway multi-channel untuk pembayaran online checkout PWA dan web.',
          is_configurable: true,
          is_active_provider: activeProvider === 'midtrans'
        },
        {
          id: 'payment_gateway_doku',
          name: 'DOKU Payment Gateway',
          category: 'payment',
          status: dokuActive ? 'connected' : 'disconnected',
          environment: midtransEnv,
          description: 'Payment gateway alternatif dengan dukungan QRIS, VA, e-wallet, dan kartu kredit.',
          is_configurable: true,
          is_active_provider: activeProvider === 'doku'
        },
        {
          id: 'pos_cashier_engine',
          name: 'Xentra Core POS Engine',
          category: 'pos',
          status: 'connected',
          environment: 'native',
          description: 'Sistem POS kasir terintegrasi langsung dengan manajemen shift, laci kas, dan dapur.',
          is_configurable: false
        },
        {
          id: 'xentra_connector',
          name: 'Xentra Connector (External POS / ERP Bridge)',
          category: 'connector',
          status: 'on_hold',
          description: 'Bridge penghubung ekosistem ERP dan hardware eksternal. Invariant: Status HOLD.',
          is_configurable: false
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Notifications Settings (Honest not-configured state)
router.get('/admin/settings/notifications', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  res.json({
    success: true,
    is_supported: false,
    channels: {
      email: { enabled: false, provider: 'smtp', status: 'not_configured' },
      whatsapp: { enabled: false, provider: 'wa_gateway', status: 'not_configured' },
      push_notification: { enabled: false, provider: 'fcm_web_push', status: 'not_configured' }
    },
    message: 'Preferensi notifikasi multi-channel (WhatsApp, Email, Web Push) belum dikonfigurasi di Core persistence v1. Notifikasi pesanan saat ini berjalan secara lokal realtime di dashboard via WebSocket/polling.'
  });
});

// 8. Security & Audit Settings
router.get('/admin/settings/security', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const logs = coreUserRepo.findAuditLogsForBrand(req.brand_id, 15);
    res.json({
      success: true,
      security: {
        auth_mode: 'jwt_bearer_token',
        session_ttl_hours: 24,
        rbac_model: 'User -> Role -> Scope',
        roles_supported: ['owner', 'brand_manager', 'branch_manager', 'cashier', 'kitchen'],
        current_user: {
          id: req.user.id || req.user.userId,
          username: req.user.username,
          role: req.user.role,
          branch_id: req.user.branch_id || req.user.branchId || null
        },
        recent_audit_logs: logs || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

};
