/**
 * XENTRA CORE — ADMIN MARKETING PROMOTION ROUTES
 *
 * Promotion CRUD, presentation/scoping, branch activation and redemption
 * reporting. Promotion business rules remain in the promotion repository/service.
 */
module.exports = function registerAdminMarketingPromotionRoutes(router, deps) {
  const {
    db,
    crypto,
    requireAuth,
    corePromotionRepo
  } = deps;

function logPromotionSecurityEvent({ actor_id, actor_role, action, brand_id, organization_id = null, branch_id = null, result, metadata }) {
  try {
    const id = 'sal_' + crypto.randomBytes(16).toString('hex');
    const safeMetadata = metadata ? JSON.stringify(metadata) : null;
    db.prepare(`
      INSERT INTO security_audit_log (id, actor_id, actor_role, action, target_user_id, target_role, brand_id, organization_id, branch_id, result, metadata, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, actor_id || null, actor_role || null, action, brand_id || null, organization_id || null, branch_id || null, result, safeMetadata);
  } catch (e) {
    console.warn('[Promotion Audit Log Error]:', e.message);
  }
}

// 1. Finance Overview API
router.get('/admin/finance/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    // Authoritative payment breakdown & summary from PaymentReportService
    const paymentReport = ReportingEngine.generateReport('payment', filter);
    const salesOverview = overviewReportingRepo.getSalesOverview(filter);

    // Unreconciled count
    const pendingRecon = corePaymentRepo.findReconciliationRecords({
      brandId: req.brand_id,
      branchId: effectiveBranchId
    });

    const totalGrossSales = salesOverview ? (salesOverview.gross_revenue || 0) : 0;
    const totalNetSales = salesOverview ? (salesOverview.subtotal_revenue || 0) : 0;
    const totalSettled = paymentReport.summary?.total_settled || 0;
    const cashSettled = paymentReport.summary?.cash_settled || 0;
    const midtransSettled = paymentReport.summary?.midtrans_settled || 0;
    const dokuSettled = paymentReport.summary?.doku_settled || 0;
    const totalPending = paymentReport.summary?.total_pending || 0;

    let totalTxCount = 0;
    if (Array.isArray(paymentReport.breakdown)) {
      for (const row of paymentReport.breakdown) {
        totalTxCount += Number(row.transaction_count || 0);
      }
    }

    res.json({
      success: true,
      data: {
        summary: {
          gross_sales: totalGrossSales,
          net_sales: totalNetSales,
          total_settled: totalSettled,
          cash_settled: cashSettled,
          midtrans_settled: midtransSettled,
          doku_settled: dokuSettled,
          total_pending: totalPending,
          transaction_count: totalTxCount,
          unreconciled_count: pendingRecon.length,
          unreconciled_amount: pendingRecon.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
          refunds: { total_amount: 0, count: 0, supported: false, status: 'not_configured' },
          payouts: { total_amount: 0, count: 0, supported: false, status: 'not_configured' }
        },
        breakdown: paymentReport.breakdown || [],
        unreconciled_records: pendingRecon
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Finance Transactions List API
router.get('/admin/finance/transactions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, payment_method, payment_status, start_date, end_date, limit, offset } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const result = corePaymentRepo.findTransactions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      paymentMethod: payment_method || null,
      paymentStatus: payment_status || null,
      startDate: start_date || null,
      endDate: end_date || null,
      limit,
      offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Finance Reconciliation API
router.get('/admin/finance/reconciliation', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const records = corePaymentRepo.findReconciliationRecords({
      brandId: req.brand_id,
      branchId: effectiveBranchId
    });

    res.json({
      success: true,
      reconciliation: {
        pending_count: records.length,
        total_pending_amount: records.reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
        records
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Finance Payment Methods Config API
router.get('/admin/finance/payment-methods', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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
    if (effectiveBranchId) {
      const branchRow = corePaymentRepo.findBranchPaymentConfig(effectiveBranchId, req.brand_id);
      if (branchRow && branchRow.payment_config_override) {
        try { branchOverride = JSON.parse(branchRow.payment_config_override); } catch (_) {}
      }
    }

    const effectiveConfig = branchOverride || parsedBrandConfig || {};
    const midtransActive = Boolean(
      (branchOverride && branchOverride.server_key) ||
      (parsedBrandConfig && parsedBrandConfig.server_key) ||
      process.env.MIDTRANS_SERVER_KEY
    );
    const dokuActive = Boolean(
      (branchOverride && branchOverride.client_id && branchOverride.secret_key) ||
      (parsedBrandConfig && parsedBrandConfig.client_id && parsedBrandConfig.secret_key)
    );
    const activeProvider = Object.prototype.hasOwnProperty.call(effectiveConfig, 'provider')
      ? (effectiveConfig.provider || '')
      : (midtransActive ? 'midtrans' : (dokuActive ? 'doku' : ''));

    // Tiap gateway punya environment-nya SENDIRI. Dulu satu `is_production` dipakai
    // bersama, jadi memindahkan Midtrans ke produksi ikut memindahkan DOKU.
    const midtransProduction = Boolean(
      (branchOverride && branchOverride.is_production) ||
      (parsedBrandConfig && parsedBrandConfig.is_production) ||
      process.env.MIDTRANS_IS_PRODUCTION === 'true'
    );
    const dokuProduction = Boolean(
      (branchOverride && branchOverride.doku_is_production) ||
      (parsedBrandConfig && parsedBrandConfig.doku_is_production)
    );

    const midtransMethods = effectiveConfig.midtrans_methods || {};
    const dokuMethods = effectiveConfig.doku_methods || {};

    res.json({
      success: true,
      active_provider: activeProvider,
      payment_methods: [
        {
          code: 'cash',
          name: 'Tunai (Cash)',
          provider: 'cash',
          is_enabled: true,
          type: 'offline',
          settlement_mode: 'manual_cashier',
          description: 'Pembayaran tunai langsung di kasir cabang dengan validasi shift POS',
          types: []
        },
        {
          code: 'midtrans',
          name: 'Midtrans Online Payment',
          provider: 'midtrans',
          is_enabled: midtransActive,
          is_active_provider: activeProvider === 'midtrans',
          type: 'online_gateway',
          environment: midtransProduction ? 'production' : 'sandbox',
          has_branch_override: Boolean(branchOverride),
          description: 'Payment gateway multi-channel (QRIS, GoPay, ShopeePay, Virtual Account, Kartu Kredit)',
          types: [
            { code: 'qris', name: 'QRIS', icon: '📱', enabled: midtransMethods.qris !== false },
            { code: 'gopay', name: 'GoPay', icon: '💚', enabled: midtransMethods.gopay !== false },
            { code: 'shopeepay', name: 'ShopeePay', icon: '🧡', enabled: midtransMethods.shopeepay !== false },
            { code: 'va', name: 'Virtual Account', icon: '🏦', enabled: midtransMethods.va !== false },
            { code: 'credit_card', name: 'Kartu Kredit', icon: '💳', enabled: midtransMethods.credit_card !== false },
            { code: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', enabled: midtransMethods.bank_transfer !== false }
          ]
        },
        {
          code: 'doku',
          name: 'DOKU Online Payment',
          provider: 'doku',
          is_enabled: dokuActive,
          is_active_provider: activeProvider === 'doku',
          type: 'online_gateway',
          environment: dokuProduction ? 'production' : 'sandbox',
          has_branch_override: Boolean(branchOverride),
          description: 'Payment gateway alternatif dengan QRIS, VA, e-wallet, dan kartu kredit',
          types: [
            { code: 'qris', name: 'QRIS', icon: '📱', enabled: dokuMethods.qris !== false },
            { code: 'gopay', name: 'GoPay', icon: '💚', enabled: dokuMethods.gopay !== false },
            { code: 'ovo', name: 'OVO', icon: '💜', enabled: dokuMethods.ovo !== false },
            { code: 'dana', name: 'DANA', icon: '💙', enabled: dokuMethods.dana !== false },
            { code: 'shopeepay', name: 'ShopeePay', icon: '🧡', enabled: dokuMethods.shopeepay !== false },
            { code: 'va', name: 'Virtual Account', icon: '🏦', enabled: dokuMethods.va !== false },
            { code: 'credit_card', name: 'Kartu Kredit', icon: '💳', enabled: dokuMethods.credit_card !== false },
            { code: 'bank_transfer', name: 'Bank Transfer', icon: '🏛️', enabled: dokuMethods.bank_transfer !== false }
          ]
        }
      ]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT: Update payment method type toggles
router.put('/admin/finance/payment-methods', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const { provider, method_type, enabled, branch_id } = req.body;
    if (!provider || !method_type) {
      return res.status(400).json({ success: false, error: 'provider and method_type are required.' });
    }

    const targetBranchId = req.user.role === 'branch_manager' ? (req.user.branch_id || req.user.branchId) : branch_id;
    const configKey = provider === 'midtrans' ? 'midtrans_methods' : 'doku_methods';

    let config = {};
    if (targetBranchId) {
      const branchRow = corePaymentRepo.findBranchPaymentConfig(targetBranchId, req.brand_id);
      if (branchRow && branchRow.payment_config_override) {
        try { config = JSON.parse(branchRow.payment_config_override) || {}; } catch (_) {}
      }
    } else {
      const brandConfig = corePaymentRepo.findBrandPaymentConfig(req.brand_id);
      if (brandConfig && brandConfig.default_payment_config) {
        try { config = JSON.parse(brandConfig.default_payment_config) || {}; } catch (_) {}
      }
    }
    if (!config[configKey]) config[configKey] = {};
    config[configKey][method_type] = Boolean(enabled);

    const jsonStr = JSON.stringify(config);
    if (targetBranchId) {
      corePaymentRepo.updateBranchPaymentConfig(targetBranchId, jsonStr);
    } else {
      corePaymentRepo.updateBrandPaymentConfig(req.brand_id, jsonStr);
    }

    res.json({ success: true, message: `${provider}/${method_type} ${enabled ? 'diaktifkan' : 'dinonaktifkan'}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Marketing Overview API
router.get('/admin/marketing/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const filter = {
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      start_date,
      end_date
    };

    const customerOverview = overviewReportingRepo.getCustomerOverview(filter);
    const customersList = overviewReportingRepo.getCustomersList(filter);

    let newCount = 0;
    let returningCount = 0;
    let repeatPurchaseRate = 0;
    if (Array.isArray(customersList) && customersList.length > 0) {
      newCount = customersList.filter(c => c.segment === 'new').length;
      returningCount = customersList.filter(c => c.segment === 'returning').length;
      repeatPurchaseRate = Math.round((returningCount / customersList.length) * 100);
    }

    const allPromos = corePromotionRepo.findAllPromotions(req.brand_id);
    const redemptions = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      limit: 10
    });

    const activePromosCount = allPromos.filter(p => p.is_active === 1).length;
    const totalBenefitSum = allPromos.reduce((acc, p) => acc + (p.total_benefit_amount || 0), 0);
    const totalRedemptionsSum = allPromos.reduce((acc, p) => acc + (p.redemptions_count || 0), 0);

    res.json({
      success: true,
      data: {
        customer_metrics: {
          total_customers: customerOverview.total_unique_customers || 0,
          new_customers: newCount,
          returning_customers: returningCount,
          repeat_purchase_rate_pct: repeatPurchaseRate
        },
        promotion_metrics: {
          active_promotions: activePromosCount,
          total_promotions: allPromos.length,
          total_redemptions: totalRedemptionsSum,
          total_benefit_amount: totalBenefitSum
        },
        recent_redemptions: redemptions.redemptions || [],
        campaigns: { supported: false, status: 'not_configured' },
        loyalty: { supported: false, status: 'not_configured' }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Marketing Promotions List API
router.get('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const isBM = req.user.role === 'branch_manager';
    const effectiveBranchId = isBM ? (req.user.branch_id || req.user.branchId) : null;
    const promotions = corePromotionRepo.findAllPromotions(req.brand_id, effectiveBranchId);
    const enrichedPromotions = promotions.map(p => {
      const rewards = (p.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      });
      return {
        ...p,
        rewards
      };
    });
    res.json({
      success: true,
      promotions: enrichedPromotions,
      total: enrichedPromotions.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// 6.00 STOREFRONT BANNERS — Content + Placement/Assignment APIs
// Content is Brand-scoped. Assignment is Branch-scoped. Promotion remains separate.
// ============================================================================
function bannerActor(req) {
  return {
    id: req.user && (req.user.userId || req.user.id),
    userId: req.user && (req.user.userId || req.user.id),
    role: req.user && req.user.role,
    branch_id: req.user && (req.user.branch_id || req.user.branchId),
    branchId: req.user && (req.user.branch_id || req.user.branchId),
    organization_id: req.brand && req.brand.organization_id
  };
}

function bannerMediaDelivery(brandId, mediaId) {
  if (!mediaId) {
    return { media_id: null, preview_url: null, srcset_variants: [] };
  }

  try {
    const asset = mediaService.getMedia({ mediaId, brandId });
    const variants = Array.isArray(asset.variants) ? asset.variants : [];
    const preview = variants.find(v => Number(v.width) >= 640) || variants[variants.length - 1] || null;
    return {
      media_id: mediaId,
      preview_url: preview ? preview.url : asset.url,
      srcset_variants: variants.map(v => ({
        url: v.url,
        width: v.width,
        height: v.height,
        name: v.name
      }))
    };
  } catch (_) {
    return { media_id: mediaId, preview_url: null, srcset_variants: [] };
  }
}

function parseLegacyBrandBanners(brand) {
  if (!brand || brand.banners === null || brand.banners === undefined || brand.banners === '') return [];
  try {
    const parsed = typeof brand.banners === 'string' ? JSON.parse(brand.banners) : brand.banners;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function bannerRowToAdminDto(row) {
  const published = row.published_revision_id ? {
    id: row.published_revision_id,
    revision_number: row.published_revision_number,
    title: row.published_title || '',
    alt_text: row.published_alt_text || '',
    media_id: row.published_media_id,
    cta_type: row.published_cta_type || 'NONE',
    cta_target_id: row.published_cta_target_id || null,
    cta_url: row.published_cta_url || null,
    promotion_id: row.published_promotion_id || null
  } : null;

  const draft = row.draft_revision_id ? {
    id: row.draft_revision_id,
    revision_number: row.draft_revision_number,
    title: row.draft_title || '',
    alt_text: row.draft_alt_text || '',
    media_id: row.draft_media_id,
    cta_type: row.draft_cta_type || 'NONE',
    cta_target_id: row.draft_cta_target_id || null,
    cta_url: row.draft_cta_url || null,
    promotion_id: row.draft_promotion_id || null
  } : null;

  const liveContent = published || draft;
  const media = bannerMediaDelivery(row.brand_id, liveContent ? liveContent.media_id : null);

  return {
    id: row.banner_id,
    banner_id: row.banner_id,
    title: liveContent ? liveContent.title : '',
    alt_text: liveContent ? liveContent.alt_text : '',
    publication_status: row.banner_publication_status || 'DRAFT',
    has_draft_changes: Boolean(draft && published),
    published_revision: published,
    draft_revision: draft,
    media,
    assignment: {
      id: row.id,
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      branch_timezone: row.branch_timezone || 'Asia/Jakarta',
      placement: row.placement,
      position: Number(row.position),
      active: Number(row.active) === 1,
      starts_at: row.starts_at || null,
      ends_at: row.ends_at || null,
      timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
      governance_locked: Number(row.governance_locked) === 1,
      effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
        published: row.banner_publication_status === 'PUBLISHED' && Boolean(row.published_revision_id),
        active: Number(row.active) === 1,
        startsAt: row.starts_at,
        endsAt: row.ends_at
      })
    }
  };
}

router.get('/admin/marketing/banners', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const requestedBranchId = req.query.branch_id || null;
    const rows = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: requestedBranchId,
      actor
    });

    const contentItems = bannerContentService.listBanners({ brandId: req.brand_id });
    const result = rows.map(bannerRowToAdminDto);
    const assignedBannerIds = new Set(result.map(item => item.banner_id));

    const includeUnassignedContent = actor.role !== 'branch_manager' && !requestedBranchId;

    for (const content of contentItems) {
      if (assignedBannerIds.has(content.id)) continue;
      if (!includeUnassignedContent) continue;
      const published = content.published_revision;
      const draft = content.draft_revision;
      const live = published || draft;
      const media = bannerMediaDelivery(req.brand_id, live ? live.media_id : null);
      result.push({
        id: content.id,
        banner_id: content.id,
        title: live ? live.title : '',
        alt_text: live ? live.alt_text : '',
        publication_status: content.publication_status,
        has_draft_changes: Boolean(draft && published),
        published_revision: published ? {
          id: published.id,
          revision_number: published.revision_number,
          title: published.title || '',
          alt_text: published.alt_text || '',
          media_id: published.media_id,
          cta_type: published.cta_type || 'NONE',
          cta_target_id: published.cta_target_id || null,
          cta_url: published.cta_url || null,
          promotion_id: published.promotion_id || null
        } : null,
        draft_revision: draft ? {
          id: draft.id,
          revision_number: draft.revision_number,
          title: draft.title || '',
          alt_text: draft.alt_text || '',
          media_id: draft.media_id,
          cta_type: draft.cta_type || 'NONE',
          cta_target_id: draft.cta_target_id || null,
          cta_url: draft.cta_url || null,
          promotion_id: draft.promotion_id || null
        } : null,
        media,
        assignment: null
      });
    }

    result.sort((a, b) => {
      const an = (a.assignment && a.assignment.branch_name) || '';
      const bn = (b.assignment && b.assignment.branch_name) || '';
      return an.localeCompare(bn) || Number(a.assignment?.position || 9999) - Number(b.assignment?.position || 9999);
    });

    var branches = bannerAssignmentService.repository.listBranches(req.brand_id);
    if (actor.role === 'branch_manager') {
      const ownBranchId = actor.branch_id || actor.branchId;
      branches = ownBranchId
        ? branches.filter(function (branch) { return String(branch.id) === String(ownBranchId); })
        : [];
    }

    const legacy = parseLegacyBrandBanners(req.brand);
    res.json({
      success: true,
      placement: 'HOME_BANNER_CAROUSEL',
      banners: result,
      branches,
      legacy: {
        available: legacy.length > 0,
        count: legacy.length,
        fallback_active: true
      }
    });
  } catch (err) {
    const status = ['FORBIDDEN_BRANCH_SCOPE', 'BRANCH_NOT_FOUND', 'ASSIGNMENT_GOVERNANCE_LOCKED'].includes(err.code) ? 403 : 500;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_LIST_ERROR' });
  }
});

router.get('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const content = bannerContentService.getBanner({
      brandId: req.brand_id,
      bannerId: req.params.bannerId
    });
    const assignments = bannerAssignmentService.listAssignments({
      brandId: req.brand_id,
      branchId: actor.role === 'branch_manager' ? actor.branch_id : null,
      actor
    }).filter(row => row.banner_id === req.params.bannerId);

    if (actor.role === 'branch_manager' && assignments.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN_BRANCH_SCOPE',
        message: 'Banner tidak ditugaskan pada cabang Branch Manager.'
      });
    }

    res.json({
      success: true,
      banner: {
        id: content.id,
        brand_id: content.brand_id,
        publication_status: content.publication_status,
        published_revision: content.published_revision,
        draft_revision: content.draft_revision,
        revisions: content.revisions || [],
        assignments: assignments.map(bannerRowToAdminDto).map(item => item.assignment),
        media: bannerMediaDelivery(
          req.brand_id,
          content.draft_revision?.media_id || content.published_revision?.media_id || null
        )
      }
    });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'ASSIGNMENT_NOT_FOUND' ? 404 : (err.code ? 403 : 500);
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DETAIL_ERROR' });
  }
});

router.post('/admin/marketing/banners', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.createDraft({
      brandId: req.brand_id,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.status(201).json({ success: true, banner });
  } catch (err) {
    const status = ['BANNER_NOT_FOUND', 'INVALID_PRODUCT_REFERENCE', 'INVALID_CATEGORY_REFERENCE', 'INVALID_PROMOTION_REFERENCE'].includes(err.code)
      ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_CREATE_ERROR' });
  }
});

router.patch('/admin/marketing/banners/:bannerId/draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const {
      media_id,
      title = '',
      alt_text = '',
      cta_type = 'NONE',
      cta_target_id = null,
      cta_url = null,
      promotion_id = null
    } = req.body || {};

    const banner = await bannerContentService.updateDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role,
      mediaId: media_id,
      title,
      altText: alt_text,
      ctaType: cta_type,
      ctaTargetId: cta_target_id,
      ctaUrl: cta_url,
      promotionId: promotion_id
    });

    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DRAFT_UPDATE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/publish', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.publishDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_PUBLISH_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/discard-draft', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const banner = await bannerContentService.discardDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json({ success: true, banner });
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' || err.code === 'DRAFT_NOT_FOUND' ? 404
      : err.code === 'DISCARD_REQUIRES_PUBLISHED' ? 409
      : 400;
    res.status(status).json({
      success: false,
      error: err.message,
      code: err.code || 'BANNER_DISCARD_DRAFT_ERROR'
    });
  }
});

router.delete('/admin/marketing/banners/:bannerId', requireAuth(['owner', 'brand_manager']), async (req, res) => {
  try {
    const actor = bannerActor(req);
    const result = await bannerContentService.deleteDraft({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actorId: actor.id,
      actorRole: actor.role
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'BANNER_NOT_FOUND' ? 404
      : ['BANNER_ASSIGNMENTS_EXIST', 'PUBLISHED_BANNER_DELETE_FORBIDDEN'].includes(err.code) ? 409
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'BANNER_DELETE_ERROR' });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignment = bannerAssignmentService.createAssignment({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchId: req.body && req.body.branch_id,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });
    res.status(201).json({
      success: true,
      assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment)
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_CREATE_ERROR', conflict: err.conflict || null });
  }
});

router.post('/admin/marketing/banners/:bannerId/assignments/bulk', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const assignments = bannerAssignmentService.createAssignmentsBulk({
      brandId: req.brand_id,
      bannerId: req.params.bannerId,
      actor,
      branchIds: req.body && req.body.branch_ids,
      placement: req.body && req.body.placement,
      position: req.body && req.body.position,
      active: req.body && req.body.active !== undefined ? req.body.active : true,
      startsAtLocal: req.body && (req.body.starts_at_local || req.body.startsAtLocal),
      endsAtLocal: req.body && (req.body.ends_at_local || req.body.endsAtLocal),
      governanceLocked: req.body && req.body.governance_locked
    });

    res.status(201).json({
      success: true,
      assignments: assignments.map(item => bannerAssignmentDtoForResponse(req.brand_id, item))
    });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : ['BRANCH_NOT_FOUND', 'BANNER_NOT_FOUND'].includes(err.code) ? 404
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_BULK_ERROR', conflict: err.conflict || null });
  }
});

router.patch('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }

    const assignment = bannerAssignmentService.updateAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor,
      position: req.body && req.body.position !== undefined ? req.body.position : null,
      active: req.body && req.body.active !== undefined ? req.body.active : null,
      startsAtLocal: req.body && (req.body.starts_at_local !== undefined ? req.body.starts_at_local : undefined),
      endsAtLocal: req.body && (req.body.ends_at_local !== undefined ? req.body.ends_at_local : undefined),
      governanceLocked: req.body && req.body.governance_locked !== undefined ? req.body.governance_locked : null
    });
    res.json({ success: true, assignment: bannerAssignmentDtoForResponse(req.brand_id, assignment) });
  } catch (err) {
    const status = err.code === 'BANNER_POSITION_CONFLICT' ? 409
      : err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_UPDATE_ERROR', conflict: err.conflict || null });
  }
});

router.delete('/admin/marketing/banners/:bannerId/assignments/:assignmentId', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const actor = bannerActor(req);
    const current = bannerAssignmentService.getBannerAssignment(req.brand_id, req.params.assignmentId);
    if (current.banner_id !== req.params.bannerId) {
      return res.status(404).json({ success: false, error: 'Banner Assignment tidak ditemukan.', code: 'ASSIGNMENT_NOT_FOUND' });
    }
    const result = bannerAssignmentService.deleteAssignment({
      brandId: req.brand_id,
      assignmentId: req.params.assignmentId,
      actor
    });
    res.json(result);
  } catch (err) {
    const status = err.code === 'ASSIGNMENT_NOT_FOUND' ? 404
      : err.code === 'ASSIGNMENT_GOVERNANCE_LOCKED' ? 403
      : err.code && String(err.code).indexOf('FORBIDDEN') === 0 ? 403
      : 400;
    res.status(status).json({ success: false, error: err.message, code: err.code || 'ASSIGNMENT_DELETE_ERROR' });
  }
});

// Helper kept local to the API boundary for response consistency.
function bannerAssignmentDtoForResponse(brandId, assignment) {
  const row = bannerAssignmentService.getBannerAssignment(brandId, assignment.id);
  const published = row.banner_publication_status === 'PUBLISHED';
  return {
    id: row.id,
    banner_id: row.banner_id,
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    branch_timezone: row.branch_timezone || 'Asia/Jakarta',
    placement: row.placement,
    position: Number(row.position),
    active: Number(row.active) === 1,
    starts_at: row.starts_at || null,
    ends_at: row.ends_at || null,
    timezone: row.branch_timezone || row.timezone || 'Asia/Jakarta',
    governance_locked: Number(row.governance_locked) === 1,
    effective_status: require('../../domains/banner/services/BannerDateTime').effectiveStatus({
      published: published,
      active: Number(row.active) === 1,
      startsAt: row.starts_at,
      endsAt: row.ends_at
    })
  };
}

// 6.01 Create Marketing Promotion (Owner / Brand Manager)

router.post('/admin/marketing/promotions', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const {
      id,
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Nama promosi wajib diisi.' });
    }

    if (start_at && end_at) {
      const sTime = new Date(start_at).getTime();
      const eTime = new Date(end_at).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    const safeBranchIds = Array.isArray(branch_ids) ? branch_ids : [];
    if (safeBranchIds.length > 0) {
      const placeholders = safeBranchIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...safeBranchIds);
      if (rows.length !== safeBranchIds.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const created = corePromotionRepo.createPromotion({
      id,
      brandId: req.brand_id,
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : null,
      capabilityType: capability_type || 'install_incentive',
      stackingPolicy: stacking_policy || 'exclusive',
      priorityWeight: priority_weight !== undefined ? Number(priority_weight) : 100,
      maxRedemptionsTotal: max_redemptions_total ? Number(max_redemptions_total) : null,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? Number(max_redemptions_per_customer) : 1,
      startAt: start_at || null,
      endAt: end_at || null,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : 1,
      rules: Array.isArray(rules) ? rules : [],
      rewards: Array.isArray(rewards) ? rewards : [],
      branchIds: safeBranchIds
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_CREATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: created.id,
        name: created.name,
        branch_ids: safeBranchIds
      }
    });

    res.status(201).json({
      success: true,
      promotion: created
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02 Update Marketing Promotion (Owner / Brand Manager)
router.put('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      name,
      code,
      capability_type,
      stacking_policy,
      priority_weight,
      max_redemptions_total,
      max_redemptions_per_customer,
      start_at,
      end_at,
      is_active,
      rules,
      rewards,
      branch_ids
    } = req.body;

    const effectiveStartAt = start_at !== undefined ? start_at : existing.start_at;
    const effectiveEndAt = end_at !== undefined ? end_at : existing.end_at;
    if (effectiveStartAt && effectiveEndAt) {
      const sTime = new Date(effectiveStartAt).getTime();
      const eTime = new Date(effectiveEndAt).getTime();
      if (eTime < sTime) {
        return res.status(400).json({ success: false, error: 'Tanggal berakhir promosi tidak boleh lebih awal dari tanggal mulai.' });
      }
    }

    if (Array.isArray(branch_ids) && branch_ids.length > 0) {
      const placeholders = branch_ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
      if (rows.length !== branch_ids.length) {
        return res.status(403).json({
          success: false,
          error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
        });
      }
    }

    if (Array.isArray(rewards) && rewards.length > 0) {
      for (const rw of rewards) {
        if (rw.target_product_id) {
          const prod = db.prepare('SELECT id FROM products WHERE id = ? AND brand_id = ?').get(rw.target_product_id, req.brand_id);
          if (!prod) {
            return res.status(400).json({
              success: false,
              error: 'Produk reward tidak valid atau bukan milik brand ini.'
            });
          }
        }
      }
    }

    const updated = corePromotionRepo.updatePromotion(promotionId, req.brand_id, {
      name: name !== undefined ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim().toUpperCase() : null) : undefined,
      stackingPolicy: stacking_policy,
      priorityWeight: priority_weight,
      maxRedemptionsTotal: max_redemptions_total !== undefined ? (max_redemptions_total ? Number(max_redemptions_total) : null) : undefined,
      maxRedemptionsPerCustomer: max_redemptions_per_customer !== undefined ? (max_redemptions_per_customer ? Number(max_redemptions_per_customer) : null) : undefined,
      startAt: start_at,
      endAt: end_at,
      isActive: is_active !== undefined ? (is_active ? 1 : 0) : undefined,
      rules,
      rewards,
      branchIds: branch_ids
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        is_active: is_active !== undefined ? (is_active ? 1 : 0) : undefined
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.02b Update Promotion Presentation Payload specifically (Owner / Brand Manager)
router.patch('/admin/marketing/promotions/:id/presentation', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    const {
      banner_title,
      banner_subtitle,
      reward_title,
      reward_badge_text,
      cta_text,
      media_id,
      icon_url
    } = req.body || {};

    const presentationUpdates = {};

    if (banner_title !== undefined) {
      presentationUpdates.banner_title = typeof banner_title === 'string' ? banner_title.trim() : '';
    }
    if (banner_subtitle !== undefined) {
      presentationUpdates.banner_subtitle = typeof banner_subtitle === 'string' ? banner_subtitle.trim() : '';
    }
    if (cta_text !== undefined) {
      presentationUpdates.cta_text = typeof cta_text === 'string' ? cta_text.trim() : '';
    }
    if (reward_title !== undefined) {
      presentationUpdates.reward_title = typeof reward_title === 'string' ? reward_title.trim() : '';
    }
    if (reward_badge_text !== undefined) {
      presentationUpdates.reward_badge_text = typeof reward_badge_text === 'string' ? reward_badge_text.trim() : '';
    }

    // Media verification if media_id is provided
    if (media_id !== undefined) {
      if (media_id) {
        let asset = null;
        try {
          asset = mediaService.getMedia({ mediaId: media_id, brandId: req.brand_id });
        } catch (mediaErr) {
          const status = mediaErr.code === 'UNAUTHORIZED_TENANT' ? 403 : 400;
          return res.status(status).json({
            success: false,
            error: mediaErr.message || 'Aset media tidak valid.',
            code: mediaErr.code || 'MEDIA_ERROR'
          });
        }

        if (asset.status !== 'ready') {
          return res.status(400).json({
            success: false,
            error: 'Aset media belum selesai diproses (status harus READY).',
            code: 'MEDIA_NOT_READY'
          });
        }

        presentationUpdates.media_id = media_id;
        presentationUpdates.icon_url = asset.url;
      } else {
        presentationUpdates.media_id = null;
        presentationUpdates.icon_url = icon_url || null;
      }
    } else if (icon_url !== undefined) {
      presentationUpdates.icon_url = icon_url;
    }

    const updated = corePromotionRepo.updatePresentationPayload(promotionId, req.brand_id, presentationUpdates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Gagal memperbarui presentasi promosi.' });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_PRESENTATION_UPDATED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: {
        promotion_id: promotionId,
        presentation_keys: Object.keys(presentationUpdates)
      }
    });

    const enrichedUpdated = {
      ...updated,
      rewards: (updated.rewards || []).map(r => {
        let pres = {};
        if (r.presentation_payload) {
          try {
            pres = typeof r.presentation_payload === 'string'
              ? JSON.parse(r.presentation_payload)
              : r.presentation_payload;
          } catch (_) {}
        }
        let delivery = null;
        if (pres.media_id) {
          delivery = bannerMediaDelivery(req.brand_id, pres.media_id);
        }
        return {
          ...r,
          presentation: pres,
          presentation_delivery: delivery
        };
      })
    };

    res.json({
      success: true,
      promotion: enrichedUpdated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.03 Delete / Deactivate Marketing Promotion (Owner / Brand Manager)
router.delete('/admin/marketing/promotions/:id', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const existing = corePromotionRepo.findPromotion(promotionId);
    if (!existing || existing.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Safety Audit: block hard delete if redemptions exist to preserve immutable audit trail
    const redemptionRow = db.prepare('SELECT COUNT(*) as count FROM promotion_redemptions WHERE promotion_id = ?').get(promotionId);
    if (redemptionRow && Number(redemptionRow.count) > 0) {
      return res.status(409).json({
        success: false,
        error: 'Promosi tidak dapat dihapus karena memiliki riwayat penebusan pesanan. Silakan nonaktifkan promosi sebagai gantinya.'
      });
    }

    corePromotionRepo.deletePromotion(promotionId, req.brand_id);

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_DELETED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, name: existing.name }
    });

    res.json({
      success: true,
      message: 'Promosi berhasil dihapus.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.1 Assign/Update Branch Scopes for Promotion (Owner / Brand Manager only)
router.post('/admin/marketing/promotions/:id/scopes', requireAuth(['owner', 'brand_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { branch_ids, is_active = 1 } = req.body;

    if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'branch_ids must be a non-empty array.' });
    }

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    // Strict validation: every branch_id must belong to req.brand_id
    const placeholders = branch_ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id FROM branches WHERE brand_id = ? AND id IN (${placeholders})`).all(req.brand_id, ...branch_ids);
    if (rows.length !== branch_ids.length) {
      return res.status(403).json({
        success: false,
        error: 'Satu atau lebih cabang tidak valid atau bukan milik brand ini.'
      });
    }

    for (const branchId of branch_ids) {
      corePromotionRepo.assignBranchScope({
        promotionId,
        brandId: req.brand_id,
        branchId,
        isActive: is_active
      });
    }

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_SCOPE_ASSIGNED',
      brand_id: req.brand_id,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, branch_ids, is_active }
    });

    const scopes = corePromotionRepo.findBranchScopes(promotionId);
    res.json({
      success: true,
      promotion_id: promotionId,
      scopes
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6.2 Toggle Promotion Branch Activation (BM can only modify their own assigned branch; Owner/Brand Manager can modify any branch)
router.patch('/admin/marketing/promotions/:id/branch-activation', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const promotionId = req.params.id;
    const { is_active } = req.body;
    let targetBranchId = req.body.branch_id;

    const promo = corePromotionRepo.findPromotion(promotionId);
    if (!promo || promo.brand_id !== req.brand_id) {
      return res.status(404).json({ success: false, error: 'Promosi tidak ditemukan.' });
    }

    if (req.user.role === 'branch_manager') {
      const userBranchId = req.user.branch_id || req.user.branchId;
      if (!userBranchId) {
        return res.status(403).json({ success: false, error: 'Branch Manager must be assigned to a branch.' });
      }
      if (targetBranchId && String(targetBranchId) !== String(userBranchId)) {
        return res.status(403).json({ success: false, error: 'Branch Manager cannot modify promotions for other branches.' });
      }
      targetBranchId = userBranchId;
    }

    if (!targetBranchId) {
      return res.status(400).json({ success: false, error: 'branch_id is required.' });
    }

    // Verify target branch belongs to caller's brand
    const branchRecord = db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(targetBranchId, req.brand_id);
    if (!branchRecord) {
      return res.status(403).json({ success: false, error: 'Cabang bukan milik brand ini.' });
    }

    const existingScope = corePromotionRepo.findBranchScope(promotionId, targetBranchId);
    if (!existingScope) {
      return res.status(404).json({ success: false, error: 'Promotion is not scoped to this branch.' });
    }

    const newActiveState = (is_active === 1 || is_active === true) ? 1 : 0;

    // Prerequisite validation when activating: reward products must be available in target branch catalog
    if (newActiveState === 1) {
      const rewards = corePromotionRepo.findRewards(promotionId);
      for (const reward of rewards) {
        if (reward.reward_type === 'freebie_product' || reward.target_product_id) {
          const targetPid = reward.target_product_id;
          if (!targetPid) {
            return res.status(422).json({
              success: false,
              error: 'Promo belum dapat diaktifkan karena definisi produk hadiah tidak valid.'
            });
          }

          const product = db.prepare('SELECT id, name, brand_id, is_active FROM products WHERE id = ? AND brand_id = ?').get(targetPid, req.brand_id);
          if (!product || product.is_active === 0) {
            const prodName = product?.name || `ID ${targetPid}`;
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${prodName}' belum tersedia di katalog brand ini.`
            });
          }

          const bp = db.prepare('SELECT is_available, stock FROM branch_products WHERE branch_id = ? AND product_id = ?').get(targetBranchId, targetPid);
          if (!bp) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' belum tersedia di katalog cabang ini.`
            });
          }

          if (bp.is_available !== 1) {
            return res.status(422).json({
              success: false,
              error: `Promo belum dapat diaktifkan karena produk hadiah '${product.name}' sedang dinonaktifkan di cabang ini.`
            });
          }
        }
      }
    }

    corePromotionRepo.setBranchScopeActivation({
      promotionId,
      branchId: targetBranchId,
      isActive: newActiveState
    });

    logPromotionSecurityEvent({
      actor_id: req.user?.id || req.session?.userId,
      actor_role: req.user?.role,
      action: 'PROMOTION_BRANCH_ACTIVATED',
      brand_id: req.brand_id,
      branch_id: targetBranchId,
      result: 'SUCCESS',
      metadata: { promotion_id: promotionId, is_active: newActiveState }
    });

    res.json({
      success: true,
      promotion_id: promotionId,
      branch_id: targetBranchId,
      is_active: newActiveState
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Marketing Promotion Redemptions API
router.get('/admin/marketing/redemptions', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, promotion_id, limit, offset } = req.query;
    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const result = corePromotionRepo.findPromotionRedemptions({
      brandId: req.brand_id,
      branchId: effectiveBranchId,
      promotionId: promotion_id || null,
      limit,
      offset
    });

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// DINE-IN TABLE FLOOR PLAN & OPERATIONAL DOMAIN APIS
// =========================================================================
const { DiningTableService, TableRecommendationService } = require('../../domains/pos');

// Customer / Public / Staff: Get Branch Floor Plan & Operational Table State

};
