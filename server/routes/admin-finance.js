/**
 * XENTRA CORE — ADMIN FINANCE ROUTES
 *
 * Financial overview, transaction/reconciliation reporting and payment-method
 * configuration. Payment persistence stays inside the canonical repository.
 */
module.exports = function registerAdminFinanceRoutes(router, deps) {
  const {
    requireAuth,
    corePaymentRepo
  } = deps;

  const { ReportingEngine } = require('../../domains/reporting');
  const { ReportingRepository } = require('../../core/data/repositories');
  const overviewReportingRepo = new ReportingRepository();

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
    const qrisStaticSettled = paymentReport.summary?.qris_static_settled || 0;
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
          qris_static_settled: qrisStaticSettled,
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
          code: 'qris_static',
          name: 'QRIS Statis',
          provider: 'qris_static',
          is_enabled: Boolean(effectiveConfig.qris_static && effectiveConfig.qris_static.image_url),
          type: 'static_manual',
          settlement_mode: 'manual_cashier',
          description: 'QRIS statis merchant untuk pembayaran manual/fallback di POS',
          image_url: (effectiveConfig.qris_static && effectiveConfig.qris_static.image_url) || effectiveConfig.qris_static_image_url || null,
          merchant_name: (effectiveConfig.qris_static && effectiveConfig.qris_static.merchant_name) || '',
          instructions: (effectiveConfig.qris_static && effectiveConfig.qris_static.instructions) || ''
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
};
