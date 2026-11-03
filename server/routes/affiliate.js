'use strict';

const { defaultService } = require('../../domains/affiliate');
const DataAccess = require('../../core/data/DataAccess');

module.exports = function registerAffiliateRoutes(router, deps = {}) {
  const requireCustomerAuth = deps.requireCustomerAuth;
  const requireAuth = deps.requireAuth;
  const service = deps.affiliateService || defaultService;
  const db = deps.db || DataAccess;
  const ownerRoles = ['owner', 'brand_manager'];

  // Initialize table schema
  service.ensureSchema();

  function resolveBrandId(req) {
    if (req.brand_id) return req.brand_id;
    if (req.customer && (req.customer.brandId || req.customer.brand_id)) return req.customer.brandId || req.customer.brand_id;
    if (req.query && req.query.brand_id) return req.query.brand_id;
    if (req.body && req.body.brand_id) return req.body.brand_id;
    const b = (typeof db.queryOne === 'function') ? db.queryOne('SELECT id FROM brands ORDER BY id ASC LIMIT 1') : null;
    return (b && b.id) || 'brand_bangjo';
  }

  // ══════════════════════════════════════════════════════════════
  //  0. PUBLIC / UNGUARDED AFFILIATE INFO & SOCIAL PROOF
  // ══════════════════════════════════════════════════════════════

  // Public program overview for Value-First Landing / Teaser
  const handlePublicProgram = async (req, res) => {
    try {
      const brandId = resolveBrandId(req);
      const programInfo = await service.getPublicProgramInfo({ brandId });
      res.json({ success: true, program: programInfo });
    } catch (err) {
      console.error('[Affiliate Public Program Error]:', err);
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_PROGRAM' });
    }
  };
  router.get('/public/affiliate/program', handlePublicProgram);
  router.get('/customer/affiliate/program', handlePublicProgram);

  // Generate verified QR code payload (SVG & DataURL) for a referral code
  const handleQrCode = (req, res) => {
    try {
      const code = req.query.code || req.query.ref || '';
      if (!code) return res.status(400).json({ success: false, error: 'REFERRAL_CODE_REQUIRED' });
      const host = req.headers.host || 'app.mybangjo.com';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const shareUrl = `${protocol}://${host}/?ref=${encodeURIComponent(code)}`;

      const qrcode = require('qrcode-generator');
      const qr = qrcode(0, 'M');
      qr.addData(shareUrl);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
      const dataUrl = qr.createDataURL(6, 4);

      res.json({
        success: true,
        referral_code: code,
        share_url: shareUrl,
        svg,
        data_url: dataUrl
      });
    } catch (err) {
      console.error('[Affiliate QR Error]:', err);
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_GENERATE_QR' });
    }
  };
  router.get('/public/affiliate/qr-code', handleQrCode);
  router.get('/customer/affiliate/qr-code', handleQrCode);

  // ══════════════════════════════════════════════════════════════
  //  1. CUSTOMER AFFILIATE ROUTES
  // ══════════════════════════════════════════════════════════════

  // Instant 1-Tap Activation (Zero Application Form)
  router.post('/customer/affiliate/activate', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = resolveBrandId(req);
      const { full_name, phone } = req.body || {};

      const profile = await service.activateInstantPartner({
        brandId,
        customerId,
        customerName: full_name || req.customer.name || null,
        customerPhone: phone || req.customer.phone || null
      });

      res.status(200).json({
        success: true,
        message: 'Selamat! Akun Foodie Partner Anda telah aktif.',
        profile
      });
    } catch (err) {
      console.error('[Affiliate Activate Error]:', err);
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_ACTIVATE_PARTNER' });
    }
  });

  // Get current customer registration and approval status
  router.get('/customer/affiliate/status', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_ID_REQUIRED' });

      const statusRes = await service.getCustomerStatus({ brandId, customerId });
      const program = await service.getProgram({ brandId });

      res.json({
        success: true,
        registered: statusRes.registered,
        status: statusRes.status,
        profile: statusRes.profile,
        program: {
          commission_type: program.commission_type || 'FIXED_PER_ITEM',
          commission_rate: program.commission_rate,
          commission_per_item: program.commission_per_item || program.commission_rate || 1000,
          min_payout_amount: program.min_payout_amount,
          cookie_days: program.cookie_days,
          is_active: program.is_active
        }
      });
    } catch (err) {
      console.error('[Affiliate Status Error]:', err);
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_STATUS' });
    }
  });

  // Apply / register for affiliate partnership
  router.post('/customer/affiliate/apply', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_ID_REQUIRED' });

      const { full_name, phone, social_media, bank_name, bank_account_number, bank_account_holder, notes } = req.body || {};

      const profile = await service.applyForAffiliate({
        brandId,
        customerId,
        customerName: full_name || req.customer.name || null,
        customerPhone: phone || req.customer.phone || null,
        socialMedia: social_media,
        bankName: bank_name,
        accountNumber: bank_account_number,
        accountHolder: bank_account_holder,
        notes
      });

      res.status(201).json({
        success: true,
        message: 'Pengajuan kemitraan affiliate berhasil dikirim. Tim kami akan melakukan review dalam 1x24 jam.',
        profile
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_SUBMIT_APPLICATION' });
    }
  });

  // Get or initialize customer affiliate profile
  router.get('/customer/affiliate/profile', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_ID_REQUIRED' });

      const profile = await service.getOrCreateProfile({
        brandId,
        customerId,
        customerName: req.customer.name || null,
        customerPhone: req.customer.phone || null
      });

      const program = await service.getProgram({ brandId });

      res.json({
        success: true,
        profile,
        program: {
          commission_type: program.commission_type || 'FIXED_PER_ITEM',
          commission_rate: program.commission_rate,
          commission_per_item: program.commission_per_item || program.commission_rate || 1000,
          min_payout_amount: program.min_payout_amount,
          cookie_days: program.cookie_days,
          featured_product: program.featured_product || null
        }
      });
    } catch (err) {
      console.error('[Affiliate Profile Error]:', err);
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_AFFILIATE_PROFILE' });
    }
  });

  // Update bank / e-wallet details
  router.put('/customer/affiliate/bank-details', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      const { bank_name, bank_account_number, bank_account_holder } = req.body || {};

      const profile = await service.updateBankDetails({
        brandId,
        customerId,
        bankName: bank_name,
        accountNumber: bank_account_number,
        accountHolder: bank_account_holder
      });

      res.json({ success: true, profile });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_UPDATE_BANK_DETAILS' });
    }
  });

  // Record visitor attribution from shared link (Public / Customer session)
  router.post('/customer/affiliate/attribute', async (req, res) => {
    try {
      const brandId = req.brand_id || (req.body && req.body.brand_id);
      if (!brandId) return res.status(400).json({ success: false, error: 'BRAND_ID_REQUIRED' });

      const { referral_code, session_id, menu_id, source } = req.body || {};
      const customerId = req.customer ? (req.customer.customerId || req.customer.customer_id) : null;

      const result = await service.recordAttribution({
        brandId,
        referralCode: referral_code,
        customerId,
        sessionId: session_id,
        menuId: menu_id,
        source: source || 'whatsapp'
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_RECORD_ATTRIBUTION' });
    }
  });

  // Get full affiliate dashboard stats for customer
  router.get('/customer/affiliate/stats', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;

      const stats = await service.getCustomerStats({ brandId, customerId });
      res.json({ success: true, stats });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_STATS' });
    }
  });

  // Request payout (Tarik Dana Komisi)
  router.post('/customer/affiliate/payout', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      const { amount, notes } = req.body || {};

      const payout = await service.requestPayout({
        brandId,
        customerId,
        amount: Number(amount),
        notes
      });

      res.json({ success: true, payout });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'PAYOUT_REQUEST_FAILED' });
    }
  });

  // Get customer's payout history
  router.get('/customer/affiliate/payouts', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;

      const payouts = await service.listPayoutsByCustomer({ brandId, customerId });
      res.json({ success: true, payouts: payouts || [] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_PAYOUTS' });
    }
  });

  // Generate share link and precomposed WhatsApp message
  router.get('/customer/affiliate/share-text', requireCustomerAuth(), async (req, res) => {
    try {
      const customerId = req.customer.customerId || req.customer.customer_id;
      const brandId = req.brand_id || req.customer.brandId || req.customer.brand_id;
      const menuTitle = req.query.menu_title || 'menu spesial';
      const menuId = req.query.menu_id || '';

      const profile = await service.getOrCreateProfile({
        brandId,
        customerId,
        customerName: req.customer.name || null
      });

      let brand = null;
      if (brandId) {
        if (typeof db.queryOne === 'function') {
          brand = db.queryOne('SELECT name, customer_pwa_name FROM brands WHERE id = ? LIMIT 1', [brandId]);
        } else if (typeof db.prepare === 'function') {
          brand = db.prepare('SELECT name, customer_pwa_name FROM brands WHERE id = ?').get(brandId);
        }
      }
      const brandName = (brand && (brand.customer_pwa_name || brand.name)) || 'Bangjo';

      const host = req.headers.host || 'app.mybangjo.com';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      let shareUrl = `${protocol}://${host}/?ref=${encodeURIComponent(profile.referral_code)}`;
      if (menuId) {
        shareUrl += `&menu=${encodeURIComponent(menuId)}`;
      }

      // GoFood/GrabFood clean share style:
      // share_title: short canonical title
      // share_text: message body WITHOUT duplicated URL
      // share_url: distinct canonical URL for Web Share API
      // whatsapp_text: pre-formatted single payload for direct chat / fallback (Text + newline + URL)
      const shareTitle = `${menuTitle} • ${brandName}`;
      const shareText = `Cobain deh ${menuTitle} di ${brandName}, rasanya rekomen banget!`;
      const waText = `${shareText}\n${shareUrl}`;

      res.json({
        success: true,
        referral_code: profile.referral_code,
        share_title: shareTitle,
        share_text: shareText,
        share_url: shareUrl,
        whatsapp_text: waText
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_GENERATE_SHARE_TEXT' });
    }
  });

  // ══════════════════════════════════════════════════════════════
  //  2. OWNER / ADMIN AFFILIATE GOVERNANCE ROUTES
  // ══════════════════════════════════════════════════════════════

  router.get('/admin/affiliate/program', requireAuth(ownerRoles), async (req, res) => {
    try {
      const program = await service.getProgram({ brandId: req.brand_id });
      res.json({ success: true, program });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_PROGRAM' });
    }
  });

  router.put('/admin/affiliate/program', requireAuth(ownerRoles), async (req, res) => {
    try {
      const { commission_type, commission_rate, commission_per_item, cookie_days, min_payout_amount, is_active, featured_product_id } = req.body || {};
      const program = await service.updateProgram({
        brandId: req.brand_id,
        commissionType: commission_type,
        commissionRate: commission_rate,
        commissionPerItem: commission_per_item,
        cookieDays: cookie_days,
        minPayoutAmount: min_payout_amount,
        isActive: is_active,
        featuredProductId: featured_product_id
      });
      res.json({ success: true, program });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_UPDATE_PROGRAM' });
    }
  });

  router.get('/admin/affiliate/payouts', requireAuth(ownerRoles), async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      const payouts = await service.listPayoutsForAdmin({ brandId: req.brand_id, status });
      res.json({ success: true, payouts });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_PAYOUTS' });
    }
  });

    router.patch('/admin/affiliate/payouts/:id', requireAuth(ownerRoles), async (req, res) => {
    try {
      const { action, notes, transfer_receipt_url, transfer_reference, rejection_reason } = req.body || {};
      const payout = await service.processAdminPayout({
        brandId: req.brand_id,
        payoutId: req.params.id,
        action: String(action || '').toUpperCase(),
        notes,
        transferReference: transfer_reference || transfer_receipt_url,
        receiptUrl: transfer_receipt_url || transfer_reference,
        rejectionReason: rejection_reason
      });
      res.json({ success: true, payout });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_PROCESS_PAYOUT' });
    }
  });

  // List all affiliate applications and members for Owner review
  router.get('/admin/affiliate/members', requireAuth(ownerRoles), async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      const members = await service.listAffiliatesForAdmin({ brandId: req.brand_id, status });
      res.json({ success: true, members });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'FAILED_TO_LOAD_MEMBERS' });
    }
  });

  // Approve affiliate application
  router.post('/admin/affiliate/members/:id/approve', requireAuth(ownerRoles), async (req, res) => {
    try {
      const profile = await service.approveAffiliate({
        brandId: req.brand_id,
        profileId: req.params.id,
        approvedBy: req.user ? req.user.id : null
      });
      res.json({ success: true, message: 'Mitra affiliate berhasil disetujui.', profile });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_APPROVE_AFFILIATE' });
    }
  });

  // Reject affiliate application
  router.post('/admin/affiliate/members/:id/reject', requireAuth(ownerRoles), async (req, res) => {
    try {
      const { rejection_reason } = req.body || {};
      const profile = await service.rejectAffiliate({
        brandId: req.brand_id,
        profileId: req.params.id,
        rejectionReason: rejection_reason
      });
      res.json({ success: true, message: 'Pengajuan mitra affiliate telah ditolak.', profile });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message || 'FAILED_TO_REJECT_AFFILIATE' });
    }
  });
};
