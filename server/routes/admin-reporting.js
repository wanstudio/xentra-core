/**
 * XENTRA CORE — ADMIN REPORTING ROUTES
 *
 * Analytics, operational overview, generic reports and customer reporting
 * endpoints. Reporting logic remains in ReportingEngine/repositories.
 */
module.exports = function registerAdminReportingRoutes(router, deps) {
  const {
    db,
    requireAuth
  } = deps;

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

// Phase 4: Owner Overview API — Real authoritative business metrics
const { ReportingRepository } = require('../../core/data/repositories');
const overviewReportingRepo = new ReportingRepository();

router.get('/admin/overview', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
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

    // 1. Primary KPIs
    const salesOverview = overviewReportingRepo.getSalesOverview(filter);
    const customerOverview = overviewReportingRepo.getCustomerOverview(filter);

    const netSales = salesOverview.gross_revenue || 0;
    const ordersCount = salesOverview.total_orders || 0;
    const customersCount = customerOverview.total_unique_customers || 0;
    const aov = salesOverview.average_order_value || 0;

    // 2. Sales Performance
    const timeline = overviewReportingRepo.getSalesTimeline(filter);
    const byChannel = overviewReportingRepo.getSalesByChannel(filter);
    const byFulfillment = overviewReportingRepo.getSalesByFulfillment(filter);

    // 3. Branch Performance (Only for Owner/Brand Manager if All Branches, or scoped to branch)
    let branchPerformance = [];
    if (req.user.role !== 'branch_manager') {
      branchPerformance = overviewReportingRepo.getBranchComparison({
        brand_id: req.brand_id,
        start_date,
        end_date
      });
    }

    // 4. Top Products
    const topProducts = overviewReportingRepo.getTopProducts(filter).slice(0, 5);

    // 5. Needs Attention (e.g. low stock alerts)
    const lowStockItems = overviewReportingRepo.getLowStockItems(filter).slice(0, 10);

    res.json({
      success: true,
      data: {
        kpis: {
          net_sales: netSales,
          orders: ordersCount,
          customers: customersCount,
          aov: Math.round(aov)
        },
        sales_performance: {
          timeline,
          by_channel: byChannel,
          by_fulfillment: byFulfillment
        },
        branch_performance: branchPerformance,
        top_products: topProducts,
        needs_attention: {
          low_stock_items: lowStockItems,
          low_stock_count: lowStockItems.length
        }
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
      orders: ['owner', 'brand_manager', 'branch_manager'],
      customers: ['owner', 'brand_manager'],
      operations: ['owner', 'brand_manager', 'branch_manager'],
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

// Phase 5: Owner Dashboard Customers APIs (Authoritative Core Data)
router.get('/admin/customers', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { branch_id, search, segment } = req.query;

    let effectiveBranchId = branch_id;
    if (req.user.role === 'branch_manager') {
      effectiveBranchId = req.user.branch_id || req.user.branchId;
    }

    const customers = overviewReportingRepo.getCustomersList({
      brand_id: req.brand_id,
      branch_id: effectiveBranchId,
      search: search ? String(search).trim() : null
    });

    let filtered = customers;
    if (segment === 'new') {
      filtered = customers.filter(c => c.segment === 'new');
    } else if (segment === 'returning') {
      filtered = customers.filter(c => c.segment === 'returning');
    }

    res.json({
      success: true,
      customers: filtered,
      total: filtered.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/admin/customers/:id', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
  try {
    const { id } = req.params;
    let branchId = req.query.branch_id;
    if (req.user.role === 'branch_manager') {
      branchId = req.user.branch_id || req.user.branchId;
    }

    const customer = overviewReportingRepo.getCustomerDetail(req.brand_id, id, branchId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Data pelanggan tidak ditemukan untuk identifier yang diberikan.'
      });
    }

    res.json({
      success: true,
      customer
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

};
