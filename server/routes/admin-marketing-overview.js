/**
 * XENTRA CORE — ADMIN MARKETING OVERVIEW ROUTES
 *
 * Customer and promotion summary for the owner/manager marketing surface.
 */
'use strict';

module.exports = function registerAdminMarketingOverviewRoutes(router, deps) {
  const { requireAuth, corePromotionRepo } = deps;
  const { ReportingRepository } = require('../../core/data/repositories');
  const overviewReportingRepo = new ReportingRepository();

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

};
