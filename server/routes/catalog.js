/**
 * XENTRA CORE — PUBLIC CATALOG ROUTES
 *
 * `/catalog/composed-menu` is the canonical Product → Menu → Inventory endpoint.
 * `/catalog/menu` and `/home` remain legacy compatibility endpoints until their
 * remaining consumers are migrated and the legacy contract is retired.
 */
module.exports = function registerCatalogRoutes(router, deps) {
  const { db, CatalogService, MasterMenuResolver, ComposedMenuResolver, batchResolveCustomerMediaDelivery } = deps;


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
    const branchId = req.query.branch_id || '';

    let branchScope = null;
    if (branchId) {
      const branch = db.prepare('SELECT id, is_active FROM branches WHERE id = ? AND brand_id = ?').get(branchId, brandId);
      if (!branch) {
        return res.status(400).json({ success: false, error: 'branch not found' });
      }
      if (!branch.is_active) {
        return res.status(400).json({ success: false, error: 'branch is inactive' });
      }
      branchScope = branch;
    }

    // LEGACY COMPATIBILITY PATH.
    // New Customer PWA code must consume /catalog/composed-menu and must not
    // depend on this Product-centric endpoint for the forward Menu model.
    const menu = MasterMenuResolver
      ? (branchScope
        ? MasterMenuResolver.resolveBranchMenu({ brandId, branchId: branchScope.id })
        : MasterMenuResolver.resolveMasterMenu({ brandId }))
      : CatalogService.getMenu({ brand_id: brandId, branch_id: null });

    menu.products = (menu.products || []).map(function (p) {
      return {
        ...p,
        id: p.id || p.product_id,
        name: p.master && p.master.name ? p.master.name : p.name,
        description: p.master && p.master.description ? p.master.description : (p.description || ''),
        category_id: p.category_id || (p.categories && p.categories[0] ? p.categories[0].id : null),
        category_ids: Array.isArray(p.categories) ? p.categories.map(function (c) { return String(c.id); }) : [],
        price: p.price,
        regular_price: p.regular_price,
        is_active: p.is_active !== false,
        is_available: p.is_available !== false,
        stock_estimate: p.stock_estimate,
        menu_title: p.title,
        menu_subtitle: p.subtitle,
        menu_detail: p.detail,
        menu_indicator: p.indicator,
        menu_indicator_level: p.indicator_level || null,
        options_config: p.options || { version: 1, groups: [] }
      };
    });

    const allMediaIds = [];
    for (const c of menu.categories) {
      if (c.media_id) allMediaIds.push(c.media_id);
    }
    for (const p of menu.products) {
      if (p.media_id) allMediaIds.push(p.media_id);
    }

    const mediaMap = batchResolveCustomerMediaDelivery({
      mediaIds: allMediaIds,
      brandId,
      assetType: 'square'
    });

    const enrichItemMedia = (item) => {
      const legacyImg = item.image_url || item.icon_url || item.image || '';
      const resolved = item.media_id ? mediaMap.get(item.media_id) : null;
      const previewUrl = resolved ? resolved.preview_url : (legacyImg || null);
      const variants = resolved ? resolved.srcset_variants : [];
      return {
        preview_url: previewUrl,
        image_url: previewUrl || legacyImg,
        image: previewUrl || legacyImg,
        media_id: resolved ? resolved.media_id : null,
        srcset_variants: variants
      };
    };

    const categories = menu.categories.map((c) => {
      const media = enrichItemMedia(c);
      return {
        ...c,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants
      };
    });

    const allNormalized = menu.products.map((p) => {
      const media = enrichItemMedia(p);
      return {
        ...p,
        image: media.image,
        image_url: media.image_url,
        media_id: media.media_id,
        preview_url: media.preview_url,
        srcset_variants: media.srcset_variants,
        regular_price: p.regular_price || p.price,
        sale_price: p.price
      };
    });

    const productsByCategoryId = new Map();
    for (const p of allNormalized) {
      const catIds = (Array.isArray(p.category_ids) && p.category_ids.length > 0)
        ? p.category_ids.map(String)
        : (p.category_id != null ? [String(p.category_id)] : []);

      for (const catKey of catIds) {
        if (!productsByCategoryId.has(catKey)) {
          productsByCategoryId.set(catKey, []);
        }
        productsByCategoryId.get(catKey).push(p);
      }
    }

    const tree = categories.map((cat) => {
      const catProducts = productsByCategoryId.get(String(cat.id)) || [];
      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug || String(cat.name || '').toLowerCase().replace(/\s+/g, '-'),
        image: cat.preview_url || cat.image_url || '',
        image_url: cat.preview_url || cat.image_url || '',
        media_id: cat.media_id || null,
        preview_url: cat.preview_url || null,
        srcset_variants: cat.srcset_variants || [],
        products: catProducts
      };
    });

    res.json({
      success: true,
      categories: tree,
      all_products: allNormalized,
      products: {
        items: allNormalized
      },
      promo: {
        enabled: true,
        target: 50000,
        discount: 5000,
        label: 'Selamat, kamu berhasil dapetin diskon Rp 5.000 ketika checkout!'
      }
    });
  } catch (err) {
    console.error('[API Error /catalog/menu]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
};
