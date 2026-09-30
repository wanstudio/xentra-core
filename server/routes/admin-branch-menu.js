'use strict';

const MasterMenuResolver = require('../../domains/catalog/services/MasterMenuResolver');

function registerAdminBranchMenuRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const resolver = deps.resolver || MasterMenuResolver;
  const db = deps.db;

  router.patch('/admin/branches/:id/menu/:productId/display-name', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const branchId = String(req.params.id || '').trim();
      const productId = String(req.params.productId || '').trim();
      if (!branchId || !productId) {
        return res.status(400).json({ success: false, error: 'BRANCH_AND_PRODUCT_REQUIRED' });
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

      const branch = db.prepare(
        'SELECT id FROM branches WHERE id = ? AND brand_id = ?'
      ).get(branchId, req.brand_id);
      if (!branch) {
        return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      }

      const adopted = db.prepare(
        'SELECT bp.product_id, p.name AS master_name, bp.name_override FROM branch_products bp JOIN products p ON p.id = bp.product_id AND p.brand_id = ? WHERE bp.branch_id = ? AND bp.product_id = ?'
      ).get(req.brand_id, branchId, productId);
      if (!adopted) {
        return res.status(404).json({
          success: false,
          error: 'PRODUCT_NOT_ADOPTED',
          message: 'Produk belum diadopsi ke cabang ini.'
        });
      }

      const rawName = req.body && Object.prototype.hasOwnProperty.call(req.body, 'name')
        ? req.body.name
        : undefined;
      if (rawName === undefined) {
        return res.status(400).json({ success: false, error: 'DISPLAY_NAME_REQUIRED' });
      }

      const displayName = rawName == null ? null : String(rawName).trim() || null;
      if (displayName && displayName.length > 100) {
        return res.status(400).json({
          success: false,
          error: 'DISPLAY_NAME_TOO_LONG',
          message: 'Nama tampilan maksimal 100 karakter.'
        });
      }

      db.prepare(
        'UPDATE branch_products SET name_override = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?'
      ).run(displayName, branchId, productId);

      res.json({
        success: true,
        branch_id: branchId,
        product_id: productId,
        master_name: adopted.master_name,
        display_name_override: displayName,
        display_name: displayName || adopted.master_name
      });
    } catch (err) {
      console.error('[API Error PATCH /admin/branches/:id/menu/:productId/display-name]:', err);
      res.status(500).json({
        success: false,
        error: err && err.message ? err.message : 'DISPLAY_NAME_UPDATE_FAILED'
      });
    }
  });

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
        includeInactiveCategories: true,
        exposeBranchPresentationOverrides: true
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
