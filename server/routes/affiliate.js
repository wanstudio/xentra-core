'use strict';

const { defaultService } = require('../../domains/affiliate');

module.exports = function registerAffiliateRoutes(router, deps = {}) {
  const requireCustomerAuth = deps.requireCustomerAuth;
  const requireAuth = deps.requireAuth;
  const service = deps.affiliateService || defaultService;
  const ownerRoles = ['owner', 'brand_manager'];

  // Initialize table schema
  service.ensureSchema();

  // ══════════════════════════════════════════════════════════════
  //  1. CUSTOMER AFFILIATE ROUTES
  // ══════════════════════════════════════════════════════════════

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
          cookie_days: program.cookie_days
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

      const host = req.headers.host || 'app.mybangjo.com';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      let shareUrl = `${protocol}://${host}/?ref=${encodeURIComponent(profile.referral_code)}`;
      if (menuId) {
        shareUrl += `&menu=${encodeURIComponent(menuId)}`;
      }

      const waText = `Wah cobain deh ${menuTitle} di Bangjo, beneran enak banget! 🤤 Pesan langsung lewat link ini ya: ${shareUrl}`;

      res.json({
        success: true,
        referral_code: profile.referral_code,
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
      const { commission_type, commission_rate, commission_per_item, cookie_days, min_payout_amount, is_active } = req.body || {};
      const program = await service.updateProgram({
        brandId: req.brand_id,
        commissionType: commission_type,
        commissionRate: commission_rate,
        commissionPerItem: commission_per_item,
        cookieDays: cookie_days,
        minPayoutAmount: min_payout_amount,
        isActive: is_active
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
