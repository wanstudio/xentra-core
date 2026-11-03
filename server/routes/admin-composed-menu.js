'use strict';

const {
  ComposedProductService,
  ComposedMenuService,
  ComposedMenuResolver
} = require('../../domains/catalog');

function statusForError(message) {
  switch (message) {
    case 'MENU_SATUAN_ALREADY_EXISTS':
    case 'SUB_CATEGORY_ALREADY_EXISTS':
    case 'RASA_ALREADY_EXISTS':
    case 'PRODUCT_SKU_ALREADY_EXISTS':
    case 'PRODUCT_SKU_REMOVAL_BLOCKED_STOCK':
    case 'MENU_TYPE_MISMATCH':
    case 'RASA_ORIGINAL_PROTECTED':
      return 409;
    case 'MENU_NOT_FOUND':
    case 'MASTER_PRODUCT_NOT_FOUND':
    case 'CATEGORY_NOT_FOUND':
    case 'SUB_CATEGORY_NOT_FOUND':
    case 'RASA_NOT_FOUND':
    case 'LEVEL_NOT_FOUND':
    case 'BRANCH_NOT_FOUND':
    case 'BRANCH_CATEGORY_NOT_FOUND':
    case 'BRANCH_MENU_NOT_FOUND':
      return 404;
    case 'BRAND_CONTEXT_REQUIRED':
    case 'BRANCH_CONTEXT_REQUIRED':
      return 400;
    default:
      return 400;
  }
}

function sendError(res, err, fallback) {
  const message = err && err.message ? err.message : fallback;
  return res.status(statusForError(message)).json({
    success: false,
    error: message
  });
}

function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

function registerAdminComposedMenuRoutes(router, deps = {}) {
  const requireAuth = deps.requireAuth;
  const productService = deps.productService || ComposedProductService;
  const service = deps.service || ComposedMenuService;
  const resolver = deps.resolver || ComposedMenuResolver;
  const rawDb = deps.db || require('../database/db');
  const ownerRoles = ['owner', 'brand_manager'];
  const menuAdoptionRoles = ['owner', 'brand_manager', 'branch_manager'];

  function attachRecipeToProduct(db, orgId, product, recipeData) {
    if (!product || !recipeData || !Array.isArray(recipeData.components) || recipeData.components.length === 0) return null;

    try {
      const recipeName = String(recipeData.name || recipeData.recipe_name || ('Resep ' + product.name)).trim();
      const yieldQty = Math.max(1, Number(recipeData.planned_yield_quantity || recipeData.yield_quantity) || 1);
      const yieldUomId = recipeData.yield_uom_id || 'uom_pcs';

      // 1. Ensure production_item exists
      let pi = db.prepare
        ? db.prepare("SELECT id FROM production_items WHERE output_product_id = ? AND status = 'ACTIVE' LIMIT 1").get(product.id)
        : (db.queryOne ? db.queryOne("SELECT id FROM production_items WHERE output_product_id = ? AND status = 'ACTIVE' LIMIT 1", [product.id]) : null);

      let piId = pi ? pi.id : null;
      if (!piId) {
        piId = 'pi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const code = ('PRD-' + String(product.sku || product.id).replace(/[^A-Z0-9_-]/gi, '').toUpperCase() + '-' + Date.now().toString(36)).slice(0, 80);
        const stmt = "INSERT INTO production_items (id, organization_id, output_product_id, production_item_code, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))";
        if (db.prepare) db.prepare(stmt).run(piId, orgId, product.id, code, recipeName);
        else if (db.execute) db.execute(stmt, [piId, orgId, product.id, code, recipeName]);
      }

      // 2. Ensure recipe exists
      let r = db.prepare
        ? db.prepare("SELECT id FROM recipes WHERE production_item_id = ? AND status = 'ACTIVE' LIMIT 1").get(piId)
        : (db.queryOne ? db.queryOne("SELECT id FROM recipes WHERE production_item_id = ? AND status = 'ACTIVE' LIMIT 1", [piId]) : null);

      let rId = r ? r.id : null;
      if (!rId) {
        rId = 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const stmt = "INSERT INTO recipes (id, production_item_id, name, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))";
        if (db.prepare) db.prepare(stmt).run(rId, piId, recipeName);
        else if (db.execute) db.execute(stmt, [rId, piId, recipeName]);
      } else {
        const stmt = "UPDATE recipes SET name = ?, updated_at = datetime('now') WHERE id = ?";
        if (db.prepare) db.prepare(stmt).run(recipeName, rId);
        else if (db.execute) db.execute(stmt, [recipeName, rId]);
      }

      // 3. Create published recipe_version
      const rvId = 'rv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const vNumRow = db.prepare
        ? db.prepare("SELECT MAX(version_number) AS max_v FROM recipe_versions WHERE recipe_id = ?").get(rId)
        : (db.queryOne ? db.queryOne("SELECT MAX(version_number) AS max_v FROM recipe_versions WHERE recipe_id = ?", [rId]) : null);
      const vNum = ((vNumRow && vNumRow.max_v) || 0) + 1;

      // Mark older versions archived
      if (db.prepare) db.prepare("UPDATE recipe_versions SET status = 'ARCHIVED' WHERE recipe_id = ? AND status = 'PUBLISHED'").run(rId);
      else if (db.execute) db.execute("UPDATE recipe_versions SET status = 'ARCHIVED' WHERE recipe_id = ? AND status = 'PUBLISHED'", [rId]);

      const rvStmt = "INSERT INTO recipe_versions (id, recipe_id, version_number, status, planned_yield_quantity, yield_uom_id, published_at, created_at, updated_at) VALUES (?, ?, ?, 'PUBLISHED', ?, ?, datetime('now'), datetime('now'), datetime('now'))";
      if (db.prepare) db.prepare(rvStmt).run(rvId, rId, vNum, yieldQty, yieldUomId);
      else if (db.execute) db.execute(rvStmt, [rvId, rId, vNum, yieldQty, yieldUomId]);

      // 4. Insert components and calculate total cost
      let totalCost = 0;
      const comps = [];
      recipeData.components.forEach((comp, idx) => {
        const rcId = 'rc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + idx;
        const matId = comp.material_id || comp.materialId;
        const qty = Math.max(0, Number(comp.planned_quantity || comp.quantity) || 0);
        const uomId = comp.planned_uom_id || comp.plannedUomId || comp.uom_id || 'uom_g';

        const rcStmt = "INSERT INTO recipe_components (id, recipe_version_id, material_id, planned_quantity, planned_uom_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))";
        if (db.prepare) db.prepare(rcStmt).run(rcId, rvId, matId, qty, uomId, idx);
        else if (db.execute) db.execute(rcStmt, [rcId, rvId, matId, qty, uomId, idx]);

        // Calculate line cost
        const matRow = db.prepare
          ? db.prepare("SELECT m.name AS material_name, m.base_uom_id, u.name AS uom_name, u.conversion_factor AS uom_factor, bu.conversion_factor AS base_factor, COALESCE(NULLIF(msb.moving_average_unit_cost, 0), m.estimated_unit_cost, 0) AS unit_cost FROM materials m LEFT JOIN uoms u ON u.id = ? LEFT JOIN uoms bu ON bu.id = m.base_uom_id LEFT JOIN (SELECT material_id, AVG(moving_average_unit_cost) AS moving_average_unit_cost FROM material_stock_balances WHERE moving_average_unit_cost > 0 GROUP BY material_id) msb ON msb.material_id = m.id WHERE m.id = ?").get(uomId, matId)
          : (db.queryOne ? db.queryOne("SELECT m.name AS material_name, m.base_uom_id, u.name AS uom_name, u.conversion_factor AS uom_factor, bu.conversion_factor AS base_factor, COALESCE(NULLIF(msb.moving_average_unit_cost, 0), m.estimated_unit_cost, 0) AS unit_cost FROM materials m LEFT JOIN uoms u ON u.id = ? LEFT JOIN uoms bu ON bu.id = m.base_uom_id LEFT JOIN (SELECT material_id, AVG(moving_average_unit_cost) AS moving_average_unit_cost FROM material_stock_balances WHERE moving_average_unit_cost > 0 GROUP BY material_id) msb ON msb.material_id = m.id WHERE m.id = ?", [uomId, matId]) : null);

        if (matRow) {
          const factor = (Number(matRow.uom_factor) || 1) / (Number(matRow.base_factor) || 1);
          const qtyInBase = qty * factor;
          const lineCost = qtyInBase * (Number(matRow.unit_cost) || 0);
          totalCost += lineCost;
          comps.push({
            material_id: matId,
            material_name: matRow.material_name || comp.material_name || 'Bahan',
            planned_quantity: qty,
            planned_uom_id: uomId,
            uom_name: matRow.uom_name || comp.uom_name || 'Gr',
            planned_uom_factor: matRow.uom_factor,
            base_uom_factor: matRow.base_factor,
            base_uom_id: matRow.base_uom_id,
            unit_cost: matRow.unit_cost
          });
        }
      });

      const costPerUnit = yieldQty > 0 ? Math.round(totalCost / yieldQty) : Math.round(totalCost);
      if (costPerUnit > 0) {
        if (db.prepare) db.prepare("UPDATE products SET cost_price = ? WHERE id = ?").run(costPerUnit, product.id);
        else if (db.execute) db.execute("UPDATE products SET cost_price = ? WHERE id = ?", [costPerUnit, product.id]);
        product.cost_price = costPerUnit;
      }

      return {
        id: rId,
        name: recipeName,
        recipe_version_id: rvId,
        yield_quantity: yieldQty,
        yield_uom_name: 'Porsi',
        total_batch_cost: Math.round(totalCost),
        cost_per_unit: costPerUnit,
        components: comps.length > 0 ? comps : recipeData.components
      };
    } catch (err) {
      console.error('[attachRecipeToProduct] Error saving recipe:', err);
      return null;
    }
  }

  const handleProductList = (req, res) => {
    try {
      setNoCacheHeaders(res);
      const activeOnly = !(req.query && (req.query.active_only === '0' || req.query.active_only === 'false'));
      const query = req.query && req.query.q != null ? req.query.q : null;
      res.json({
        success: true,
        products: productService.listProducts({
          brandId: req.brand_id,
          activeOnly,
          query
        })
      });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_LIST_FAILED');
    }
  };

  const handleProductRead = (req, res) => {
    try {
      setNoCacheHeaders(res);
      const product = productService.findProduct
        ? productService.findProduct({ brandId: req.brand_id, productId: req.params.id })
        : null;

      if (!product) {
        return res.status(404).json({ success: false, error: 'MASTER_PRODUCT_NOT_FOUND' });
      }

      if (rawDb && rawDb.prepare) {
        try {
          const branchAdoptions = rawDb.prepare(`
            SELECT 
              b.id AS branch_id,
              b.name AS branch_name,
              b.address_text AS branch_address,
              b.is_active AS is_branch_active,
              bp.product_id,
              bp.price AS branch_price,
              bp.stock AS branch_stock,
              bp.is_available AS branch_is_available,
              CASE WHEN bp.product_id IS NOT NULL THEN 1 ELSE 0 END AS is_adopted
            FROM branches b
            LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ?
            WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
            ORDER BY b.name ASC
          `).all(req.params.id, req.brand_id);
          product.branch_adoptions = branchAdoptions;
        } catch (_) {}
      }

      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_READ_FAILED');
    }
  };

  const handleProductCreate = (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.createProduct({
        brandId: req.brand_id,
        name: body.name,
        sku: body.sku,
        costPrice: body.cost_price !== undefined ? body.cost_price : body.costPrice,
        inventoryType: body.inventory_type !== undefined ? body.inventory_type : body.inventoryType,
        description: body.description,
        imageUrl: body.image_url !== undefined ? body.image_url : body.imageUrl,
        image: body.image,
        isActive: body.is_active !== undefined ? body.is_active : (body.isActive !== undefined ? body.isActive : true),
        optionsConfig: body.options_config !== undefined ? body.options_config : body.optionsConfig,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });

      if (body.recipe && Array.isArray(body.recipe.components) && body.recipe.components.length > 0) {
        const orgId = req.organization_id || (req.user && req.user.organization_id) || 'org_xentra_holding';
        const attached = attachRecipeToProduct(rawDb, orgId, product, body.recipe);
        if (attached) product.recipe = attached;
      }

      res.status(201).json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_CREATE_FAILED');
    }
  };

  const handleProductUpdate = (req, res) => {
    try {
      const body = req.body || {};
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        name: body.name,
        sku: body.sku,
        costPrice: body.cost_price !== undefined ? body.cost_price : body.costPrice,
        inventoryType: body.inventory_type !== undefined ? body.inventory_type : body.inventoryType,
        description: body.description,
        imageUrl: body.image_url !== undefined ? body.image_url : body.imageUrl,
        image: body.image,
        isActive: body.is_active !== undefined ? body.is_active : body.isActive,
        optionsConfig: body.options_config !== undefined ? body.options_config : body.optionsConfig,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });

      if (body.recipe && Array.isArray(body.recipe.components) && body.recipe.components.length > 0) {
        const orgId = req.organization_id || (req.user && req.user.organization_id) || 'org_xentra_holding';
        const attached = attachRecipeToProduct(rawDb, orgId, product, body.recipe);
        if (attached) product.recipe = attached;
      }

      if (Array.isArray(body.branch_prices) && rawDb && rawDb.prepare) {
        for (const bp of body.branch_prices) {
          if (!bp || !bp.branch_id) continue;
          const rawPrice = bp.price !== undefined && bp.price !== null && bp.price !== '' ? Number(bp.price) : null;
          const branchPrice = (rawPrice !== null && Number.isFinite(rawPrice) && rawPrice >= 0) ? rawPrice : null;
          const existing = rawDb.prepare('SELECT branch_id FROM branch_products WHERE branch_id = ? AND product_id = ?').get(bp.branch_id, req.params.id);
          if (existing) {
            rawDb.prepare('UPDATE branch_products SET price = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND product_id = ?')
              .run(branchPrice, bp.branch_id, req.params.id);
          } else {
            rawDb.prepare(`
              INSERT INTO branch_products (branch_id, product_id, price, stock, is_available)
              VALUES (?, ?, ?, 100, 1)
            `).run(bp.branch_id, req.params.id, branchPrice);
          }
        }
      }

      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_UPDATE_FAILED');
    }
  };

  const handleProductStatusUpdate = (req, res) => {
    try {
      const isActive = req.body && (req.body.is_active !== undefined ? req.body.is_active : req.body.isActive);
      const product = productService.updateProduct({
        brandId: req.brand_id,
        productId: req.params.id,
        isActive: isActive,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PRODUCT_STATUS_UPDATE_FAILED');
    }
  };

  ['/admin/composed/products', '/admin/items'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleProductList);
    router.post(routePath, requireAuth(ownerRoles), handleProductCreate);
  });

  ['/admin/composed/products/:id', '/admin/items/:id'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleProductRead);
    router.put(routePath, requireAuth(ownerRoles), handleProductUpdate);
  });

  ['/admin/composed/products/:id/status', '/admin/items/:id/status'].forEach(routePath => {
    router.patch(routePath, requireAuth(ownerRoles), handleProductStatusUpdate);
  });

  const handleMenuList = (req, res) => {
    try {
      setNoCacheHeaders(res);
      const menuType = req.query && req.query.menu_type ? String(req.query.menu_type).trim().toUpperCase() : null;
      const status = req.query && req.query.status ? String(req.query.status).trim().toUpperCase() : null;
      const menus = service.listMenus({
        brandId: req.brand_id,
        menuType,
        status
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_LIST_FAILED');
    }
  };

  const handleMenuRead = (req, res) => {
    try {
      setNoCacheHeaders(res);
      const menu = resolver.resolveMenu({
        brandId: req.brand_id,
        menuId: req.params.id
      });

      if (menu && rawDb && rawDb.prepare) {
        try {
          const branchAdoptions = rawDb.prepare(`
            SELECT 
              b.id AS branch_id,
              b.name AS branch_name,
              b.address_text AS branch_address,
              b.is_active AS is_branch_active,
              bm.is_available,
              bm.price_override,
              CASE WHEN bm.menu_id IS NOT NULL THEN 1 ELSE 0 END AS is_adopted
            FROM branches b
            LEFT JOIN branch_menus bm ON bm.branch_id = b.id AND bm.menu_id = ?
            WHERE b.brand_id = ? AND (b.is_archived = 0 OR b.is_archived IS NULL)
            ORDER BY b.name ASC
          `).all(req.params.id, req.brand_id);
          menu.branch_adoptions = branchAdoptions;
        } catch (_) {}
      }

      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_READ_FAILED');
    }
  };

  // Canonical Menu endpoints (Contract v4 §3, §14):
  // POST /admin/menus - Create canonical Menu (Category, Judul, Rasa, Harga, Modal, Items)
  const handleMenuCreate = (req, res) => {
    try {
      const body = req.body || {};
      let titleId = body.title_id || body.titleId;
      const rawTitleName = (body.title_name || body.titleName || body.package_name || body.packageName || body.name || body.title || '').trim();
      if (!titleId && rawTitleName) {
        const resolvedTitle = service.createMenuTitle({ brandId: req.brand_id, name: rawTitleName });
        if (resolvedTitle) titleId = resolvedTitle.id;
      }

      const items = Array.isArray(body.items) ? body.items : (
        Array.isArray(body.components) ? body.components : (
          (body.product_id || body.productId) ? [{ product_id: body.product_id || body.productId, quantity: 1 }] : []
        )
      );

      const sellingPrice = body.selling_price !== undefined ? body.selling_price : (
        body.sellingPrice !== undefined ? body.sellingPrice : (
          body.price !== undefined ? body.price : (
            body.min_price !== undefined ? body.min_price : (
              body.minPrice !== undefined ? body.minPrice : 0
            )
          )
        )
      );

      const costPrice = body.cost_price !== undefined ? body.cost_price : (
        body.costPrice !== undefined ? body.costPrice : (
          body.cost !== undefined ? body.cost : 0
        )
      );

      const status = body.status || (
        body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'DRAFT') : (
          body.isActive !== undefined ? (body.isActive ? 'ACTIVE' : 'DRAFT') : undefined
        )
      );

      const menu = service.createMenu({
        brandId: req.brand_id,
        packageName: body.package_name !== undefined ? body.package_name : (body.packageName !== undefined ? body.packageName : (body.title_name || body.titleName || rawTitleName || undefined)),
        categoryId: body.category_id || body.categoryId,
        titleId: titleId,
        rasaId: body.rasa_id !== undefined ? body.rasa_id : (body.rasaId !== undefined ? body.rasaId : null),
        description: body.description,
        spiceEnabled: body.spice_enabled !== undefined ? body.spice_enabled : (body.spiceEnabled !== undefined ? body.spiceEnabled : false),
        spiceLevel: body.spice_level !== undefined ? body.spice_level : (body.spiceLevel !== undefined ? body.spiceLevel : null),
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        items,
        status: status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_CREATE_FAILED');
    }
  };

  // PUT /admin/menus/:id - Update canonical Menu
  const handleMenuUpdate = (req, res) => {
    try {
      const body = req.body || {};
      let titleId = body.title_id || body.titleId;
      const rawTitleName = (body.title_name || body.titleName || body.package_name || body.packageName || body.name || body.title || '').trim();
      if (!titleId && rawTitleName) {
        const resolvedTitle = service.createMenuTitle({ brandId: req.brand_id, name: rawTitleName });
        if (resolvedTitle) titleId = resolvedTitle.id;
      }

      const items = Array.isArray(body.items) ? body.items : (
        Array.isArray(body.components) ? body.components : (
          (body.product_id || body.productId) ? [{ product_id: body.product_id || body.productId, quantity: 1 }] : undefined
        )
      );

      const sellingPrice = body.selling_price !== undefined ? body.selling_price : (
        body.sellingPrice !== undefined ? body.sellingPrice : (
          body.price !== undefined ? body.price : (
            body.min_price !== undefined ? body.min_price : (
              body.minPrice !== undefined ? body.minPrice : undefined
            )
          )
        )
      );

      const costPrice = body.cost_price !== undefined ? body.cost_price : (
        body.costPrice !== undefined ? body.costPrice : (
          body.cost !== undefined ? body.cost : undefined
        )
      );

      const status = body.status || (
        body.is_active !== undefined ? (body.is_active ? 'ACTIVE' : 'DRAFT') : (
          body.isActive !== undefined ? (body.isActive ? 'ACTIVE' : 'DRAFT') : undefined
        )
      );

      const menu = service.updateMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        packageName: body.package_name !== undefined ? body.package_name : (body.packageName !== undefined ? body.packageName : (body.title_name || body.titleName || (rawTitleName ? rawTitleName : undefined))),
        categoryId: body.category_id || body.categoryId,
        titleId: titleId,
        rasaId: body.rasa_id !== undefined ? body.rasa_id : (body.rasaId !== undefined ? body.rasaId : undefined),
        description: body.description,
        spiceEnabled: body.spice_enabled !== undefined ? body.spice_enabled : (body.spiceEnabled !== undefined ? body.spiceEnabled : undefined),
        spiceLevel: body.spice_level !== undefined ? body.spice_level : (body.spiceLevel !== undefined ? body.spiceLevel : undefined),
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        items,
        status: status
      });

      if (Array.isArray(body.branch_prices) && rawDb && rawDb.prepare) {
        for (const bp of body.branch_prices) {
          if (!bp || !bp.branch_id) continue;
          const rawPrice = bp.price !== undefined && bp.price !== null && bp.price !== '' ? Number(bp.price) : null;
          const branchPrice = (rawPrice !== null && Number.isFinite(rawPrice) && rawPrice >= 0) ? rawPrice : null;
          const existing = rawDb.prepare('SELECT branch_id FROM branch_menus WHERE branch_id = ? AND menu_id = ?').get(bp.branch_id, req.params.id);
          if (existing) {
            rawDb.prepare('UPDATE branch_menus SET price_override = ?, updated_at = datetime(\'now\') WHERE branch_id = ? AND menu_id = ?')
              .run(branchPrice, bp.branch_id, req.params.id);
          } else {
            rawDb.prepare(`
              INSERT INTO branch_menus (branch_id, menu_id, price_override, is_available)
              VALUES (?, ?, ?, 1)
            `).run(bp.branch_id, req.params.id, branchPrice);
          }
        }
      }

      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_UPDATE_FAILED');
    }
  };

  const handleMenuStatusUpdate = (req, res) => {
    try {
      const menu = service.setMenuStatus({
        brandId: req.brand_id,
        menuId: req.params.id,
        status: req.body && req.body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_STATUS_UPDATE_FAILED');
    }
  };

  const handleMenuDelete = (req, res) => {
    try {
      const result = service.deleteMenu({
        brandId: req.brand_id,
        menuId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_DELETE_FAILED');
    }
  };

  const handleMenuReorder = (req, res) => {
    try {
      const order = req.body && req.body.order;
      const categoryId = req.body && (req.body.category_id || req.body.categoryId) || null;
      const menus = service.reorderMenus({
        brandId: req.brand_id,
        categoryId,
        order
      });
      res.json({
        success: true,
        message: 'Urutan menu berhasil disimpan.',
        menus
      });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_REORDER_FAILED');
    }
  };

  ['/admin/menus', '/admin/master-menus', '/admin/composed/menus'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleMenuList);
    router.post(routePath, requireAuth(ownerRoles), handleMenuCreate);
  });

  ['/admin/menus/reorder', '/admin/master-menus/reorder', '/admin/composed/menus/reorder'].forEach(routePath => {
    router.put(routePath, requireAuth(ownerRoles), handleMenuReorder);
  });

  ['/admin/menus/:id', '/admin/master-menus/:id', '/admin/composed/menus/:id'].forEach(routePath => {
    router.get(routePath, requireAuth(ownerRoles), handleMenuRead);
    router.put(routePath, requireAuth(ownerRoles), handleMenuUpdate);
    router.delete(routePath, requireAuth(ownerRoles), handleMenuDelete);
  });

  ['/admin/menus/:id/status', '/admin/master-menus/:id/status', '/admin/composed/menus/:id/status'].forEach(routePath => {
    router.patch(routePath, requireAuth(ownerRoles), handleMenuStatusUpdate);
  });

  router.post('/admin/menus/single', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createSingleMenu({
        brandId: req.brand_id,
        productId: body.product_id,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        status: body.status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_SINGLE_MENU_CREATE_FAILED');
    }
  });

  router.put('/admin/menus/:id/single', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.updateSingleMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        productId: body.product_id,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        status: body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_SINGLE_MENU_UPDATE_FAILED');
    }
  });

  router.post('/admin/menus/package', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.createPackageMenu({
        brandId: req.brand_id,
        packageName: body.package_name,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        components: body.components,
        status: body.status
      });
      res.status(201).json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PACKAGE_MENU_CREATE_FAILED');
    }
  });

  router.put('/admin/menus/:id/package', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const menu = service.updatePackageMenu({
        brandId: req.brand_id,
        menuId: req.params.id,
        packageName: body.package_name,
        sellingPrice: body.selling_price,
        costPrice: body.cost_price,
        subCategoryId: body.sub_category_id,
        rasaId: body.rasa_id,
        levelId: body.level_id,
        components: body.components,
        status: body.status
      });
      res.json({ success: true, menu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_PACKAGE_MENU_UPDATE_FAILED');
    }
  });



  router.post('/admin/menus/:id/adopt', requireAuth(menuAdoptionRoles), (req, res) => {
    try {
      const body = req.body || {};
      const branchId = body.branch_id;
      if (!branchId) return res.status(400).json({ success: false, error: 'BRANCH_CONTEXT_REQUIRED' });

      if (req.user && req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && String(assignedBranchId) !== String(branchId)) {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
          });
        }
      }

      const result = service.adoptMenuToBranch({
        brandId: req.brand_id,
        branchId,
        menuId: req.params.id,
        isAvailable: body.is_available === undefined ? true : body.is_available,
        priceOverride: body.price_override,
        branchCategoryIds: body.branch_category_ids
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'COMPOSED_MENU_ADOPTION_FAILED');
    }
  });

  router.patch('/admin/menus/:id/availability', requireAuth(['owner', 'brand_manager', 'branch_manager']), (req, res) => {
    try {
      const branchId = req.body && req.body.branch_id;
      if (!branchId) return res.status(400).json({ success: false, error: 'BRANCH_CONTEXT_REQUIRED' });

      if (req.user && req.user.role === 'branch_manager') {
        const assignedBranchId = req.user.branchId || req.user.branch_id;
        if (assignedBranchId && assignedBranchId !== branchId) {
          return res.status(403).json({
            success: false,
            error: 'FORBIDDEN_BRANCH_SCOPE',
            message: 'Branch Manager hanya memiliki kewenangan pada cabang yang ditugaskan.'
          });
        }
      }

      const raw = req.body && req.body.is_available;
      if (raw !== true && raw !== false && Number(raw) !== 0 && Number(raw) !== 1) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_AVAILABILITY',
          message: 'is_available harus berupa true/false atau 0/1.'
        });
      }

      const branch = deps.db
        ? deps.db.prepare('SELECT id FROM branches WHERE id = ? AND brand_id = ?').get(branchId, req.brand_id)
        : null;
      if (!branch) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });

      const branchMenu = service.setBranchMenuAvailability({
        brandId: req.brand_id,
        branchId,
        menuId: req.params.id,
        isAvailable: raw === true || Number(raw) === 1
      });

      res.json({ success: true, branch_menu: branchMenu });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_AVAILABILITY_UPDATE_FAILED');
    }
  });

  router.get('/admin/sub-categories', requireAuth(ownerRoles), (req, res) => {
    try {
      const categoryId = req.query && req.query.category_id ? req.query.category_id : null;
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        sub_categories: service.listSubCategories({
          brandId: req.brand_id,
          categoryId,
          activeOnly
        })
      });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_LIST_FAILED');
    }
  });

  router.put('/admin/sub-categories/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const result = service.updateSubCategory({
        brandId: req.brand_id,
        subCategoryId: req.params.id,
        name: body.name,
        categoryId: body.category_id,
        slug: body.slug,
        isActive: body.is_active
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_UPDATE_FAILED');
    }
  });

  router.delete('/admin/sub-categories/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteSubCategory({
        brandId: req.brand_id,
        subCategoryId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_DELETE_FAILED');
    }
  });

  router.post('/admin/sub-categories', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const subCategory = service.createSubCategory({
        brandId: req.brand_id,
        categoryId: body.category_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, sub_category: subCategory });
    } catch (err) {
      sendError(res, err, 'SUB_CATEGORY_CREATE_FAILED');
    }
  });

  router.get('/admin/rasas', requireAuth(ownerRoles), (req, res) => {
    try {
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        rasas: service.listRasas({
          brandId: req.brand_id,
          activeOnly
        })
      });
    } catch (err) {
      sendError(res, err, 'RASA_LIST_FAILED');
    }
  });

  router.put('/admin/rasas/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const result = service.updateRasa({
        brandId: req.brand_id,
        rasaId: req.params.id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order,
        isActive: body.is_active
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'RASA_UPDATE_FAILED');
    }
  });

  router.delete('/admin/rasas/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteRasa({
        brandId: req.brand_id,
        rasaId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'RASA_DELETE_FAILED');
    }
  });

  // ── Judul (menu_titles) — master judul customer ────────────────────────────
  // Contract v1: Sub Category dipensiunkan; Judul menggantikannya sebagai judul customer.
  // Pola endpoint sengaja sama dengan /admin/rasas supaya editor Menu dan tab
  // Master Category memakai satu pola yang sudah ada.

  router.get('/admin/menu-titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const activeOnly = req.query && (req.query.active_only === '1' || req.query.active_only === 'true');
      res.json({
        success: true,
        titles: service.listMenuTitles({ brandId: req.brand_id, activeOnly })
      });
    } catch (err) {
      sendError(res, err, 'TITLE_LIST_FAILED');
    }
  });

  router.post('/admin/menu-titles', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const title = service.createMenuTitle({
        brandId: req.brand_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, title });
    } catch (err) {
      sendError(res, err, 'TITLE_CREATE_FAILED');
    }
  });

  router.put('/admin/menu-titles/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const title = service.updateMenuTitle({
        brandId: req.brand_id,
        titleId: req.params.id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order,
        isActive: body.is_active
      });
      res.json({ success: true, title });
    } catch (err) {
      sendError(res, err, 'TITLE_UPDATE_FAILED');
    }
  });

  router.delete('/admin/menu-titles/:id', requireAuth(ownerRoles), (req, res) => {
    try {
      const result = service.deleteMenuTitle({
        brandId: req.brand_id,
        titleId: req.params.id
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, 'TITLE_DELETE_FAILED');
    }
  });

  router.post('/admin/rasas', requireAuth(ownerRoles), (req, res) => {
    try {
      const body = req.body || {};
      const rasa = service.createRasa({
        brandId: req.brand_id,
        name: body.name,
        slug: body.slug,
        sortOrder: body.sort_order
      });
      res.status(201).json({ success: true, rasa });
    } catch (err) {
      sendError(res, err, 'RASA_CREATE_FAILED');
    }
  });

  router.put('/admin/products/:id/sku', requireAuth(ownerRoles), (req, res) => {
    try {
      const product = service.setProductSku({
        brandId: req.brand_id,
        productId: req.params.id,
        sku: req.body && req.body.sku,
        actorId: req.user && (req.user.id || req.user.userId) || null,
        actorRole: req.user && req.user.role || null
      });
      res.json({ success: true, product });
    } catch (err) {
      sendError(res, err, 'PRODUCT_SKU_UPDATE_FAILED');
    }
  });

  router.get('/catalog/branch-menu', (req, res) => {
    try {
      const branchId = req.query && req.query.branch_id;
      const includeUnavailable = req.query && (req.query.include_unavailable === '1' || req.query.include_unavailable === 'true');
      const menus = resolver.resolveBranchMenu({
        brandId: req.brand_id,
        branchId,
        includeUnavailable
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_READ_FAILED');
    }
  });

  router.get('/catalog/branch-menu/search', (req, res) => {
    try {
      const branchId = req.query && req.query.branch_id;
      const query = req.query && req.query.q;
      const menus = resolver.searchBranchMenu({
        brandId: req.brand_id,
        branchId,
        query
      });
      res.json({ success: true, menus });
    } catch (err) {
      sendError(res, err, 'COMPOSED_BRANCH_MENU_SEARCH_FAILED');
    }
  });
}

module.exports = registerAdminComposedMenuRoutes;
