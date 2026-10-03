/**
 * XENTRA CORE — PUBLIC CATALOG ROUTES
 *
 * Canonical customer-facing menu endpoint. Catalog ownership/availability comes
 * from CatalogService; media delivery is resolved through the injected batch helper.
 */
module.exports = function registerCatalogRoutes(router, deps) {
  const { db, ComposedMenuResolver } = deps;


// Forward Product → Menu → Inventory read boundary.
// Kept additive until checkout/POS consumers are migrated to menu_id.
router.get('/catalog/composed-menu', (req, res) => {
  try {
    if (!ComposedMenuResolver) {
      return res.status(503).json({ success: false, error: 'COMPOSED_MENU_NOT_READY' });
    }

    const brandId = req.brand_id;
    const branchId = req.query && req.query.branch_id ? String(req.query.branch_id).trim() : '';
    const includeUnavailable = req.query && (req.query.include_unavailable === '1' || req.query.include_unavailable === 'true');

    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) return res.status(400).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      if (branch.is_active === 0) return res.status(400).json({ success: false, error: 'BRANCH_INACTIVE' });
    }

    const menus = branchId
      ? ComposedMenuResolver.resolveBranchMenu({ brandId, branchId, includeUnavailable })
      : ComposedMenuResolver.resolveMasterMenu({ brandId });

    const categoriesMap = new Map();
    for (const menu of menus) {
      const sourceCategories = branchId && Array.isArray(menu.branch_categories) && menu.branch_categories.length
        ? menu.branch_categories
        : (menu.category ? [menu.category] : []);
      for (const category of sourceCategories) {
        const key = String(category.id);
        if (!categoriesMap.has(key)) {
          categoriesMap.set(key, { ...category, menus: [] });
        }
        const bucket = categoriesMap.get(key);
        if (!bucket.menus.some(item => String(item.id) === String(menu.id))) {
          bucket.menus.push(menu);
        }
      }
    }

    res.json({
      success: true,
      model: 'product-menu-inventory-v1',
      branch_id: branchId || null,
      categories: Array.from(categoriesMap.values()),
      menus
    });
  } catch (err) {
    console.error('[API Error /catalog/composed-menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/catalog/composed-menu/search', (req, res) => {
  try {
    if (!ComposedMenuResolver) {
      return res.status(503).json({ success: false, error: 'COMPOSED_MENU_NOT_READY' });
    }

    const brandId = req.brand_id;
    const branchId = req.query && req.query.branch_id ? String(req.query.branch_id).trim() : '';
    const query = req.query && req.query.q != null ? req.query.q : '';

    let menus;
    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) return res.status(400).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      if (branch.is_active === 0) return res.status(400).json({ success: false, error: 'BRANCH_INACTIVE' });
      menus = ComposedMenuResolver.searchBranchMenu({ brandId, branchId, query });
    } else {
      const needle = String(query == null ? '' : query).trim().toLocaleLowerCase();
      const all = ComposedMenuResolver.resolveMasterMenu({ brandId });
      menus = needle
        ? all.filter(menu => String(menu.title || '').toLocaleLowerCase().includes(needle) || String(menu.subtitle || '').toLocaleLowerCase().includes(needle))
        : all;
    }

    res.json({
      success: true,
      model: 'product-menu-inventory-v1',
      branch_id: branchId || null,
      query: String(query == null ? '' : query),
      menus
    });
  } catch (err) {
    console.error('[API Error /catalog/composed-menu/search]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get(['/catalog/menu', '/home'], async (req, res) => {
  try {
    const brandId = req.brand_id;
    const branchId = req.query && req.query.branch_id ? String(req.query.branch_id).trim() : '';

    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) return res.status(400).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      if (branch.is_active === 0) return res.status(400).json({ success: false, error: 'BRANCH_INACTIVE' });
    }

    // Compatibility envelope only: every item is still a canonical Menu View Model.
    // This endpoint must never reconstruct customer semantics from legacy Product fields.
    const menus = branchId
      ? ComposedMenuResolver.resolveBranchMenu({ brandId, branchId, includeUnavailable: false })
      : ComposedMenuResolver.resolveMasterMenu({ brandId });

    const products = menus.map(function (menu) {
      const firstComponent = Array.isArray(menu.components) && menu.components.length ? menu.components[0] : null;
      return {
        ...menu,
        id: menu.menu_id || menu.id,
        menu_id: menu.menu_id || menu.id,
        product_id: menu.menu_type === 'SINGLE' && firstComponent ? firstComponent.product_id : null,
        name: menu.title || menu.package_name || 'Menu',
        menu_title: menu.title || menu.package_name || 'Menu',
        menu_subtitle: menu.subtitle || '',
        menu_detail: [],
        menu_indicator: menu.level ? menu.level.name : null,
        menu_indicator_level: menu.level && menu.level.value != null ? menu.level.value : null,
        description: firstComponent ? (firstComponent.description || '') : '',
        image_url: firstComponent ? (firstComponent.image_url || '') : '',
        image: firstComponent ? (firstComponent.image_url || '') : '',
        media_id: firstComponent ? (firstComponent.media_id || null) : null,
        components: menu.components || [],
        component_snapshot: menu.components || [],
        menu_snapshot: {
          menu_id: menu.menu_id || menu.id,
          menu_type: menu.menu_type,
          title: menu.title,
          subtitle: menu.subtitle,
          price: Number(menu.price),
          category: menu.category || null,
          sub_category: menu.sub_category || null,
          rasa: menu.rasa || null,
          level: menu.level || null,
          status: menu.status
        },
        category_id: menu.category ? menu.category.id : null,
        category_ids: menu.category ? [menu.category.id] : [],
        regular_price: Number(menu.price),
        sale_price: Number(menu.price),
        stock_estimate: menu.inventory ? menu.inventory.available_quantity : null
      };
    });

    const categoryMap = new Map();
    for (const menu of menus) {
      const refs = branchId && Array.isArray(menu.branch_categories) && menu.branch_categories.length
        ? menu.branch_categories
        : (menu.category ? [menu.category] : []);
      for (const category of refs) {
        const key = String(category.id);
        if (!categoryMap.has(key)) categoryMap.set(key, { ...category, products: [] });
        const bucket = categoryMap.get(key);
        const menuAlias = products.find(function (item) { return String(item.id) === String(menu.id); });
        if (menuAlias && !bucket.products.some(function (item) { return String(item.id) === String(menu.id); })) {
          bucket.products.push(menuAlias);
        }
      }
    }

    res.json({
      success: true,
      model: 'product-menu-inventory-v1',
      branch_id: branchId || null,
      categories: Array.from(categoryMap.values()),
      menus,
      products,
      all_products: products
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
};
