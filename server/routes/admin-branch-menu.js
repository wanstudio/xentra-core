'use strict';

const { ComposedMenuResolver, ComposedMenuService } = require('../../domains/catalog');

function registerAdminBranchMenuRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const db = deps.db;
  const resolver = deps.resolver || ComposedMenuResolver;
  const service = deps.service || ComposedMenuService;
  const roles = ['owner', 'brand_manager', 'branch_manager'];

  function assertBranchScope(req, branchId) {
    if (req.user && req.user.role === 'branch_manager') {
      const assignedBranchId = req.user.branchId || req.user.branch_id;
      if (assignedBranchId && String(assignedBranchId) !== String(branchId)) return false;
    }
    return true;
  }

  function branchExists(req, branchId) {
    return db.prepare(
      'SELECT id, brand_id, name, slug, address_text, is_active FROM branches WHERE id = ? AND brand_id = ?'
    ).get(branchId, req.brand_id);
  }

  // Canonical Branch Menu read model. Commercial identity = Menu.
  router.get('/admin/branches/:id/menu', requireAuth(roles), (req, res) => {
    try {
      const branchId = String(req.params.id || '').trim();
      if (!branchId) return res.status(400).json({ success: false, error: 'BRANCH_REQUIRED' });
      if (!assertBranchScope(req, branchId)) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE', message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.' });
      }

      const branch = branchExists(req, branchId);
      if (!branch) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });

      const adopted = resolver.resolveBranchMenu({
        brandId: req.brand_id,
        branchId,
        includeUnavailable: true
      });
      const allMasterMenus = resolver.resolveMasterMenu({ brandId: req.brand_id });
      const adoptedIds = new Set(adopted.map(menu => String(menu.menu_id)));
      const availableMasterMenus = allMasterMenus.filter(menu => !adoptedIds.has(String(menu.menu_id)) && menu.is_available !== false);

      const categories = db.prepare(
        'SELECT id, brand_id, branch_id, name, slug, image_url, sort_order, COALESCE(is_active, 1) AS is_active FROM branch_categories WHERE branch_id = ? AND brand_id = ? ORDER BY sort_order ASC, name ASC'
      ).all(branchId, req.brand_id);

      const membershipRows = db.prepare(
        'SELECT bmc.menu_id, bmc.branch_category_id, bc.name AS branch_category_name, bc.slug AS branch_category_slug, COALESCE(bc.is_active, 1) AS branch_category_is_active ' +
        'FROM branch_menu_categories bmc ' +
        'JOIN branch_categories bc ON bc.id = bmc.branch_category_id AND bc.branch_id = bmc.branch_id AND bc.brand_id = ? ' +
        'WHERE bmc.branch_id = ? ' +
        'ORDER BY bc.sort_order ASC, bc.name ASC, bmc.menu_id ASC'
      ).all(req.brand_id, branchId);

      const categoryMap = new Map();
      for (const row of membershipRows) {
        const key = String(row.menu_id);
        if (!categoryMap.has(key)) categoryMap.set(key, []);
        categoryMap.get(key).push({
          id: row.branch_category_id,
          name: row.branch_category_name,
          slug: row.branch_category_slug,
          is_active: row.branch_category_is_active !== 0
        });
      }

      function enrichMenu(menu) {
        const cats = categoryMap.get(String(menu.menu_id)) || [];
        // Menu presentation media belongs to the Menu. There is deliberately no fallback to a
        // component Product image (docs/decisions/xentra-menu-presentation-media-v1.md).
        return Object.assign({}, menu, {
          name: menu.title || 'Menu',
          image_url: menu.image_url || '',
          menu_composition: menu,
          category_ids: cats.map(c => String(c.id)),
          categories: cats
        });
      }

      const adoptedMenus = adopted.map(enrichMenu);
      const availableMenus = availableMasterMenus.map(enrichMenu);

      // Compatibility aliases only. Their values are canonical Menu objects;
      // the forward surface no longer reads branch_products.
      return res.json({
        success: true,
        model: 'branch-menu-v1',
        branch,
        categories,
        adopted_menus: adoptedMenus,
        available_master_menus: availableMenus,
        adopted_products: adoptedMenus,
        available_master_products: availableMenus
      });
    } catch (err) {
      console.error('[API Error GET /admin/branches/:id/menu]:', err);
      return res.status(500).json({ success: false, error: err && err.message ? err.message : 'BRANCH_MENU_READ_FAILED' });
    }
  });

  // Canonical optional Branch Menu display-name override.
  router.patch('/admin/branches/:branchId/menu/:menuId/display-name', requireAuth(roles), (req, res) => {
    try {
      const branchId = String(req.params.branchId || '').trim();
      const menuId = String(req.params.menuId || '').trim();
      if (!branchId || !menuId) return res.status(400).json({ success: false, error: 'BRANCH_AND_MENU_REQUIRED' });
      if (!assertBranchScope(req, branchId)) return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      if (!branchExists(req, branchId)) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'name')) {
        return res.status(400).json({ success: false, error: 'DISPLAY_NAME_REQUIRED' });
      }

      const result = service.setBranchMenuDisplayName({
        brandId: req.brand_id,
        branchId,
        menuId,
        name: req.body.name
      });
      return res.json({
        success: true,
        branch_id: branchId,
        menu_id: menuId,
        display_name_override: result.display_name_override || null,
        display_name: result.display_name_override || null
      });
    } catch (err) {
      const status = ['BRANCH_MENU_NOT_FOUND', 'MENU_NOT_FOUND', 'BRANCH_NOT_FOUND'].includes(err && err.message) ? 404 : 400;
      return res.status(status).json({ success: false, error: err && err.message ? err.message : 'DISPLAY_NAME_UPDATE_FAILED' });
    }
  });

  // Canonical Branch Menu removal.
  router.delete('/admin/branches/:branchId/menu/:menuId', requireAuth(roles), (req, res) => {
    try {
      const branchId = String(req.params.branchId || '').trim();
      const menuId = String(req.params.menuId || '').trim();
      if (!branchId || !menuId) return res.status(400).json({ success: false, error: 'BRANCH_AND_MENU_REQUIRED' });
      if (!assertBranchScope(req, branchId)) return res.status(403).json({ success: false, error: 'FORBIDDEN_BRANCH_SCOPE' });
      if (!branchExists(req, branchId)) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });

      const result = service.removeMenuFromBranch({ brandId: req.brand_id, branchId, menuId });
      return res.json({ success: true, ...result });
    } catch (err) {
      const status = ['BRANCH_MENU_NOT_FOUND', 'MENU_NOT_FOUND', 'BRANCH_NOT_FOUND'].includes(err && err.message) ? 404 : 400;
      return res.status(status).json({ success: false, error: err && err.message ? err.message : 'BRANCH_MENU_REMOVE_FAILED' });
    }
  });
}

module.exports = registerAdminBranchMenuRoutes;
