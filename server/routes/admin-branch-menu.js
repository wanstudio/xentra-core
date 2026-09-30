'use strict';

const MasterMenuResolver = require('../../domains/catalog/services/MasterMenuResolver');

function registerAdminBranchMenuRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const resolver = deps.resolver || MasterMenuResolver;
  const db = deps.db;

  router.get('/admin/branches/:id/menu', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const branchId = String(req.params.id || '').trim();
      if (!branchId) {
        return res.status(400).json({ success: false, error: 'BRANCH_REQUIRED' });
      }

      if (req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && String(assignedBranchId) !== branchId) {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
          });
        }
      }

      const menu = resolver.resolveBranchMenu({
        brandId: req.brand_id,
        branchId,
        // The Merchant App menu must also see deactivated Branch Categories, otherwise its
        // "Nonaktif" tab has nothing to list and the category could not be reactivated.
        includeInactiveCategories: true
      });

      const branch = db.prepare(
        'SELECT id, brand_id, name, slug, address_text, is_active FROM branches WHERE id = ? AND brand_id = ?'
      ).get(branchId, req.brand_id);

      if (!branch) {
        return res.status(404).json({
          success: false,
          error: 'BRANCH_NOT_FOUND'
        });
      }

      const adoptedIds = new Set((menu.products || []).map(product => String(product.product_id)));
      const master = resolver.resolveMasterMenu({ brandId: req.brand_id });
      const availableMasterProducts = (master.products || []).filter(
        product => !adoptedIds.has(String(product.product_id))
      );

      const adoptedProducts = (menu.products || []).map(function (product) {
        return Object.assign({}, product, { menu_composition: product });
      });
      const availableProducts = availableMasterProducts.map(function (product) {
        return Object.assign({}, product, { menu_composition: product });
      });

      return res.json({
        success: true,
        branch,
        categories: menu.categories || [],
        adopted_products: adoptedProducts,
        available_master_products: availableProducts
      });
    } catch (err) {
      console.error('[API Error GET /admin/branches/:id/menu]:', err);
      return res.status(500).json({
        success: false,
        error: err && err.message ? err.message : 'BRANCH_MENU_READ_FAILED'
      });
    }
  });
}

module.exports = registerAdminBranchMenuRoutes;
